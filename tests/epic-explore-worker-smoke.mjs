import assert from 'node:assert/strict';
import fs from 'node:fs';
import {APP_BUILD} from '../js/build-info.mjs';

const army=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const selectedIds=[army.find(unit=>unit.tier==='G9'&&unit.combatType==='MELEE'),army.find(unit=>unit.tier==='M9'&&unit.combatType==='MELEE')].map(unit=>unit.id);
const messages=[];
globalThis.self={postMessage:message=>messages.push(message)};
globalThis.fetch=async()=>({ok:true,json:async()=>army});
await import('../js/epic-optimizer-worker.mjs');
await self.onmessage({data:{type:'optimize',requestId:1,appBuild:APP_BUILD,selectedIds,exploreMode:true,exploreTierDepth:0,timeBudgetMs:120_000,baselineResult:{result:{expectedTotalLifetimeDamage:1e99},exploredSelectedIds:['stale'],exploration:{changedSelection:true}},bonuses:{monsterHealthPct:1600,monsterStrengthPct:2000,strengthAgainstEpicPct:2000,monsterDDPct:10,monsterSTPct:10,arachne:false,enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED'],includeMercenariesInOptimization:false,useCustomFamilyBonuses:false},capacityLimits:{LEADERSHIP:10000,DOMINANCE:10000,AUTHORITY:0}}});
const failure=messages.find(message=>message.type==='error');
assert.equal(failure,undefined,failure?.message);
const output=messages.find(message=>message.type==='result')?.payload;
assert.ok(output,'Explore worker must return a result');
const cachedBaselineProgress=messages.find(message=>message.requestId===1&&message.type==='progress'&&message.payload?.exploreStage==='baseline-ready')?.payload;
assert.ok(cachedBaselineProgress?.verifiedBestEld<1e99,'The user baseline must not steer the canonical search.');
assert.ok(output.exploration.fullyOptimizedCandidates>0,'Explore worker must fully optimize at least one alternate composition');
assert.equal(output.exploration.changedSelection,false,'A candidate with lower full-optimizer ELD must not replace the baseline');
assert.equal(output.exploredSelectedIds,undefined,'A reused baseline must not carry forward stale selection-change metadata');
assert.equal(output.result.expectedTotalLifetimeDamage,1e99,'The baseline result must be returned unchanged when all finalists lose');
await self.onmessage({data:{type:'optimize',requestId:2,appBuild:APP_BUILD,selectedIds,exploreMode:true,exploreTierDepth:0,timeBudgetMs:120_000,bonuses:{monsterHealthPct:1600,monsterStrengthPct:2000,strengthAgainstEpicPct:2000,monsterDDPct:10,monsterSTPct:10,arachne:false,enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED'],includeMercenariesInOptimization:false,useCustomFamilyBonuses:false},capacityLimits:{LEADERSHIP:10000,DOMINANCE:10000,AUTHORITY:0}}});
const freshFailure=messages.find(message=>message.requestId===2&&message.type==='error');
assert.equal(freshFailure,undefined,freshFailure?.message);
const fresh=messages.find(message=>message.requestId===2&&message.type==='result')?.payload;
assert.ok(fresh?.exploration.fullyOptimizedCandidates>0,'Explore must run full optimization even without a cached baseline');
const freshBaselineProgress=messages.find(message=>message.requestId===2&&message.type==='progress'&&message.payload?.exploreStage==='baseline-ready')?.payload;
assert.ok(freshBaselineProgress?.healthLadder?.length>0,'A fresh baseline must send its optimized health ladder before screening.');
assert.ok(messages.some(message=>message.requestId===2&&message.type==='progress'&&message.payload?.exploreStage==='finalist-complete'),'Each fully optimized finalist must announce its confirmed result.');
assert.ok(fresh.exploration.finalEld>=fresh.exploration.baselineEld,'The integrated result must never be worse than its fully optimized baseline');
console.log(JSON.stringify({ok:true,fullyOptimizedCandidates:output.exploration.fullyOptimizedCandidates,screenedCandidates:output.exploration.screenedCandidates,freshBaseline:Math.round(fresh.exploration.baselineEld),freshFinal:Math.round(fresh.exploration.finalEld)}));

const mercenary=army.find(unit=>unit.category==='mercenary'&&unit.tierNumber===2);
await self.onmessage({data:{type:'optimize',requestId:3,appBuild:APP_BUILD,selectedIds,exploreMode:true,exploreTierDepth:0,timeBudgetMs:120_000,fixedMercenaryIds:[mercenary.id],fixedQuantities:{[mercenary.name]:7},fixedAuthorityMaximum:mercenary.capacityCost*7,bonuses:{monsterHealthPct:1600,monsterStrengthPct:2000,strengthAgainstEpicPct:2000,monsterDDPct:10,monsterSTPct:10,arachne:false,enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED'],includeMercenariesInOptimization:false,useCustomFamilyBonuses:false},capacityLimits:{LEADERSHIP:10000,DOMINANCE:10000,AUTHORITY:0}}});
assert.equal(messages.find(m=>m.requestId===3&&m.type==='error'),undefined);
const fixed=messages.find(m=>m.requestId===3&&m.type==='result')?.payload;
assert.equal(fixed?.result.squads.find(s=>s.id===mercenary.id)?.quantity,7,'Explore must preserve fixed mercenary quantities');
assert.ok(fixed.exploration.finalEld>=fixed.exploration.baselineEld);
console.log('Explore with fixed mercenaries passed.');

assert.ok(fresh.exploreResults.armies.length>=2,'Worker must return a baseline plus completed finalists');
assert.equal(fresh.exploreResults.armies[0].label,'Starting army');
assert.ok(fresh.exploreResults.armies.some(a=>a.id===fresh.exploreResults.activeId),'The chosen army must be in the comparison');
assert.equal(new Set(fresh.exploreResults.armies.map(a=>a.id)).size,fresh.exploreResults.armies.length);
for(const army of fixed.exploreResults.armies){assert.equal(army.payload.result.squads.find(s=>s.id===mercenary.id)?.quantity,7);assert.equal(army.payload.result.cases,undefined);assert.equal(army.payload.exploreResults,undefined);}
console.log('Explore worker retains completed finalist payloads, including fixed mercenaries.');

assert.equal(output.exploration.canonicalFinalEld,fresh.exploration.canonicalFinalEld,'A stronger user finalist must not steer the canonical search');
assert.deepEqual(output.exploration.canonicalSelectedIds,fresh.exploration.canonicalSelectedIds);
assert.equal(fresh.exploration.userArmyCompleted,true);
const canonicalIds=army.filter(u=>['G9','M9'].includes(u.tier)).map(u=>u.id);
const common={type:'optimize',appBuild:APP_BUILD,exploreMode:true,exploreTierDepth:0,timeBudgetMs:120000,bonuses:{monsterHealthPct:1600,monsterStrengthPct:2000,strengthAgainstEpicPct:2000,monsterDDPct:10,monsterSTPct:10,arachne:false,enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED'],includeMercenariesInOptimization:false,useCustomFamilyBonuses:false},capacityLimits:{LEADERSHIP:10000,DOMINANCE:10000,AUTHORITY:0}};
await self.onmessage({data:{...common,requestId:4,selectedIds:canonicalIds}});
assert.equal(messages.find(m=>m.requestId===4&&m.type==='error'),undefined);
const canonicalRun=messages.find(m=>m.requestId===4&&m.type==='result').payload;
assert.equal(canonicalRun.exploration.canonicalFinalEld,fresh.exploration.canonicalFinalEld,'Full and partial highest-tier selections must search from the same origin');
assert.deepEqual(canonicalRun.exploreResults.armies.filter(a=>a.label.startsWith('Finalist')).map(a=>a.id),fresh.exploreResults.armies.filter(a=>a.label.startsWith('Finalist')).map(a=>a.id));
await self.onmessage({data:{...common,requestId:5,selectedIds:[...selectedIds,mercenary.id],bonuses:{...common.bonuses,includeMercenariesInOptimization:true},capacityLimits:{...common.capacityLimits,AUTHORITY:mercenary.capacityCost*100}}});
assert.equal(messages.find(m=>m.requestId===5&&m.type==='error'),undefined);
const optimizedMercs=messages.find(m=>m.requestId===5&&m.type==='result').payload;
assert.ok(optimizedMercs.exploreResults.armies.every(a=>a.selectedIds.includes(mercenary.id)));
assert.ok(optimizedMercs.exploreResults.armies.every(a=>a.selectedIds.filter(id=>army.find(u=>u.id===id).category==='mercenary').length===1));
console.log('Canonical finalists are independent of initial selections and preserve explicitly selected optimized mercenaries.');
const nearTie={...canonicalRun,result:{...canonicalRun.result,expectedTotalLifetimeDamage:canonicalRun.result.expectedTotalLifetimeDamage+1}};
await self.onmessage({data:{...common,requestId:6,selectedIds:canonicalIds,baselineResult:nearTie}});
assert.equal(messages.find(m=>m.requestId===6&&m.type==='error'),undefined);
const retained=messages.find(m=>m.requestId===6&&m.type==='result').payload;
assert.equal(retained.result.expectedTotalLifetimeDamage,nearTie.result.expectedTotalLifetimeDamage,'Retain the user army even for a lead smaller than the search comparison tolerance');

const mixedTopIds=army.filter(u=>['G9','S8','E9','M9'].includes(u.tier)).map(u=>u.id);
const mixedDepths={guardsman:0,specialist:1,engineer:2,monster:1};
await self.onmessage({data:{...common,requestId:7,selectedIds:mixedTopIds,exploreTierDepths:mixedDepths}});
assert.equal(messages.find(m=>m.requestId===7&&m.type==='error'),undefined);
const mixed=messages.find(m=>m.requestId===7&&m.type==='result').payload;
assert.ok(mixed.exploration.fullyOptimizedCandidates>0);
const topTiers={guardsman:9,specialist:8,engineer:9,monster:9};
for(const finalist of mixed.exploreResults.armies){
  for(const id of finalist.selectedIds){
    const u=army.find(u=>u.id===id),family=u.category==='monster'?'monster':u.unitClass.toLowerCase();
    assert.ok(u.tierNumber<=topTiers[family]&&u.tierNumber>=topTiers[family]-mixedDepths[family],`${finalist.label}: ${u.tier} must respect ${family}'s depth`);
  }
}
console.log('Integrated Explore respects four independent tier ranges.');

const keepIds=[army.find(u=>u.tier==='G9').id,army.find(u=>u.tier==='G7').id,...army.filter(u=>['S8','E9','M9'].includes(u.tier)).map(u=>u.id)];
const keepDepths={guardsman:'selected',specialist:1,engineer:'selected',monster:0};
await self.onmessage({data:{...common,requestId:8,selectedIds:keepIds,exploreTierDepths:keepDepths}});
assert.equal(messages.find(m=>m.requestId===8&&m.type==='error'),undefined);
const kept=messages.find(m=>m.requestId===8&&m.type==='result').payload;
const familyIds=(ids,family)=>ids.filter(id=>army.find(u=>u.id===id).unitClass===family).sort();
for(const finalist of kept.exploreResults.armies)for(const family of ['GUARDSMAN','ENGINEER'])assert.deepEqual(familyIds(finalist.selectedIds,family),familyIds(keepIds,family),finalist.label+' must keep locked types');
const allKept=Object.fromEntries(['guardsman','specialist','engineer','monster'].map(f=>[f,'selected']));
await self.onmessage({data:{...common,requestId:9,selectedIds,exploreTierDepths:allKept}});
assert.equal(messages.find(m=>m.requestId===9&&m.type==='error'),undefined);
const onlySelected=messages.find(m=>m.requestId===9&&m.type==='result').payload;
for(const finalist of onlySelected.exploreResults.armies)assert.deepEqual([...finalist.selectedIds].sort(),[...selectedIds].sort());
console.log('Integrated Explore keeps selected types for frozen families, including when all families are frozen.');
