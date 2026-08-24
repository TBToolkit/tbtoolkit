import { optimizeEpicQuantities, EPIC_OPTIMIZER_BUILD } from './epic-quantity-optimizer.mjs?v=78';

let armyPromise = null;

async function loadArmy(){
  if(!armyPromise){
    const url = new URL('../data/army-v2.json?v=78', import.meta.url);
    armyPromise = fetch(url, {cache:'no-store'}).then(async r=>{
      if(!r.ok) throw new Error(`Unable to load canonical army database (${r.status}).`);
      return r.json();
    });
  }
  return armyPromise;
}

self.onmessage = async (event)=>{
  const msg = event.data ?? {};
  if(msg.type !== 'optimize') return;
  const requestId = msg.requestId;
  try{
    const army = await loadArmy();
    self.postMessage({type:'progress', requestId, payload:{phase:'loading',progressPct:2}});
    const result = optimizeEpicQuantities({
      units: army,
      selectedIds: msg.selectedIds,
      bonuses: msg.bonuses,
      capacityLimits: msg.capacityLimits,
      seedSeparationPct: 0.10,
      minimumHealthSeparationPct: 0.01,
      minimumQuantity: 1,
      onProgress:(progress)=>{
        const stageCount=Math.max(1,Number(progress.stageCount||1));
        const progressPct=progress.phase==='seed'
          ? 8
          : Math.min(96,10+Math.round(((Number(progress.stageIndex)+1)/stageCount)*86));
        self.postMessage({type:'progress',requestId,payload:{...progress,progressPct}});
      }
    });
    self.postMessage({type:'progress',requestId,payload:{phase:'finalizing',progressPct:98,evaluations:result?.diagnostics?.evaluations}});
    const quantities=result?.quantities??{};
    const quantityFingerprint=Object.keys(quantities).sort().map(k=>`${k}:${quantities[k]}`).join('|');
    self.postMessage({
      type:'result',
      requestId,
      payload:result,
      diagnostics:{
        optimizerBuild:EPIC_OPTIMIZER_BUILD,
        engineBuild:'2.0',
        armyDatabase:'ARMY9-126edf91c542',
        armyCount:Array.isArray(army)?army.length:0,
        quantityFingerprint,
        inputPayload:msg.bonuses,
        capacityLimits:msg.capacityLimits
      }
    });
  }catch(error){
    self.postMessage({
      type:'error',
      requestId,
      message:error?.message || String(error),
      stack:error?.stack || ''
    });
  }
};
