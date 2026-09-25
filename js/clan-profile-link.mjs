import {CLAN_PROFILE_STORE_KEY,stampCanonicalSnapshot,mirrorCanonicalSnapshot} from './durable-user-data.mjs';
export {CLAN_PROFILE_STORE_KEY};

export function readClanProfiles(storage){
  try{
    const saved=JSON.parse(storage.getItem(CLAN_PROFILE_STORE_KEY)||'null');
    return Array.isArray(saved?.profiles)?saved:{schemaVersion:1,activeProfileId:'',profiles:[]};
  }catch{return{schemaVersion:1,activeProfileId:'',profiles:[]};}
}

export function linkedClanProfile(storage,profileId){
  if(!profileId)return null;
  return readClanProfiles(storage).profiles.find(profile=>profile?.id===profileId)||null;
}

export function clanEncounterNorm(profile,encounterName){
  if(String(encounterName||'').toUpperCase()==='TINMAN'){
    const value=Number(profile?.plan?.tinman?.norm);
    if(!Number.isFinite(value)||value<=0)return null;
    return{profileId:profile.id,profileName:profile.name||'Linked clan',clanMembers:Math.max(1,Math.floor(Number(profile.plan?.recipients)||1)),norm:value,unit:['B','M','K'].includes(profile.plan.tinman.normUnit)?profile.plan.tinman.normUnit:'B',basis:'points',source:'clan'};
  }
  const epic=profile?.plan?.epics?.find(row=>String(row.monster||'').toUpperCase()===String(encounterName||'').toUpperCase());
  if(!epic||!(Number(epic.value)>0))return null;
  const basis=epic.basis==='chests'?'chests':'points';
  return{
    profileId:profile.id,
    profileName:profile.name||'Linked clan',
    clanMembers:Math.max(1,Math.floor(Number(profile.plan?.recipients)||1)),
    norm:Number(epic.value),
    unit:['B','M','K'].includes(epic.unit)?epic.unit:'B',
    basis,
    source:'clan'
  };
}

export function saveClanEncounterNorm(storage,profileId,encounterName,{norm,unit,basis}){
  const saved=readClanProfiles(storage),profile=saved.profiles.find(item=>item?.id===profileId);
  if(!profile)throw new Error('The linked clan profile is unavailable.');
  const value=Number(norm);
  if(!Number.isFinite(value)||value<=0)throw new Error('Enter a valid clan norm greater than zero.');
  if(!['B','M','K'].includes(unit)||!['points','chests'].includes(basis))throw new Error('Choose a valid norm unit and basis.');
  profile.plan=profile.plan||{};
  profile.plan.epics=Array.isArray(profile.plan.epics)?profile.plan.epics:[];
  const key=String(encounterName||'').trim().toUpperCase();
  if(!key)throw new Error('Choose an Epic encounter.');
  if(key==='TINMAN'){
    if(basis!=='points')throw new Error('Tinman norms use points, not chests.');
    profile.plan.tinman=profile.plan.tinman||{};
    profile.plan.tinman.norm=value;
    profile.plan.tinman.normUnit=unit;
    const snapshot=stampCanonicalSnapshot(saved);
    storage.setItem(CLAN_PROFILE_STORE_KEY,JSON.stringify(snapshot));
    mirrorCanonicalSnapshot(CLAN_PROFILE_STORE_KEY,snapshot);
    return profile;
  }
  const existing=profile.plan.epics.find(row=>String(row.monster||'').toUpperCase()===key);
  if(existing)Object.assign(existing,{value,unit,basis});
  else profile.plan.epics.push({monster:key,value,unit,basis});
  const snapshot=stampCanonicalSnapshot(saved);
  storage.setItem(CLAN_PROFILE_STORE_KEY,JSON.stringify(snapshot));
  mirrorCanonicalSnapshot(CLAN_PROFILE_STORE_KEY,snapshot);
  return profile;
}
