import assert from 'node:assert/strict';
import {CLAN_PROFILE_STORE_KEY,readClanProfiles,linkedClanProfile,clanEncounterNorm,saveClanEncounterNorm} from '../js/clan-profile-link.mjs';
import {CLAN_FILE_FORMAT,serializeClanProfile,parseClanProfile} from '../js/clan-profile-file.mjs';

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
saveClanEncounterNorm(storage,'linked','Tinman',{norm:2200,unit:'M',basis:'points'});
assert.equal(clanEncounterNorm(linkedClanProfile(storage,'linked'),'Tinman').norm,2.2,'Tinman point norms are stored in billions independently of Epic chest norms.');
assert.throws(()=>saveClanEncounterNorm(storage,'linked','Tinman',{norm:10,unit:'B',basis:'chests'}),/points, not chests/);
assert.throws(()=>saveClanEncounterNorm(storage,'missing','Fenrir',{norm:1,unit:'B',basis:'points'}),/unavailable/);
assert.throws(()=>saveClanEncounterNorm(storage,'linked','Fenrir',{norm:-1,unit:'B',basis:'points'}),/valid clan norm/);
assert.equal(readClanProfiles(storage).profiles.length,2);
const linkedWithTinman=linkedClanProfile(storage,'linked');linkedWithTinman.plan.tinman.bonus=100;
const portable=JSON.parse(serializeClanProfile({...linkedWithTinman,plan:{...linkedWithTinman.plan,netPlayerAccountId:'browser-player'}},{exportedAt:'2026-09-01T00:00:00Z'}));
assert.equal(portable.format,CLAN_FILE_FORMAT);
assert.equal(portable.kind,'clan-profile');
assert.equal(portable.profile.plan.netPlayerAccountId,undefined,'Portable clan files must not name a local player account.');
assert.equal(parseClanProfile(JSON.stringify(portable)).plan.epics[0].monster,'DOOMSDAY');
assert.equal(parseClanProfile(JSON.stringify(portable)).plan.tinman.norm,2.2,'Tinman norms must travel with the .clan file.');
assert.equal(parseClanProfile(JSON.stringify(portable)).plan.tinman.bonus,100,'Tinman point bonuses must travel with the .clan file.');
const legacy={format:'tbtoolkit-norms',kind:'clan-norm-profile',profile:{...linked,plan:{...linked.plan,netPlayerAccountId:'old-player'}}};
assert.equal(parseClanProfile(JSON.stringify(legacy)).plan.netPlayerAccountId,undefined,'Legacy .norms files remain importable without restoring a stale player link.');
assert.throws(()=>parseClanProfile('{}'),/valid TB Toolkit/);
console.log(JSON.stringify({ok:true,profiles:2}));
