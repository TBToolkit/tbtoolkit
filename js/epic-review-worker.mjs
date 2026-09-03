import {EPIC_REVIEW_BUILD,runOptimizeReviewSelection} from './epic-review-engine.mjs';

let armyPromise;
function loadArmy(){
  if(!armyPromise)armyPromise=fetch(new URL('../data/army-v2.json?v=191',import.meta.url),{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error(`Unable to load canonical army database (${response.status}).`);return response.json();});
  return armyPromise;
}

self.onmessage=async event=>{
  const message=event.data??{};
  if(message.type!=='review')return;
  const requestId=message.requestId;
  try{
    const units=await loadArmy();
    const payload=await runOptimizeReviewSelection({...message.payload,units,onProgress:progress=>self.postMessage({type:'progress',requestId,payload:progress})});
    self.postMessage({type:'result',requestId,payload,diagnostics:{reviewBuild:EPIC_REVIEW_BUILD,armyCount:units.length}});
  }catch(error){self.postMessage({type:'error',requestId,code:error?.code||'REVIEW_ERROR',message:error?.message||String(error),stack:error?.stack||''});}
};
