import assert from 'node:assert/strict';

const records=new Map();
const db={
  objectStoreNames:{contains:()=>true},
  transaction(_name,mode){
    const transaction={
      objectStore:()=>({
        get:key=>request(()=>records.get(key)),
        getAll:()=>request(()=>[...records].map(([key,value])=>({key,value}))),
        put:record=>{queueMicrotask(()=>{records.set(record.key,record.value);transaction.oncomplete?.();});},
        delete:key=>{queueMicrotask(()=>{records.delete(key);transaction.oncomplete?.();});}
      })
    };
    return transaction;
  }
};
function request(getResult){
  const pending={};
  queueMicrotask(()=>{pending.result=getResult();pending.onsuccess?.();});
  return pending;
}
globalThis.indexedDB={open:()=>{
  const pending={result:db};
  queueMicrotask(()=>pending.onsuccess?.());
  return pending;
}};

const {hydrateOptimizerResultBackups,mirrorOptimizerResult,removeOptimizerResultBackup}=await import('../js/durable-user-data.mjs');
const key='tbtoolkit.battleCalculator.optimizerResult.v4.player.epic-arachne';
const old={savedAt:10,payload:{result:{eld:10}}};
const recent={savedAt:20,payload:{result:{eld:20}}};
assert.equal(await mirrorOptimizerResult(key,old),true);
const storage={length:1,key:()=>key,getItem:()=>JSON.stringify(recent)};
const hydrated=await hydrateOptimizerResultBackups(storage);
assert.equal(hydrated.get(key).payload.result.eld,20,'A newer local result must win and migrate to IndexedDB.');
assert.equal(records.get(key).payload.result.eld,20);
const emptyStorage={length:0,key:()=>null,getItem:()=>null};
assert.equal((await hydrateOptimizerResultBackups(emptyStorage)).get(key).payload.result.eld,20,'A result must restore from IndexedDB without a localStorage copy.');
await removeOptimizerResultBackup(key);
assert.equal(records.has(key),false,'Explicit result removal must clear the backup too.');
console.log(JSON.stringify({ok:true,indexedDbResultBackup:true}));
