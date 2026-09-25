import assert from 'node:assert/strict';
import {CLAN_PROFILE_STORE_KEY,reconcileCanonicalRecord,stampCanonicalSnapshot} from '../js/durable-user-data.mjs';
import {SAVED_STATE_KEY} from '../js/saved-state-schema.mjs';

const player=revision=>({schemaVersion:20,storageRevision:revision,activeAccountId:'one',accounts:{one:{name:'Biff'}}});
const clan=revision=>({schemaVersion:1,storageRevision:revision,activeProfileId:'clan',profiles:[{id:'clan',name:'LOL',plan:{}}]});
const memory=entries=>{
  const values=new Map(entries),writes=[];
  return{values,writes,getItem:key=>values.get(key)??null,setItem:(key,value)=>{writes.push(key);values.set(key,value);}};
};

const outdated=memory([[SAVED_STATE_KEY,JSON.stringify(player(10))]]);
assert.equal(await reconcileCanonicalRecord(outdated,SAVED_STATE_KEY,player(20)), 'backup');
assert.equal(JSON.parse(outdated.getItem(SAVED_STATE_KEY)).storageRevision,20);

const current=memory([[SAVED_STATE_KEY,JSON.stringify(player(30))]]),mirrored=[];
assert.equal(await reconcileCanonicalRecord(current,SAVED_STATE_KEY,player(20),async(key,value)=>mirrored.push([key,value.storageRevision])),'local');
assert.deepEqual(mirrored,[[SAVED_STATE_KEY,30]]);
assert.deepEqual(current.writes,[]);

const corrupt=memory([[SAVED_STATE_KEY,'{invalid']]);
assert.equal(await reconcileCanonicalRecord(corrupt,SAVED_STATE_KEY,player(20)),'backup');
assert.equal(JSON.parse(corrupt.getItem(SAVED_STATE_KEY)).accounts.one.name,'Biff');

const missingClan=memory([]);
assert.equal(await reconcileCanonicalRecord(missingClan,CLAN_PROFILE_STORE_KEY,clan(10)),'backup');
assert.equal(JSON.parse(missingClan.getItem(CLAN_PROFILE_STORE_KEY)).profiles[0].name,'LOL');

const localClan=memory([[CLAN_PROFILE_STORE_KEY,JSON.stringify(clan(11))]]),seeded=[];
assert.equal(await reconcileCanonicalRecord(localClan,CLAN_PROFILE_STORE_KEY,null,async(key,value)=>seeded.push([key,value.storageRevision])),'local');
assert.deepEqual(seeded,[[CLAN_PROFILE_STORE_KEY,11]]);
assert.equal(await reconcileCanonicalRecord(memory([]),SAVED_STATE_KEY,null),'missing');

const stamped=stampCanonicalSnapshot(player(10));
assert.ok(stamped.storageRevision>10);
assert.equal(stamped.accounts.one.name,'Biff');
console.log(JSON.stringify({ok:true,restored:2,seeded:1}));
