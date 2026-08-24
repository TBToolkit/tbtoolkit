import { optimizeEpicQuantities, EPIC_OPTIMIZER_BUILD } from './epic-quantity-optimizer.mjs?v=83';

let armyPromise = null;

async function loadArmy(){
  if(!armyPromise){
    const url = new URL('../data/army-v2.json?v=83', import.meta.url);
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
        let progressPct=10;
        if(progress.phase==='seed-screen') progressPct=5+Math.round(((Number(progress.seedIndex||0)+1)/Math.max(1,Number(progress.seedCount||1)))*15);
        else if(progress.phase==='local') progressPct=22+Math.round(((Number(progress.seedIndex||0)+(Number(progress.stageIndex||0)+1)/Math.max(1,Number(progress.stageCount||1)))/Math.max(1,Number(progress.seedCount||1)))*48);
        else if(progress.phase==='evolution') progressPct=72+Math.round((Number(progress.generation||0)/Math.max(1,Number(progress.generationCount||1)))*12);
        else if(progress.phase==='threshold') progressPct=84+Math.round((Number(progress.round||0)/Math.max(1,Number(progress.roundCount||1)))*4);
        else if(progress.phase==='counterfactual') progressPct=89+Math.round(((Number(progress.basinIndex||0)+1)/Math.max(1,Number(progress.basinCount||1)))*5);
        else if(progress.phase==='polish') progressPct=95+Math.round(((Number(progress.stageIndex||0)+1)/Math.max(1,Number(progress.stageCount||1)))*2);
        self.postMessage({type:'progress',requestId,payload:{...progress,progressPct:Math.min(96,progressPct)}});
      }

    });
    self.postMessage({type:'progress',requestId,payload:{phase:'finalizing',progressPct:98,evaluations:result?.diagnostics?.totalEvaluations??result?.diagnostics?.evaluations}});
    const quantities=result?.quantities??{};
    const quantityFingerprint=Object.keys(quantities).sort().map(k=>`${k}:${quantities[k]}`).join('|');
    self.postMessage({
      type:'result',
      requestId,
      payload:result,
      diagnostics:{
        optimizerBuild:EPIC_OPTIMIZER_BUILD,
        engineBuild:'2.1-arachne8',
        armyDatabase:'ARMY9-v72',
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
