import {adaptiveTierLatticeSearch,analyzeTierCompleteness,choosePracticalComposition,compositionSignature,createCompositionNeighborhood,createReviewTierStructures,inferReviewAvailability} from './epic-composition-search.mjs';
import {createLegacyHealthLadderSeed,optimizeEpicQuantities} from './epic-quantity-optimizer.mjs?v=191';
import {scoreEpicArmy} from './epic-combat-engine-v2.mjs?v=191';

export const EPIC_REVIEW_BUILD='0.1-worker-prototype';

function assertWithinDeadline(deadline){
  if(Number.isFinite(deadline)&&performance.now()>deadline){
    const error=new Error('Review Selection reached its time limit. Your selection was not changed.');
    error.code='TIME_BUDGET';throw error;
  }
}
function differences(from,to){const a=new Set(from),b=new Set(to);return{added:to.filter(id=>!a.has(id)),removed:from.filter(id=>!b.has(id))};}
function retainBest(map,row,limit){
  const signature=compositionSignature(row.selectedIds),previous=map.get(signature);
  if(!previous||row.result.expectedTotalLifetimeDamage>previous.result.expectedTotalLifetimeDamage)map.set(signature,row);
  if(map.size<=limit)return;
  const keep=[...map.values()].sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage).slice(0,limit);
  map.clear();for(const candidate of keep)map.set(compositionSignature(candidate.selectedIds),candidate);
}

export async function runOptimizeReviewSelection({units,currentIds,bonuses,capacityLimits,fixedQuantities={},timeBudgetMs=120_000,onProgress=()=>{}}){
  const started=performance.now(),deadline=started+Math.max(1_000,Number(timeBudgetMs)||120_000);
  const availability=inferReviewAvailability({units,selectedIds:currentIds});
  const structures=createReviewTierStructures({units,availableIds:availability.availableIds,mandatoryIds:availability.mandatoryIds});
  const fixedNames=new Set(Object.keys(fixedQuantities||{}));
  const fixedIds=new Set(units.filter(unit=>fixedNames.has(unit.name)||fixedNames.has(unit.id)).map(unit=>unit.id));
  const optimizableIds=ids=>ids.filter(id=>!fixedIds.has(id));
  const combineFixed=quantities=>({...quantities,...fixedQuantities});
  let evaluations=0;
  const quickEvaluate=ids=>{
    assertWithinDeadline(deadline);evaluations++;
    const quantities=combineFixed(createLegacyHealthLadderSeed({units,selectedIds:optimizableIds(ids),bonuses,capacityLimits,separationPct:.05}));
    return{selectedIds:ids,quantities,result:scoreEpicArmy({units,quantities,bonuses})};
  };
  const refine=(candidate,strong=false)=>{
    assertWithinDeadline(deadline);
    const initialQuantities=Object.fromEntries(Object.entries(candidate.quantities).filter(([name])=>!fixedNames.has(name)));
    const optimized=optimizeEpicQuantities({units,selectedIds:optimizableIds(candidate.selectedIds),bonuses,capacityLimits,initialQuantities,minimumHealthSeparationPct:.01,minimumQuantity:1,stageFractions:strong?[.05,.02,.01,.005,.002,.001,.0005]:[.02,.005,.001],maxRoundsPerStage:strong?8:3});
    assertWithinDeadline(deadline);
    const quantities=combineFixed(optimized.quantities);
    return{selectedIds:candidate.selectedIds,quantities,result:scoreEpicArmy({units,quantities,bonuses})};
  };

  onProgress({phase:'tier-screen',progressPct:5,evaluations});
  const tierSearch=await adaptiveTierLatticeSearch({structures,currentIds,beamWidth:16,maxEvaluations:250,evaluateSelection:async ids=>quickEvaluate(ids)});
  assertWithinDeadline(deadline);
  onProgress({phase:'unit-neighborhood',progressPct:28,evaluations});
  const retained=new Map();
  for(const parent of tierSearch.results.slice(0,8)){
    retainBest(retained,parent,64);
    for(const ids of createCompositionNeighborhood({selectedIds:parent.selectedIds,candidateIds:availability.availableIds,mandatoryIds:availability.mandatoryIds}))retainBest(retained,quickEvaluate(ids),64);
  }
  const neighborhood=[...retained.values()].sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage);
  const promotion=[...new Map([...neighborhood.slice(0,8),...tierSearch.results.slice(0,4)].map(row=>[compositionSignature(row.selectedIds),row])).values()];
  const short=[];
  for(const [index,candidate] of promotion.entries()){
    onProgress({phase:'short-refinement',progressPct:35+Math.round((index/promotion.length)*30),candidate:index+1,candidateCount:promotion.length,evaluations});
    short.push(refine(candidate));
  }
  short.sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage);
  const complete=short.filter(candidate=>analyzeTierCompleteness({selectedIds:candidate.selectedIds,availableIds:availability.availableIds,units}).partialTierGroups===0);
  const survivors=[...new Map([...short.slice(0,4),...complete.slice(0,2)].map(row=>[compositionSignature(row.selectedIds),row])).values()].slice(0,6);
  const strong=[];
  for(const [index,candidate] of survivors.entries()){
    onProgress({phase:'strong-refinement',progressPct:68+Math.round((index/survivors.length)*25),candidate:index+1,candidateCount:survivors.length,evaluations});
    strong.push(refine(candidate,true));
  }
  const current=refine(quickEvaluate(currentIds));
  const candidates=[current,...strong].map(row=>({...row,selectionChanges:differences(currentIds,row.selectedIds).added.length+differences(currentIds,row.selectedIds).removed.length}));
  const decision=choosePracticalComposition(candidates,{units,availableIds:availability.availableIds});
  const changes=differences(currentIds,decision.chosen.selectedIds);
  const selectedMercenaries=new Set(availability.mandatoryIds);
  if(changes.added.some(id=>units.find(unit=>unit.id===id)?.category==='mercenary')||changes.removed.some(id=>selectedMercenaries.has(id)))throw new Error('Review Selection attempted to change selected mercenary types.');
  onProgress({phase:'complete',progressPct:100,evaluations});
  return{build:EPIC_REVIEW_BUILD,elapsedMs:performance.now()-started,evaluations,tierEvaluations:tierSearch.evaluations,tierRounds:tierSearch.rounds,fixedMercenaries:fixedIds.size,current:{selectedIds:current.selectedIds,eld:current.result.expectedTotalLifetimeDamage},proposal:{selectedIds:decision.chosen.selectedIds,eld:decision.chosen.eld,improvementPct:(decision.chosen.eld/current.result.expectedTotalLifetimeDamage-1)*100,added:changes.added,removed:changes.removed,partialTierGroups:decision.chosen.partialTierGroups},mandatoryMercenaryIds:availability.mandatoryIds};
}
