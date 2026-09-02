import fs from 'node:fs';
import {createLegacyHealthLadderSeed,optimizeEpicQuantities} from '../js/epic-quantity-optimizer.mjs';
import {scoreEpicArmy} from '../js/epic-combat-engine-v2.mjs';
import {boundedCompositionSearch,choosePracticalComposition,compositionSignature,exhaustiveCompositionSearch} from '../js/epic-composition-search.mjs';

const army=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const bonuses={
  monsterHealthPct:1600,monsterStrengthPct:2000,strengthAgainstEpicPct:2000,
  monsterDDPct:10,monsterSTPct:10,arachne:false,
  enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED'],
  includeMercenariesInOptimization:false,useCustomFamilyBonuses:false
};
const capacityLimits={LEADERSHIP:365_000,DOMINANCE:75_000,AUTHORITY:0};
const byId=new Map(army.map(unit=>[unit.id,unit]));

function evaluateSelection(ids,baselineIds){
  const selected=ids.map(id=>byId.get(id)).filter(Boolean);
  const quantities=createLegacyHealthLadderSeed({units:army,selectedIds:ids,bonuses,capacityLimits,separationPct:.05});
  const result=scoreEpicArmy({units:army,quantities,bonuses});
  const baseline=new Set(baselineIds);
  return{selectedIds:ids,selectionChanges:baselineIds.filter(id=>!ids.includes(id)).length+ids.filter(id=>!baseline.has(id)).length,quantities,result};
}

function thresholdTable(results){
  return[.01,.025,.05,.10].map(practicalTiePct=>{
    const decision=choosePracticalComposition(results,{practicalTiePct});
    return{
      practicalTiePct,
      mathematicalEld:decision.mathematicalMaximum.eld,
      chosenEld:decision.chosen.eld,
      eldLossPct:decision.eldLossPct,
      squads:decision.chosen.squadCount,
      microSquads:decision.chosen.microSquads,
      excluded:decision.mathematicalMaximum.selectedIds.filter(id=>!decision.chosen.selectedIds.includes(id)).length,
      eligible:decision.eligibleCount,
      chosenSignature:compositionSignature(decision.chosen.selectedIds)
    };
  });
}

const smallPool=army.filter(unit=>
  (unit.category==='troop'&&['G9','S9'].includes(unit.tier)&&['FLYING','MOUNTED'].includes(unit.combatType))||
  (unit.category==='monster'&&unit.tier==='M9'&&['FLYING','MOUNTED'].includes(unit.combatType))
).slice(0,6).map(unit=>unit.id);
const small=await exhaustiveCompositionSearch({candidateIds:smallPool,evaluateSelection:async ids=>evaluateSelection(ids,smallPool)});
const smallScreenFinalists=small.results.slice().sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage).slice(0,3);
const smallPolished=smallScreenFinalists.map(finalist=>{
  const optimized=optimizeEpicQuantities({units:army,selectedIds:finalist.selectedIds,bonuses,capacityLimits,minimumHealthSeparationPct:.01,minimumQuantity:1});
  return{selectedIds:finalist.selectedIds,selectionChanges:finalist.selectionChanges,quantities:optimized.quantities,result:optimized.result};
});

const realisticPool=army.filter(unit=>
  (unit.category==='troop'&&['G9','S9','E9'].includes(unit.tier))||
  (unit.category==='monster'&&['M9','M8'].includes(unit.tier))
).map(unit=>unit.id);
const realisticSelections=new Map();
const addSelection=ids=>realisticSelections.set(compositionSignature(ids),[...ids].sort());
addSelection(realisticPool);
for(let i=0;i<realisticPool.length;i++)addSelection(realisticPool.filter((_,index)=>index!==i));
for(let i=0;i<realisticPool.length;i++)for(let j=i+1;j<realisticPool.length;j++)addSelection(realisticPool.filter((_,index)=>index!==i&&index!==j));
for(const tier of ['G9','S9','E9','M9','M8'])addSelection(realisticPool.filter(id=>byId.get(id).tier!==tier));
const realistic=[...realisticSelections.values()].filter(ids=>ids.length).map(ids=>evaluateSelection(ids,realisticPool));
const realisticBounded=await boundedCompositionSearch({candidateIds:realisticPool,beamWidth:12,maxEvaluations:250,evaluateSelection:async ids=>evaluateSelection(ids,realisticPool)});

const report={
  generatedAt:new Date().toISOString(),
  purpose:'Offline composition threshold screening using deterministic legacy-ladder seeds and the exact Epic combat scorer. This screens composition policy; it does not claim fully optimized quantities.',
  defaults:{capacityLimits,bonuses},
  smallPool:{units:smallPool.map(id=>({id,name:byId.get(id).name,tier:byId.get(id).tier})),screenEvaluations:small.evaluations,screenThresholds:thresholdTable(small.results),polishedFinalists:smallPolished.length,polishedThresholds:thresholdTable(smallPolished)},
  realisticPool:{candidateUnits:realisticPool.length,sampledEvaluations:realistic.length,sampledThresholds:thresholdTable(realistic),boundedEvaluations:realisticBounded.evaluations,boundedDepths:realisticBounded.depths,boundedThresholds:thresholdTable(realisticBounded.results)}
};
console.log(JSON.stringify(report,null,2));
