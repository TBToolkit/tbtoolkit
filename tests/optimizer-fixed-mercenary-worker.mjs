import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Worker} from 'node:worker_threads';

const army=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const troop=army.find(unit=>unit.id==='troop-g9-flying-corax-2');
const monster=army.find(unit=>unit.id==='monster-m9-melee-kraken-2');
const mercenary=army.find(unit=>unit.category==='mercenary'&&unit.tierNumber===2);
assert.ok(troop&&monster&&mercenary,'Fixed-mercenary test units must exist');
const fixedQuantity=7;
const requestId='fixed-mercenary-worker';
const worker=new Worker(new URL('./optimizer-worker-node-adapter.mjs',import.meta.url));
const result=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{worker.terminate();reject(new Error('Optimizer worker test timed out.'));},120_000);
  worker.on('message',message=>{
    if(message.requestId!==requestId||message.type==='progress')return;
    clearTimeout(timer);
    if(message.type==='error')reject(new Error(message.message));else resolve(message);
    worker.terminate();
  });
  worker.on('error',reject);
  worker.postMessage({type:'optimize',requestId,selectedIds:[troop.id,monster.id],fixedQuantities:{[mercenary.name]:fixedQuantity},fixedMercenaryIds:[mercenary.id],fixedAuthorityMaximum:mercenary.capacityCost*fixedQuantity,bonuses:{monsterHealthPct:1600,monsterStrengthPct:2000,strengthAgainstEpicPct:3800,monsterDDPct:12,monsterSTPct:18,arachne:false,useCustomFamilyBonuses:false},capacityLimits:{LEADERSHIP:25_000,DOMINANCE:10_000,AUTHORITY:0}});
});
const fixed=result.payload.result.squads.find(squad=>squad.id===mercenary.id);
assert.ok(fixed,'The fixed mercenary must participate in the optimized battle simulation');
assert.equal(fixed.quantity,fixedQuantity,'The optimizer must not resize a fixed mercenary');
assert.equal(result.payload.result.capacities.AUTHORITY,mercenary.capacityCost*fixedQuantity,'Fixed Authority usage must remain exact');
assert.equal(result.payload.diagnostics.mercenaryOptimizationMode,'fixed-integrated');
console.log(JSON.stringify({ok:true,mercenary:fixed.name,quantity:fixed.quantity,authority:result.payload.result.capacities.AUTHORITY,eld:result.payload.result.expectedTotalLifetimeDamage}));
