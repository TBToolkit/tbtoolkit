import {compressProfileText,readProfileText} from './profile-file-compression.mjs';
export const CLAN_FILE_FORMAT='tbtoolkit-clan';
export const CLAN_MAX_BYTES=1_000_000;

export async function serializeClanFile(profile,options){
  return compressProfileText(serializeClanProfile(profile,options));
}
export async function parseClanFile(file){
  return parseClanProfile(await readProfileText(file,{maxBytes:CLAN_MAX_BYTES,sizeLimitMessage:'The clan file is larger than 1 MB.'}));
}

export function serializeClanProfile(profile,{exportedAt=new Date().toISOString()}={}){
  const plan=structuredClone(profile.plan||{});
  delete plan.netPlayerAccountId;
  return JSON.stringify({format:CLAN_FILE_FORMAT,schemaVersion:1,kind:'clan-profile',exportedAt,profile:{id:profile.id,name:profile.name,plan}},null,2);
}

export function parseClanProfile(text){
  let data;
  try{data=JSON.parse(text);}catch{throw new Error('This is not valid TB Toolkit clan JSON.');}
  const current=data?.format===CLAN_FILE_FORMAT&&data?.kind==='clan-profile';
  const legacy=data?.format==='tbtoolkit-norms'&&data?.kind==='clan-norm-profile';
  if(!(current||legacy)||!data?.profile?.plan||typeof data.profile.plan!=='object'||Array.isArray(data.profile.plan))throw new Error('This is not a valid TB Toolkit .clan or legacy .norms file.');
  const profile=structuredClone(data.profile);
  delete profile.plan.netPlayerAccountId;
  return profile;
}
