import assert from 'node:assert/strict';
import {CLAN_PROFILE_STORE_KEY,readClanProfiles,linkedClanProfile,clanEncounterNorm,saveClanEncounterNorm} from '../js/clan-profile-link.mjs';

const values=new Map();
const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
const initial={schemaVersion:1,activeProfileId:'other',profiles:[
  {id:'linked',name:'My Clan',plan:{recipients:88,epics:[{monster:'DOOMSDAY',value:'500',unit:'M',basis:'points',pointsPerFullGoldRevive:35}]}},
  {id:'other',name:'Other Clan',plan:{recipients:100,epics:[{monster:'DOOMSDAY',value:'1',unit:'B',basis:'points'}]}}
]};
storage.setItem(CLAN_PROFILE_STORE_KEY,JSON.stringify(initial));

const linked=linkedClanProfile(storage,'linked');
assert.equal(linked.name,'My Clan');
assert.equal(clanEncounterNorm(linked,'Doomsday').norm,500);
assert.equal(clanEncounterNorm(linked,'Doomsday').clanMembers,88);
assert.equal(clanEncounterNorm(linkedClanProfile(storage,'other'),'Doomsday').norm,1);
assert.equal(clanEncounterNorm(linked,'Fenrir'),null);

saveClanEncounterNorm(storage,'linked','Doomsday',{norm:750,unit:'M',basis:'points'});
assert.equal(clanEncounterNorm(linkedClanProfile(storage,'linked'),'Doomsday').norm,750);
assert.equal(linkedClanProfile(storage,'linked').plan.epics[0].pointsPerFullGoldRevive,35);
assert.equal(clanEncounterNorm(linkedClanProfile(storage,'other'),'Doomsday').norm,1);
saveClanEncounterNorm(storage,'linked','Fenrir',{norm:375,unit:'B',basis:'chests'});
assert.equal(clanEncounterNorm(linkedClanProfile(storage,'linked'),'Fenrir').basis,'chests');
assert.throws(()=>saveClanEncounterNorm(storage,'missing','Fenrir',{norm:1,unit:'B',basis:'points'}),/unavailable/);
assert.throws(()=>saveClanEncounterNorm(storage,'linked','Fenrir',{norm:-1,unit:'B',basis:'points'}),/valid clan norm/);
assert.equal(readClanProfiles(storage).profiles.length,2);
console.log(JSON.stringify({ok:true,profiles:2}));
