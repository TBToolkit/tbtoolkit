import assert from 'node:assert/strict';
import {savePlayerClanLink} from '../js/clan-profile-link.mjs';
import {makeRoomForAccountMetadata} from '../js/durable-user-data.mjs';
import {SAVED_STATE_KEY} from '../js/saved-state-schema.mjs';

const resultKey='tbtoolkit.battleCalculator.optimizerResult.v4.player.epic-doomsday';
const account={schemaVersion:20,activeAccountId:'player',accounts:{player:{id:'player',name:'Player',clanProfileId:'',battle:{workspaces:{}}}}};
const result={savedAt:123,payload:{result:{squads:[{id:'unit',quantity:100}]},exploreResults:{armies:[{id:'starting',selectedIds:['unit']}]}}};
function fullStorage(){
  const values=new Map([[SAVED_STATE_KEY,JSON.stringify(account)],[resultKey,JSON.stringify(result)],['unrelated','keep']]);
  const limit=[...values].reduce((sum,[key,value])=>sum+key.length+value.length,0);
  return {values,get length(){return values.size;},key:i=>[...values.keys()][i],getItem:key=>values.get(key)??null,removeItem:key=>values.delete(key),setItem(key,value){
    const size=[...values].filter(([k])=>k!==key).reduce((sum,[k,v])=>sum+k.length+v.length,0)+key.length+value.length;
    if(size>limit)throw new DOMException('Storage quota exceeded','QuotaExceededError');
    values.set(key,value);
  }};
}
const storage=fullStorage(),backups=new Map();
const linked=structuredClone(account);linked.accounts.player.clanProfileId='test-clan';
assert.throws(()=>storage.setItem(SAVED_STATE_KEY,JSON.stringify(linked)),{name:'QuotaExceededError'},'Reproduce the old direct link failure');
assert.equal(await savePlayerClanLink(storage,'player','test-clan',{
  makeRoom:s=>makeRoomForAccountMetadata(s,async(key,value)=>{backups.set(key,value);return true;}),restore:async()=>{},
}),true);
assert.equal(JSON.parse(storage.getItem(SAVED_STATE_KEY)).accounts.player.clanProfileId,'test-clan');
assert.deepEqual(backups.get(resultKey),result,'All saved armies must be committed before removing the duplicate');
assert.equal(storage.getItem(resultKey),null);
assert.equal(storage.getItem('unrelated'),'keep');
assert.equal(await savePlayerClanLink(storage,'player',''),true,'Unlink uses the same durable save path');

const unavailable=fullStorage();
await assert.rejects(savePlayerClanLink(unavailable,'player','test-clan',{makeRoom:s=>makeRoomForAccountMetadata(s,async()=>false)}),{name:'QuotaExceededError'});
assert.deepEqual(JSON.parse(unavailable.getItem(resultKey)),result,'Failed backups must never discard results');
assert.equal(JSON.parse(unavailable.getItem(SAVED_STATE_KEY)).accounts.player.clanProfileId,'','Failed saves must not report a link');

const changed=fullStorage();
assert.equal(await makeRoomForAccountMetadata(changed,async key=>{changed.values.set(key,JSON.stringify({...result,savedAt:456}));return true;}),false);
assert.equal(JSON.parse(changed.getItem(resultKey)).savedAt,456,'Do not remove a result changed by another tab during backup');

const concurrent=fullStorage();
assert.equal(await savePlayerClanLink(concurrent,'player','clan',{
  makeRoom:async s=>{s.removeItem(resultKey);const newer=JSON.parse(s.getItem(SAVED_STATE_KEY));newer.accounts.player.name='Updated in another tab';s.setItem(SAVED_STATE_KEY,JSON.stringify(newer));return true;},restore:async()=>{},
}),true);
assert.equal(JSON.parse(concurrent.getItem(SAVED_STATE_KEY)).accounts.player.name,'Updated in another tab');
assert.equal(await savePlayerClanLink(concurrent,'missing','clan'),false);
console.log('Clan linking: full-storage recovery, complete Explore preservation, failed-backup protection, unlink, and concurrent edits passed.');
