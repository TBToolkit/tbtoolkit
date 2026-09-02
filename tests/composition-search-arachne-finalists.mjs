import fs from 'node:fs';
import {createLegacyHealthLadderSeed,optimizeEpicQuantities} from '../js/epic-quantity-optimizer.mjs';
import {scoreEpicArmy} from '../js/epic-combat-engine-v2.mjs';
import {compositionSignature,createCompositionNeighborhood,exhaustiveGroupCompositionSearch} from '../js/epic-composition-search.mjs';

const army=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const byId=new Map(army.map(unit=>[unit.id,unit]));
const bonuses={monsterHealthPct:2438.5,monsterStrengthPct:5300.5,strengthAgainstEpicPct:6181,monsterDDPct:32,monsterSTPct:30,arachne:true,enemySquadTypes:['FLYING','FLYING','MOUNTED','MOUNTED','MELEE','MELEE','RANGED','RANGED'],includeMercenariesInOptimization:false,useCustomFamilyBonuses:false};
const capacityLimits={LEADERSHIP:1_326_786,DOMINANCE:270_245,AUTHORITY:0};
const tiers=['G9','G8','G7','S9','S8','S7','E9','E8','E7','M9','M8','M7'];
const groups=tiers.map(tier=>({id:tier,unitIds:army.filter(unit=>unit.tier===tier).map(unit=>unit.id)}));
const candidatePool=groups.flatMap(group=>group.unitIds);

function roughEvaluate(selectedIds){
  const quantities=createLegacyHealthLadderSeed({units:army,selectedIds,bonuses,capacityLimits,separationPct:.05});
  return{selectedIds,quantities,result:scoreEpicArmy({units:army,quantities,bonuses})};
}
function unique(candidates){return[...new Map(candidates.map(row=>[compositionSignature(row.selectedIds),row])).values()];}
function byEld(a,b){return Number(b.result?.expectedTotalLifetimeDamage||0)-Number(a.result?.expectedTotalLifetimeDamage||0);}
function summarize(candidate){return{selectedUnits:candidate.selectedIds.length,tiers:[...new Set(candidate.selectedIds.map(id=>byId.get(id)?.tier))].filter(Boolean).sort(),excluded:candidatePool.filter(id=>!candidate.selectedIds.includes(id)).map(id=>({id,name:byId.get(id)?.name,tier:byId.get(id)?.tier})),eld:Number(candidate.result?.expectedTotalLifetimeDamage||0),squads:Number(candidate.result?.squads?.length||0)};}
function intermediateOptimize(candidate){
  const optimized=optimizeEpicQuantities({units:army,selectedIds:candidate.selectedIds,bonuses,capacityLimits,initialQuantities:candidate.quantities,minimumHealthSeparationPct:.01,minimumQuantity:1});
  return{selectedIds:candidate.selectedIds,quantities:optimized.quantities,result:optimized.result};
}
function fullOptimize(candidate,label){
  const started=performance.now();let lastPhase='';
  const optimized=optimizeEpicQuantities({units:army,selectedIds:candidate.selectedIds,bonuses,capacityLimits,minimumHealthSeparationPct:.01,minimumQuantity:1,onProgress:progress=>{if(progress.phase===lastPhase)return;lastPhase=progress.phase;console.error(`[${label}] ${progress.phase}`);}});
  return{selectedIds:candidate.selectedIds,quantities:optimized.quantities,result:optimized.result,elapsedMs:performance.now()-started,diagnostics:{evaluations:optimized.diagnostics?.totalEvaluations,practicalTieBreakApplied:optimized.diagnostics?.practicalTieBreakApplied,maximumExpectedLifetimeDamage:optimized.diagnostics?.maximumExpectedLifetimeDamage}};
}

console.error('[arachne] stage 1/5: exhaustive tier structures');
const tierSearch=await exhaustiveGroupCompositionSearch({groups,evaluateSelection:async ids=>roughEvaluate(ids)});
const tierRanked=tierSearch.results.sort(byEld);

console.error('[arachne] stage 2/5: unit neighborhoods');
const neighborhoodRows=[];
for(const parent of tierRanked.slice(0,8)){
  neighborhoodRows.push(parent);
  for(const ids of createCompositionNeighborhood({selectedIds:parent.selectedIds,candidateIds:candidatePool}))neighborhoodRows.push(roughEvaluate(ids));
}
const neighborhoodRanked=unique(neighborhoodRows).sort(byEld);

console.error('[arachne] stage 3/5: intermediate quantity refinement');
const promotionPool=unique([...neighborhoodRanked.slice(0,20),...tierRanked.slice(0,12)]);
const intermediate=[];
for(const [index,candidate] of promotionPool.entries()){
  if(index%8===0)console.error(`[arachne] intermediate ${index+1}/${promotionPool.length}`);
  intermediate.push(intermediateOptimize(candidate));
}
intermediate.sort(byEld);

console.error('[arachne] stage 4/5: full finalists');
const deep=[];
for(const [index,candidate] of intermediate.slice(0,4).entries())deep.push(fullOptimize(candidate,`arachne finalist ${index+1}`));
deep.sort(byEld);

console.error('[arachne] stage 5/5: winning-neighborhood audit');
const winner=deep[0];
const auditRough=createCompositionNeighborhood({selectedIds:winner.selectedIds,candidateIds:candidatePool}).map(ids=>roughEvaluate(ids)).sort(byEld);
const auditIntermediate=auditRough.slice(0,16).map(intermediateOptimize).sort(byEld);
const challenger=auditIntermediate.find(row=>compositionSignature(row.selectedIds)!==compositionSignature(winner.selectedIds));
if(challenger)deep.push(fullOptimize(challenger,'arachne audit challenger'));
deep.sort(byEld);

// Benchmark assertion only: this structure is never supplied to the search.
const benchmarkIds=candidatePool.filter(id=>!['G7','S7','E7'].includes(byId.get(id)?.tier));
const benchmarkSignature=compositionSignature(benchmarkIds);
const benchmarkTierRank=tierRanked.findIndex(row=>compositionSignature(row.selectedIds)===benchmarkSignature)+1;
const benchmarkPromoted=promotionPool.some(row=>compositionSignature(row.selectedIds)===benchmarkSignature);
const benchmarkDeepOptimized=deep.some(row=>compositionSignature(row.selectedIds)===benchmarkSignature);
if(benchmarkTierRank!==1||!benchmarkPromoted||!benchmarkDeepOptimized)throw new Error(`Arachne benchmark was not independently discovered (tier rank ${benchmarkTierRank}, promoted ${benchmarkPromoted}, deep ${benchmarkDeepOptimized}).`);

console.log(JSON.stringify({generatedAt:new Date().toISOString(),inputs:{encounter:'Arachne',enemySquads:8,arachneBonus:true,bonuses,capacityLimits,candidateUnits:candidatePool.length,mercenariesSelected:0},stages:{tierStructures:tierSearch.evaluations,tierLeadersExpanded:8,unitNeighborhoods:neighborhoodRanked.length,intermediateCandidates:promotionPool.length,deepFinalists:4,auditCandidates:Math.min(16,auditRough.length),auditDeepChallengers:challenger?1:0},benchmark:{tierRank:benchmarkTierRank,promoted:benchmarkPromoted,deepOptimized:benchmarkDeepOptimized},winner:summarize(deep[0]),deepResults:deep.map(row=>({...summarize(row),elapsedMs:row.elapsedMs,diagnostics:row.diagnostics}))},null,2));
