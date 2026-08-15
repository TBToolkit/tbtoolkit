import { optimizeEpicQuantities } from './epic-quantity-optimizer.mjs';

let armyPromise = null;

async function loadArmy(){
  if(!armyPromise){
    const url = new URL('../data/army-v2.json?v=56', import.meta.url);
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
    const result = optimizeEpicQuantities({
      units: army,
      selectedIds: msg.selectedIds,
      bonuses: msg.bonuses,
      capacityLimits: msg.capacityLimits,
      seedSeparationPct: 0.10,
      minimumHealthSeparationPct: 0.01,
      minimumQuantity: 1
    });
    self.postMessage({type:'result', requestId, payload:result});
  }catch(error){
    self.postMessage({
      type:'error',
      requestId,
      message:error?.message || String(error),
      stack:error?.stack || ''
    });
  }
};
