import fs from 'node:fs';
import {createLegacyHealthLadderSeed,optimizeEpicQuantities} from '../js/epic-quantity-optimizer.mjs';
import {scoreEpicArmy} from '../js/epic-combat-engine-v2.mjs';
import {boundedCompositionSearch,compositionSignature} from '../js/epic-composition-search.mjs';

const army=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const byId=new Map(army.map(unit=>[unit.id,unit]));
const bonuses={
  monsterHealthPct:2438.5,monsterStrengthPct:5300.5,strengthAgainstEpicPct:6181,
  monsterDDPct:32,monsterSTPct:30,arachne:true,
  enemySquadTypes:['FLYING','FLYING','MOUNTED','MOUNTED','MELEE','MELEE','RANGED','RANGED'],
  includeMercenariesInOptimization:false,useCustomFamilyBonuses:false
};
const capacityLimits={LEADERSHIP:1_326_786,DOMINANCE:270_245,AUTHORITY:0};
const candidatePool=army.filter(unit=>
  (unit.category==='troop'&&['G9','G8','G7','S9','S8','S7','E9','E8','E7'].includes(unit.tier))||
  (unit.category==='monster'&&['M9','M8','M7'].includes(unit.tier))
).map(unit=>unit.id);

function evaluateSelection(selectedIds){
  const quantities=createLegacyHealthLadderSeed({
    units:army,selectedIds,bonuses,capacityLimits,separationPct:.05
  });
  const result=scoreEpicArmy({units:army,quantities,bonuses});
  return{selectedIds,selectionChanges:candidatePool.length-selectedIds.length,quantities,result};
}

const structuralSeeds=[];
for(const tierNumber of [7,8,9]){
  structuralSeeds.push(candidatePool.filter(id=>!(byId.get(id).category==='troop'&&Number(byId.get(id).tierNumber)===tierNumber)));
  structuralSeeds.push(candidatePool.filter(id=>!(byId.get(id).category==='monster'&&Number(byId.get(id).tierNumber)===tierNumber)));
}

console.error('[arachne] broad structural screen');
const broad=await boundedCompositionSearch({
  candidateIds:candidatePool,initialSelections:structuralSeeds,beamWidth:16,maxEvaluations:500,
  evaluateSelection:async ids=>evaluateSelection(ids)
});
console.error('[arachne] deep greedy structural screen');
const greedy=await boundedCompositionSearch({
  candidateIds:candidatePool,initialSelections:structuralSeeds,beamWidth:1,maxEvaluations:500,
  evaluateSelection:async ids=>evaluateSelection(ids)
});

const screened=[...new Map([...broad.results,...greedy.results]
  .map(candidate=>[compositionSignature(candidate.selectedIds),candidate])).values()]
  .sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage);

// Polish several screen leaders before committing the expensive full optimizer
// to two distinct compositions. This protects against a shallow screen choosing
// the wrong basin, as happened in the Doomsday benchmark.
const polished=[];
for(const [index,candidate] of screened.slice(0,4).entries()){
  console.error(`[arachne] polish ${index+1}/4`);
  const started=performance.now();
  const optimized=optimizeEpicQuantities({
    units:army,selectedIds:candidate.selectedIds,bonuses,capacityLimits,
    initialQuantities:candidate.quantities,minimumHealthSeparationPct:.01,minimumQuantity:1
  });
  polished.push({...candidate,quantities:optimized.quantities,result:optimized.result,elapsedMs:performance.now()-started});
}
polished.sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage);

const finalists=polished.slice(0,2);
const output=[];
for(const [index,finalist] of finalists.entries()){
  console.error(`[arachne] full finalist ${index+1}/2`);
  const started=performance.now();
  let lastPhase='';
  const optimized=optimizeEpicQuantities({
    units:army,selectedIds:finalist.selectedIds,bonuses,capacityLimits,
    minimumHealthSeparationPct:.01,minimumQuantity:1,
    onProgress:progress=>{
      if(progress.phase===lastPhase)return;
      lastPhase=progress.phase;
      console.error(`[arachne finalist ${index+1}] ${progress.phase}`);
    }
  });
  const elapsedMs=performance.now()-started;
  output.push({
    name:`finalist-${index+1}`,
    selectedUnits:finalist.selectedIds.length,
    selectedIds:finalist.selectedIds,
    excluded:candidatePool.filter(id=>!finalist.selectedIds.includes(id)).map(id=>({id,name:byId.get(id)?.name,tier:byId.get(id)?.tier})),
    screenEld:Number(screened.find(candidate=>compositionSignature(candidate.selectedIds)===compositionSignature(finalist.selectedIds))?.result.expectedTotalLifetimeDamage||0),
    polishedEld:Number(finalist.result?.expectedTotalLifetimeDamage||0),
    expectedLifetimeDamage:Number(optimized.result?.expectedTotalLifetimeDamage||0),
    squads:Number(optimized.result?.squads?.length||0),
    elapsedMs,
    diagnostics:optimized.diagnostics
  });
}
output.sort((a,b)=>b.expectedLifetimeDamage-a.expectedLifetimeDamage);

console.log(JSON.stringify({
  generatedAt:new Date().toISOString(),
  inputs:{encounter:'Arachne',enemySquads:8,arachneBonus:true,bonuses,capacityLimits,candidateUnits:candidatePool.length,mercenariesSelected:0},
  screening:{broadEvaluations:broad.evaluations,broadDepths:broad.depths,greedyEvaluations:greedy.evaluations,greedyDepths:greedy.depths,uniqueCandidates:screened.length},
  winner:output[0]?.name,
  eldDifference:Number(output[0]?.expectedLifetimeDamage||0)-Number(output[1]?.expectedLifetimeDamage||0),
  finalists:output
},null,2));
