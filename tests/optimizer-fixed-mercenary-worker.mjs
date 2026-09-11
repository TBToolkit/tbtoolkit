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
const progress=[];
const result=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{worker.terminate();reject(new Error('Optimizer worker test timed out.'));},120_000);
  worker.on('message',message=>{
    if(message.requestId!==requestId)return;
    if(message.type==='progress'){progress.push(message.payload);return;}
    clearTimeout(timer);
    if(message.type==='error')reject(new Error(message.message));else resolve(message);
    worker.terminate();
  });
  worker.on('error',reject);
  worker.postMessage({type:'optimize',requestId,selectedIds:[troop.id,monster.id],fixedQuantities:{[mercenary.name]:fixedQuantity},fixedMercenaryIds:[mercenary.id],fixedAuthorityMaximum:mercenary.capacityCost*fixedQuantity,bonuses:{monsterHealthPct:1600,monsterStrengthPct:2000,strengthAgainstEpicPct:3800,monsterDDPct:12,monsterSTPct:18,arachne:false,useCustomFamilyBonuses:false},capacityLimits:{LEADERSHIP:25_000,DOMINANCE:10_000,AUTHORITY:0}});
});
const fixed=result.payload.result.squads.find(squad=>squad.id===mercenary.id);
assert.ok(fixed,'The fixed mercenary must be added to the final live result');
assert.equal(fixed.quantity,fixedQuantity,'The final live result must not resize a fixed mercenary');
assert.equal(result.payload.result.capacities.AUTHORITY,mercenary.capacityCost*fixedQuantity,'Fixed Authority usage must remain exact');
assert.equal(result.payload.diagnostics.mercenaryOptimizationMode,'standard-live');
assert.ok(progress.some(update=>update.healthLadder?.some(row=>row.id===mercenary.id&&row.category==='mercenary')),'A fixed mercenary must appear in optimizer progress ladder snapshots');
const evaluationCounts=progress.map(update=>Number(update.evaluations)).filter(Number.isFinite);
assert.ok(evaluationCounts.every((value,index)=>index===0||value>=evaluationCounts[index-1]),'Displayed optimizer evaluations must be cumulative and monotonic');
console.log(JSON.stringify({ok:true,mercenary:fixed.name,quantity:fixed.quantity,authority:result.payload.result.capacities.AUTHORITY,eld:result.payload.result.expectedTotalLifetimeDamage}));
