import assert from 'node:assert/strict';
import {
  DEFAULT_POLICY,analyzeCompositionCandidate,choosePracticalComposition,compositionSignature,
  createCompositionNeighborhood,evaluateSelectionProposal,exhaustiveCompositionSearch,
  exhaustiveGroupCompositionSearch,boundedCompositionSearch
} from '../js/epic-composition-search.mjs';

function candidate({ids,eld,squads}){
  return{selectedIds:ids,result:{expectedTotalLifetimeDamage:eld,capacities:{LEADERSHIP:100_000},squads:squads.map(row=>({capacityType:'LEADERSHIP',...row}))}};
}

const simple=candidate({ids:['a','b'],eld:1_000_000,squads:[
  {id:'a',name:'A',quantity:100,capacityUsed:60_000,expectedLifetimeDamage:600_000},
  {id:'b',name:'B',quantity:100,capacityUsed:40_000,expectedLifetimeDamage:400_000}
]});
const noisy=candidate({ids:['a','b','c','d'],eld:1_000_400,squads:[
  {id:'a',name:'A',quantity:100,capacityUsed:59_980,expectedLifetimeDamage:599_900},
  {id:'b',name:'B',quantity:100,capacityUsed:39_980,expectedLifetimeDamage:400_000},
  {id:'c',name:'C',quantity:1,capacityUsed:20,expectedLifetimeDamage:250},
  {id:'d',name:'D',quantity:1,capacityUsed:20,expectedLifetimeDamage:250}
]});

const noisyAnalysis=analyzeCompositionCandidate(noisy);
assert.equal(noisyAnalysis.microSquads,2,'Negligible capacity and damage squads must be classified as micro squads');
const practical=choosePracticalComposition([simple,noisy]);
assert.deepEqual(practical.mathematicalMaximum.selectedIds,noisy.selectedIds,'The raw mathematical maximum must remain available for diagnostics');
assert.deepEqual(practical.chosen.selectedIds,simple.selectedIds,'A simpler army within the 0.05% practical tie must win');
assert.ok(practical.eldLossPct>.039&&practical.eldLossPct<.041,'The practical ELD tradeoff must be reported');

const tinyProposal=evaluateSelectionProposal({currentCandidate:simple,proposedCandidate:candidate({ids:['a'],eld:1_000_001,squads:[{id:'a',name:'A',quantity:100,capacityUsed:100_000,expectedLifetimeDamage:1_000_001}]})});
assert.equal(tinyProposal.shouldPrompt,false,'A negligible selection improvement must not prompt the user');
const meaningfulProposal=evaluateSelectionProposal({currentCandidate:simple,proposedCandidate:candidate({ids:['a'],eld:1_001_000,squads:[{id:'a',name:'A',quantity:100,capacityUsed:100_000,expectedLifetimeDamage:1_001_000}]})});
assert.equal(meaningfulProposal.shouldPrompt,true,'A selection change above the minimum improvement threshold must prompt the user');

const syntheticValues=new Map([
  ['a',800],['b',700],['c',100]
]);
const exhaustive=await exhaustiveCompositionSearch({candidateIds:['a','b','c'],evaluateSelection:async ids=>({result:{expectedTotalLifetimeDamage:ids.reduce((sum,id)=>sum+syntheticValues.get(id),0),capacities:{},squads:ids.map(id=>({id,name:id,quantity:1,expectedLifetimeDamage:syntheticValues.get(id)}))}})});
assert.equal(exhaustive.evaluations,7,'Three optional units must produce seven non-empty compositions');
assert.equal(Math.max(...exhaustive.results.map(row=>row.result.expectedTotalLifetimeDamage)),1600,'Exhaustive search must retain the mathematical maximum');
const bounded=await boundedCompositionSearch({candidateIds:['a','b','c'],beamWidth:8,maxEvaluations:20,evaluateSelection:async ids=>({result:{expectedTotalLifetimeDamage:ids.reduce((sum,id)=>sum+syntheticValues.get(id),0),capacities:{},squads:ids.map(id=>({id,name:id,quantity:1,expectedLifetimeDamage:syntheticValues.get(id)}))}})});
assert.equal(Math.max(...bounded.results.map(row=>row.result.expectedTotalLifetimeDamage)),1600,'Bounded search must match the exhaustive maximum when its budget covers the small pool');
assert.ok(bounded.evaluations<=20,'Bounded search must respect its evaluation budget');
const seeded=await boundedCompositionSearch({candidateIds:['a','b','c'],initialSelections:[['a']],beamWidth:1,maxEvaluations:4,evaluateSelection:async ids=>({result:{expectedTotalLifetimeDamage:ids.length===1&&ids[0]==='a'?2000:ids.reduce((sum,id)=>sum+syntheticValues.get(id),0),capacities:{},squads:ids.map(id=>({id,name:id,quantity:1,expectedLifetimeDamage:1}))}})});
assert.ok(seeded.results.some(row=>compositionSignature(row.selectedIds)==='a'),'Bounded search must evaluate supplied structural starting selections');
assert.equal(Math.max(...seeded.results.map(row=>row.result.expectedTotalLifetimeDamage)),2000,'A strong structural seed must be able to enter the beam');
const fixedMercenary=await exhaustiveCompositionSearch({candidateIds:['troop-a','troop-b'],mandatoryIds:['merc-owned'],evaluateSelection:async ids=>({result:{expectedTotalLifetimeDamage:ids.length,capacities:{},squads:ids.map(id=>({id,name:id,quantity:1,expectedLifetimeDamage:1}))}})});
assert.ok(fixedMercenary.results.every(row=>row.selectedIds.includes('merc-owned')),'Fixed selected mercenaries must remain in every explored composition');
assert.ok(fixedMercenary.results.every(row=>row.selectedIds.every(id=>['troop-a','troop-b','merc-owned'].includes(id))),'Composition search must never add an unselected mercenary');
const grouped=await exhaustiveGroupCompositionSearch({groups:[{id:'tier-1',unitIds:['a','b']},{id:'tier-2',unitIds:['c']}],evaluateSelection:async ids=>({result:{expectedTotalLifetimeDamage:ids.length}})});
assert.equal(grouped.evaluations,3,'Two tier groups must produce three non-empty group structures');
assert.ok(grouped.results.some(row=>compositionSignature(row.selectedIds)==='a|b|c'),'Grouped search must include the complete tier structure');
const neighborhood=createCompositionNeighborhood({selectedIds:['a','b'],candidateIds:['a','b','c']});
assert.deepEqual(neighborhood.map(compositionSignature).sort(),['a','a|b|c','a|c','b','b|c'],'Neighborhood must contain every one-unit add, remove, and swap');
assert.equal(DEFAULT_POLICY.practicalTiePct,.05);
assert.equal(DEFAULT_POLICY.minimumProposalImprovementPct,.05);

console.log(JSON.stringify({ok:true,practicalTiePct:DEFAULT_POLICY.practicalTiePct,minimumProposalImprovementPct:DEFAULT_POLICY.minimumProposalImprovementPct}));
