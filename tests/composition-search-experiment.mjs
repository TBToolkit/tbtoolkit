import fs from 'node:fs';
import {createLegacyHealthLadderSeed,optimizeEpicQuantities} from '../js/epic-quantity-optimizer.mjs';
import {scoreEpicArmy} from '../js/epic-combat-engine-v2.mjs';
import {boundedCompositionSearch,choosePracticalComposition,compositionSignature,evaluateSelectionProposal,exhaustiveCompositionSearch} from '../js/epic-composition-search.mjs';

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

// User-provided Doomsday test case (September 2, 2026).
const userBonuses={
  monsterHealthPct:1637.5,monsterStrengthPct:2032,strengthAgainstEpicPct:3877,
  monsterDDPct:12,monsterSTPct:18,arachne:false,
  enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED'],
  includeMercenariesInOptimization:false,useCustomFamilyBonuses:false
};
const userCapacityLimits={LEADERSHIP:407_082,DOMINANCE:76_212,AUTHORITY:0};
const userPool=army.filter(unit=>
  (unit.category==='troop'&&['G9','G8','G7','S9','S8','S7','E9','E8','E7'].includes(unit.tier))||
  (unit.category==='monster'&&['M9','M8','M7'].includes(unit.tier))
).map(unit=>unit.id);
function evaluateUserSelection(ids){
  const quantities=createLegacyHealthLadderSeed({units:army,selectedIds:ids,bonuses:userBonuses,capacityLimits:userCapacityLimits,separationPct:.05});
  const result=scoreEpicArmy({units:army,quantities,bonuses:userBonuses});
  return{selectedIds:ids,selectionChanges:userPool.length-ids.length,quantities,result};
}
const userStructuralSeeds=[];
for(const tierNumber of [7,8,9]){
  userStructuralSeeds.push(userPool.filter(id=>!(byId.get(id).category==='troop'&&Number(byId.get(id).tierNumber)===tierNumber)));
  userStructuralSeeds.push(userPool.filter(id=>!(byId.get(id).category==='monster'&&Number(byId.get(id).tierNumber)===tierNumber)));
}
const userBounded=await boundedCompositionSearch({candidateIds:userPool,initialSelections:userStructuralSeeds,beamWidth:16,maxEvaluations:500,evaluateSelection:async ids=>evaluateUserSelection(ids)});
const userDeepGreedy=await boundedCompositionSearch({candidateIds:userPool,initialSelections:userStructuralSeeds,beamWidth:1,maxEvaluations:500,evaluateSelection:async ids=>evaluateUserSelection(ids)});
const combinedUserScreens=[...new Map([...userBounded.results,...userDeepGreedy.results].map(candidate=>[compositionSignature(candidate.selectedIds),candidate])).values()];
const userManualSelection=userPool.filter(id=>{
  const unit=byId.get(id);
  if(unit.category==='troop'&&Number(unit.tierNumber)===7)return false;
  if(unit.id==='monster-m7-flying-black-dragon')return false;
  return true;
});
const userManualScreen=evaluateUserSelection(userManualSelection);
const userScreenFinalists=combinedUserScreens.slice().sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage).slice(0,3);
const userCurrentScreen=evaluateUserSelection(userPool);
const userCurrentStarted=performance.now();
const userCurrentOptimized=optimizeEpicQuantities({units:army,selectedIds:userPool,bonuses:userBonuses,capacityLimits:userCapacityLimits,initialQuantities:userCurrentScreen.quantities,minimumHealthSeparationPct:.01,minimumQuantity:1});
const userCurrent={selectedIds:userPool,selectionChanges:0,quantities:userCurrentOptimized.quantities,result:userCurrentOptimized.result,elapsedMs:performance.now()-userCurrentStarted};
const userPolished=[];
for(const finalist of userScreenFinalists){
  const started=performance.now();
  // Composition experiments use a bounded local quantity polish from the
  // deterministic screen seed. Running the entire deep optimizer for every
  // composition would multiply a full optimizer run by the finalist count.
  const optimized=optimizeEpicQuantities({units:army,selectedIds:finalist.selectedIds,bonuses:userBonuses,capacityLimits:userCapacityLimits,initialQuantities:finalist.quantities,minimumHealthSeparationPct:.01,minimumQuantity:1});
  userPolished.push({selectedIds:finalist.selectedIds,selectionChanges:finalist.selectionChanges,quantities:optimized.quantities,result:optimized.result,elapsedMs:performance.now()-started,optimizerDiagnostics:optimized.diagnostics});
}
const userPracticalDecision=choosePracticalComposition(userPolished,{practicalTiePct:.05});
const userProposal=evaluateSelectionProposal({currentCandidate:userCurrent,proposedCandidate:userPracticalDecision.chosen});

const report={
  generatedAt:new Date().toISOString(),
  purpose:'Offline composition threshold screening using deterministic legacy-ladder seeds and the exact Epic combat scorer. This screens composition policy; it does not claim fully optimized quantities.',
  defaults:{capacityLimits,bonuses},
  smallPool:{units:smallPool.map(id=>({id,name:byId.get(id).name,tier:byId.get(id).tier})),screenEvaluations:small.evaluations,screenThresholds:thresholdTable(small.results),polishedFinalists:smallPolished.length,polishedThresholds:thresholdTable(smallPolished)},
  realisticPool:{candidateUnits:realisticPool.length,sampledEvaluations:realistic.length,sampledThresholds:thresholdTable(realistic),boundedEvaluations:realisticBounded.evaluations,boundedDepths:realisticBounded.depths,boundedThresholds:thresholdTable(realisticBounded.results)},
  userDoomsdayCase:{
    candidateUnits:userPool.length,
    selectedTiers:['G9','G8','G7','S9','S8','S7','E9','E8','E7','M9','M8','M7'],
    mercenariesSelected:0,
    includeMercenariesInOptimization:false,
    capacityLimits:userCapacityLimits,
    bonuses:userBonuses,
    boundedEvaluations:userBounded.evaluations,
    boundedDepths:userBounded.depths,
    deepGreedyEvaluations:userDeepGreedy.evaluations,
    deepGreedyDepths:userDeepGreedy.depths,
    screenThresholds:thresholdTable(combinedUserScreens),
    manualBenchmark:{selectedUnits:userManualSelection.length,screenEld:userManualScreen.result.expectedTotalLifetimeDamage,foundBySearch:combinedUserScreens.some(candidate=>compositionSignature(candidate.selectedIds)===compositionSignature(userManualSelection)),excluded:userPool.filter(id=>!userManualSelection.includes(id)).map(id=>({id,name:byId.get(id)?.name,tier:byId.get(id)?.tier}))},
    finalistPolishMode:'bounded local quantity polish from each deterministic screen seed',
    currentSelection:{eld:userCurrent.result.expectedTotalLifetimeDamage,squads:userCurrent.result.squads.length,elapsedMs:userCurrent.elapsedMs},
    polishedFinalists:userPolished.map(candidate=>({selectedUnits:candidate.selectedIds.length,excludedUnits:userPool.length-candidate.selectedIds.length,eld:candidate.result.expectedTotalLifetimeDamage,squads:candidate.result.squads.length,microSquads:choosePracticalComposition([candidate])?.chosen.microSquads,elapsedMs:candidate.elapsedMs,signature:compositionSignature(candidate.selectedIds)})),
    polishedThresholds:thresholdTable(userPolished),
    proposedSelection:{
      shouldPrompt:userProposal.shouldPrompt,
      improvementPct:userProposal.improvementPct,
      selectedUnits:userProposal.proposed.selectedIds.length,
      excluded:userProposal.excluded.map(id=>({id,name:byId.get(id)?.name,tier:byId.get(id)?.tier})),
      added:userProposal.added.map(id=>({id,name:byId.get(id)?.name,tier:byId.get(id)?.tier}))
    }
  }
};
console.log(JSON.stringify(report,null,2));
