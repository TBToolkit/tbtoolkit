import assert from 'node:assert/strict';
import {persistentAccountSnapshot,readSavedJson,validateAccountState,validateSavedTree,writeSavedJson} from '../js/browser-storage.mjs';

const values=new Map();
const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
const valid={activeAccountId:'main',accounts:{main:{name:'Main',battle:{workspaces:{}}}}};
writeSavedJson(storage,'state',valid,{validate:validateAccountState});
assert.deepEqual(readSavedJson(storage,'state',{validate:validateAccountState}),valid);
assert.throws(()=>validateSavedTree({value:Infinity}),/non-finite/);
assert.throws(()=>validateSavedTree({rows:new Array(2001)}),/oversized list/);
assert.throws(()=>validateAccountState({accounts:{main:{name:''}}}),/invalid name/);
values.set('oversize','x'.repeat(101));
assert.throws(()=>readSavedJson(storage,'oversize',{maxBytes:100}),/exceeds/);
const accounts={
  main:{
    name:'Main',
    battle:{
      activeBattleMethod:'custom',
      workspaces:{
        arachne:{
          selectedIds:{troop:['g9']},
          methods:{basic:{},custom:{orders:{troop:['G9']}},optimize:{resultCache:{payload:{huge:'result'}}}},
        },
      },
    },
  },
};
const snapshot=persistentAccountSnapshot(accounts);
assert.equal(snapshot.main.battle.activeBattleMethod,'custom');
assert.deepEqual(snapshot.main.battle.workspaces.arachne.selectedIds,{troop:['g9']});
assert.equal(snapshot.main.battle.workspaces.arachne.methods.optimize.resultCache,null);
assert.ok(accounts.main.battle.workspaces.arachne.methods.optimize.resultCache,'Live optimizer result must remain untouched.');
console.log(JSON.stringify({ok:true}));
