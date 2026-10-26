import {compositionSignature,createReviewTierStructures,inferReviewAvailability} from './epic-composition-search.mjs';
import {createLegacyHealthLadderSeed,mercenaryPreservationStatus,optimizeEpicQuantities} from './epic-quantity-optimizer.mjs';
import {prepareEpicScoringContext,scoreEpicArmy} from './epic-combat-engine-v2.mjs';

const groupKey=u=>`${u.category}|${u.unitClass||''}|${u.tier}`;
const eld=row=>Number(row.result.expectedTotalLifetimeDamage)||0;

// Every permitted tier lattice point gets partial-tier neighbors before ranking.
// No family, tier number, encounter, or unit is privileged by this expansion.
export function createExploreStructures({units,currentIds,maxTierDepth}){
  const availability=inferReviewAvailability({units,selectedIds:currentIds,maxTierDepth});
  const allowed=new Set(availability.availableIds),groups=new Map(),seen=new Map();
  for(const u of units)if(allowed.has(u.id)&&u.category!=='mercenary'){
    const key=groupKey(u);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(u.id);
  }
  const add=ids=>{if(ids.some(id=>!availability.mandatoryIds.includes(id)))seen.set(compositionSignature(ids),{selectedIds:[...ids]});};
  add(currentIds);
  const dense=createReviewTierStructures({units,...availability});
  // First cover all dense structures, then all single-group sparse alternatives.
  for(const row of dense)add(row.selectedIds);
  for(const row of dense){
    const selected=new Set(row.selectedIds);
    for(const ids of groups.values()){
      if(!ids.every(id=>selected.has(id)))continue;
      const base=row.selectedIds.filter(id=>!ids.includes(id));
      for(const id of ids){add([...base,id]);add(row.selectedIds.filter(other=>other!==id));}
    }
  }
  return{...availability,structures:[...seen.values()]};
}

// Reserve representation by squad counts per family/tier, so a crowd of nearly
// identical high seed scores cannot evict every sparse or differently sized army.
export function diverseExploreRows(rows,units,limit){
  const byId=new Map(units.map(u=>[u.id,u])),ranked=[...rows].sort((a,b)=>eld(b)-eld(a));
  const picked=[],seen=new Set(),shapes=new Set();
  const take=row=>{const key=compositionSignature(row.selectedIds);if(!seen.has(key)){seen.add(key);picked.push(row);}};
  for(const row of ranked.slice(0,Math.ceil(limit/3)))take(row);
  for(const row of ranked){
    const counts=new Map();for(const id of row.selectedIds){const u=byId.get(id);if(u){const key=groupKey(u);counts.set(key,(counts.get(key)||0)+1);}}
    const shape=[...counts].sort().map(([key,count])=>`${key}:${count}`).join(';');
    if(!shapes.has(shape)){shapes.add(shape);take(row);}
    if(picked.length>=limit)break;
  }
  for(const row of ranked){if(picked.length>=limit)break;take(row);}
  return picked.slice(0,limit);
}

export function runExploreSearch({units,currentIds,bonuses,capacityLimits,fixedQuantities={},maxTierDepth,timeBudgetMs=60_000,onProgress=()=>{}}){
  const started=performance.now(),deadline=started+timeBudgetMs;
  const space=createExploreStructures({units,currentIds,maxTierDepth});
  const fixedNames=new Set(Object.keys(fixedQuantities)),byId=new Map(units.map(u=>[u.id,u]));
  const core=ids=>ids.filter(id=>!fixedNames.has(id)&&!fixedNames.has(byId.get(id)?.name));
  const scoringContext=prepareEpicScoringContext({units,bonuses});
  const score=q=>scoreEpicArmy({units,bonuses,quantities:{...q,...fixedQuantities},scoringContext,recordEvents:false});
  const cache=new Map();let evaluations=0,refinements=0;
  for(const row of space.structures){
    if(performance.now()>started+timeBudgetMs*.45)break;
    let best=null;
    for(const separationPct of [.05,1]){
      const quantities=createLegacyHealthLadderSeed({units,selectedIds:core(row.selectedIds),bonuses,capacityLimits,separationPct,scoringContext});
      // Keep scalar scores rather than thousands of complete battle traces.
      const candidate={...row,quantities,result:{expectedTotalLifetimeDamage:score(quantities).expectedTotalLifetimeDamage}};evaluations++;
      if(!best||eld(candidate)>eld(best))best=candidate;
    }
    cache.set(compositionSignature(row.selectedIds),best);
    if(evaluations%200===0)onProgress({evaluations,progressPct:Math.min(45,(performance.now()-started)/timeBudgetMs*100)});
  }
  const shortlist=diverseExploreRows([...cache.values()],units,96),refined=[];
  for(const row of shortlist){
    if(performance.now()>deadline)break;
    try{
      const trial=optimizeEpicQuantities({units,selectedIds:core(row.selectedIds),bonuses,capacityLimits,initialQuantities:row.quantities,minimumHealthSeparationPct:.01,minimumQuantity:1,stageFractions:[.02,.005,.001],maxRoundsPerStage:3,shouldAbort:()=>performance.now()>deadline});
      const candidate={...row,quantities:trial.quantities,result:score(trial.quantities)};
      const eligible=!bonuses?.preserveMercenaries||mercenaryPreservationStatus(candidate.result).valid;
      if(eligible)refined.push(candidate);refinements++;
      onProgress({evaluations,progressPct:45+55*refinements/shortlist.length});
    }catch(error){if(error.code==='TIME_BUDGET')break;if(!error.message?.startsWith('Initial optimizer seed is not feasible'))throw error;}
  }
  // Completed work survives a deadline. Full optimizations consume these seeds
  // as an additional continuation, while retaining the normal multistart result.
  const finalists=diverseExploreRows(refined.length?refined:shortlist,units,8).map(row=>({selectedIds:row.selectedIds,quantities:row.quantities,screenedEld:eld(row)}));
  return{finalists,evaluations,refinements,uniqueStructures:cache.size,generatedStructures:space.structures.length,elapsedMs:performance.now()-started};
}
