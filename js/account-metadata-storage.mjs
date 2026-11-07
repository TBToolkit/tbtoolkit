import {SAVED_STATE_KEY} from './saved-state-schema.mjs';
import {stampCanonicalSnapshot,mirrorCanonicalSnapshot,makeRoomForAccountMetadata,hydrateCanonicalStorage} from './durable-user-data.mjs';

const quotaError=error=>['QuotaExceededError','NS_ERROR_DOM_QUOTA_REACHED'].includes(error?.name)||[22,1014].includes(error?.code);

export async function saveAccountMetadataChange(storage,change,{makeRoom=makeRoomForAccountMetadata,restore=hydrateCanonicalStorage}={}){
  for(let attempt=0;attempt<2;attempt++){
    // Re-read after asynchronous recovery so edits made by another page survive.
    const saved=JSON.parse(storage.getItem(SAVED_STATE_KEY)||'null');
    if(!saved||change(saved)===false)return false;
    const snapshot=stampCanonicalSnapshot(saved);
    try{storage.setItem(SAVED_STATE_KEY,JSON.stringify(snapshot));}
    catch(error){
      if(attempt||!quotaError(error)||!await makeRoom(storage))throw error;
      await restore(storage);
      continue;
    }
    mirrorCanonicalSnapshot(SAVED_STATE_KEY,snapshot);
    return true;
  }
  return false;
}
