import {validateAccountState,validateSavedTree} from './browser-storage.mjs';
import {SAVED_STATE_KEY,SAVED_STATE_SCHEMA_VERSION} from './saved-state-schema.mjs';

export const CLAN_PROFILE_STORE_KEY='tbtoolkit-clan-norm-profiles-v1';

const DATABASE_NAME='tbtoolkit-user-data';
const STORE_NAME='canonical-records';
const KEYS=[SAVED_STATE_KEY,CLAN_PROFILE_STORE_KEY];
const OPTIMIZER_RESULT_PREFIX='tbtoolkit.battleCalculator.optimizerResult.v4.';
let databasePromise;
const pendingWrites=new Map();

function validSnapshot(key,value){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  try{
    if(key===SAVED_STATE_KEY){
      validateAccountState(value);
      const version=Number(value.schemaVersion??SAVED_STATE_SCHEMA_VERSION);
      if(!Number.isInteger(version)||version<17||version>SAVED_STATE_SCHEMA_VERSION)return false;
      return !!value.accounts&&Object.keys(value.accounts).length>0;
    }
    validateSavedTree(value,{maxNodes:250_000,maxArrayLength:5_000});
    return Array.isArray(value.profiles)&&value.profiles.length>0;
  }catch{return false;}
}

function revision(value){const number=Number(value?.storageRevision);return Number.isFinite(number)&&number>0?number:0;}
function recordRevision(key,value){
  if(key.startsWith(OPTIMIZER_RESULT_PREFIX))return Number(value?.savedAt)||0;
  return revision(value);
}

export function stampCanonicalSnapshot(value){
  return{...value,storageRevision:Math.max(Date.now()*1000,revision(value)+1)};
}

function openDatabase(){
  if(!globalThis.indexedDB)return Promise.resolve(null);
  if(!databasePromise)databasePromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE_NAME,1);
    let failed=false;
    const timer=setTimeout(()=>{failed=true;reject(new Error('Browser database did not open in time.'));},5000);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE_NAME))request.result.createObjectStore(STORE_NAME,{keyPath:'key'});};
    request.onsuccess=()=>{clearTimeout(timer);if(failed)request.result.close();else resolve(request.result);};
    request.onerror=()=>{clearTimeout(timer);reject(request.error||new Error('Browser database could not be opened.'));};
    request.onblocked=()=>{clearTimeout(timer);failed=true;reject(new Error('Browser database upgrade is blocked by another tab.'));};
  }).catch(error=>{databasePromise=null;throw error;});
  return databasePromise;
}

async function readBackup(key){
  const db=await openDatabase();if(!db)return null;
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(STORE_NAME,'readonly'),request=transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess=()=>resolve(request.result?.value??null);
    request.onerror=()=>reject(request.error||new Error('Browser backup could not be read.'));
  });
}

async function writeBackup(key,value){
  const db=await openDatabase();if(!db)return;
  await new Promise((resolve,reject)=>{
    const transaction=db.transaction(STORE_NAME,'readwrite'),store=transaction.objectStore(STORE_NAME);
    const request=store.get(key);
    request.onsuccess=()=>{
      if(recordRevision(key,request.result?.value)<=recordRevision(key,value))store.put({key,value});
    };
    transaction.oncomplete=resolve;
    transaction.onerror=()=>reject(transaction.error||new Error('Browser backup could not be saved.'));
    transaction.onabort=()=>reject(transaction.error||new Error('Browser backup was canceled.'));
  });
}

export function mirrorCanonicalSnapshot(key,value){
  if(!KEYS.includes(key)||!value||typeof value!=='object')return Promise.resolve(false);
  const snapshot=structuredClone(value),previous=pendingWrites.get(key)||Promise.resolve();
  const current=previous.catch(()=>{}).then(()=>writeBackup(key,snapshot)).then(()=>true).catch(error=>{
    console.warn('Could not save a browser backup of user data.',error);return false;
  });
  pendingWrites.set(key,current);
  return current;
}

// Optimizer results are user-visible saved work, not disposable cache entries.
// Keep an independent IndexedDB copy so a full localStorage origin cannot
// silently evict older encounters when a new optimization finishes.
export function mirrorOptimizerResult(key,value){
  if(!key.startsWith(OPTIMIZER_RESULT_PREFIX)||!value?.payload?.result)return Promise.resolve(false);
  if(!globalThis.indexedDB)return Promise.resolve(false);
  const snapshot=structuredClone(value),previous=pendingWrites.get(key)||Promise.resolve();
  const current=previous.catch(()=>{}).then(()=>writeBackup(key,snapshot)).then(()=>true).catch(error=>{
    console.warn('Could not save an optimizer result backup.',error);return false;
  });
  pendingWrites.set(key,current);
  return current;
}

export async function hydrateOptimizerResultBackups(storage){
  const results=new Map();
  try{
    const db=await openDatabase();
    if(db){
      const rows=await new Promise((resolve,reject)=>{
        const request=db.transaction(STORE_NAME,'readonly').objectStore(STORE_NAME).getAll();
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error||new Error('Optimizer backups could not be read.'));
      });
      for(const row of rows)if(row.key.startsWith(OPTIMIZER_RESULT_PREFIX)&&row.value?.payload?.result)results.set(row.key,row.value);
    }
  }catch(error){console.warn('Could not read optimizer result backups.',error);}
  for(let index=0;index<storage.length;index++){
    const key=storage.key(index);
    if(!key?.startsWith(OPTIMIZER_RESULT_PREFIX))continue;
    try{
      const value=JSON.parse(storage.getItem(key));
      if(!value?.payload?.result)continue;
      if(recordRevision(key,value)>recordRevision(key,results.get(key))){
        results.set(key,value);
        await mirrorOptimizerResult(key,value);
      }
    }catch(error){console.warn(`Could not migrate saved optimizer result ${key}.`,error);}
  }
  return results;
}

export function removeOptimizerResultBackup(key){
  if(!key.startsWith(OPTIMIZER_RESULT_PREFIX))return Promise.resolve(false);
  const previous=pendingWrites.get(key)||Promise.resolve();
  const current=previous.catch(()=>{}).then(async()=>{
    const db=await openDatabase();if(!db)return false;
    await new Promise((resolve,reject)=>{
      const transaction=db.transaction(STORE_NAME,'readwrite');
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.oncomplete=resolve;
      transaction.onerror=()=>reject(transaction.error||new Error('Optimizer backup could not be removed.'));
      transaction.onabort=()=>reject(transaction.error||new Error('Optimizer backup removal was canceled.'));
    });
    return true;
  }).catch(error=>{console.warn('Could not remove an optimizer result backup.',error);return false;});
  pendingWrites.set(key,current);
  return current;
}

export async function reconcileCanonicalRecord(storage,key,backup,persistBackup=mirrorCanonicalSnapshot){
  if(!KEYS.includes(key))return 'unknown';
  let local=null;
  try{const raw=storage.getItem(key);if(raw)local=JSON.parse(raw);}catch{}
  if(!validSnapshot(key,local))local=null;
  if(!validSnapshot(key,backup))backup=null;
  if(!backup){if(local)await persistBackup(key,local);return local?'local':'missing';}
  if(local&&revision(local)>=revision(backup)){
    if(revision(local)>revision(backup))await persistBackup(key,local);
    return 'local';
  }
  try{storage.setItem(key,JSON.stringify(backup));return 'backup';}
  catch(error){console.warn('Could not restore saved user data from the browser backup.',error);return 'unavailable';}
}

export async function hydrateCanonicalStorage(storage){
  const backups=new Map();
  for(const key of KEYS){
    let backup=null;
    try{backup=await readBackup(key);}catch(error){console.warn('Could not read the browser backup of user data.',error);}
    if(validSnapshot(key,backup))backups.set(key,backup);
    await reconcileCanonicalRecord(storage,key,backup);
  }
  return backups;
}
