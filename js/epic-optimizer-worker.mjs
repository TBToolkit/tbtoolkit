import {optimizeEpicQuantities} from './epic-quantity-optimizer.mjs';
import {scoreEpicArmy,validateArmyDatabase} from './epic-combat-engine-v2.mjs';
import {ARMY_DATABASE_BUILD,EPIC_COMBAT_ENGINE_BUILD,COMBAT_MECHANICS_BUILD,EPIC_OPTIMIZER_BUILD} from './build-info.mjs';

let armyPromise;
function loadArmy(){
  if(!armyPromise)armyPromise=fetch(new URL('../data/army-v2.json',import.meta.url),{cache:'no-store'}).then(async response=>{
    if(!response.ok)throw new Error(`Unable to load canonical army database (${response.status}).`);
    const units=await response.json(),validation=validateArmyDatabase(units);
    if(!validation.valid)throw new Error(`Army database validation failed: ${validation.errors.join('; ')}`);
    return units;
  });
  return armyPromise;
}
function capacityUsage(units,quantities){
  const totals={LEADERSHIP:0,DOMINANCE:0,AUTHORITY:0};
  const byKey=new Map(units.flatMap(unit=>[[unit.id,unit],[unit.name,unit]]));
  for(const [key,value] of Object.entries(quantities||{})){
    const unit=byKey.get(key),quantity=Math.max(0,Number(value)||0);
    if(unit&&quantity)totals[unit.capacityType]+=quantity*Number(unit.capacityCost||0);
  }
  return totals;
}
function ladderRows(result){
  return (result?.squads||[]).filter(squad=>Number(squad.quantity)>0).map(squad=>({id:squad.id,category:squad.category,tier:squad.tier,effectiveHealth:squad.effectiveHealth,deathPosition:squad.predictedDeathPosition}));
}
function mergeFixedMercenaryLadder(coreRows,fixedRows){
  const combined=[...(Array.isArray(coreRows)?coreRows:[]),...fixedRows];
  return combined.sort((a,b)=>Number(b.effectiveHealth)-Number(a.effectiveHealth)||Number(a.deathPosition)-Number(b.deathPosition)).map((row,index)=>({...row,deathPosition:index+1}));
}
function progressPercent(progress){
  const fraction=(value,total)=>(Number(value||0)+1)/Math.max(1,Number(total||1));
  if(progress.phase==='seed-screen')return 5+Math.round(fraction(progress.seedIndex,progress.seedCount)*15);
  if(progress.phase==='local')return 22+Math.round(((Number(progress.seedIndex||0)+fraction(progress.stageIndex,progress.stageCount))/Math.max(1,Number(progress.seedCount||1)))*48);
  if(progress.phase==='evolution')return 72+Math.round((Number(progress.generation||0)/Math.max(1,Number(progress.generationCount||1)))*12);
  if(progress.phase==='threshold')return 84+Math.round((Number(progress.round||0)/Math.max(1,Number(progress.roundCount||1)))*4);
  if(progress.phase==='counterfactual')return 88+Math.round(fraction(progress.basinIndex,progress.basinCount)*3);
  if(progress.phase==='paired-counterfactual')return 91+Math.round(fraction(progress.pairIndex,progress.pairCount)*2);
  if(progress.phase==='group-redistribution')return 92+Math.round(fraction(progress.groupIndex,progress.groupCount)*2);
  if(progress.phase==='polish')return 95;
  if(progress.phase==='death-position'||progress.phase==='convergence-polish')return 96;
  return 10;
}

self.onmessage=async event=>{
  const message=event.data??{};if(message.type!=='optimize')return;
  const requestId=message.requestId;
  try{
    const units=await loadArmy();
    self.postMessage({type:'progress',requestId,payload:{phase:'loading',progressPct:2}});
    const fixedQuantities=message.fixedQuantities&&typeof message.fixedQuantities==='object'?{...message.fixedQuantities}:{};
    const fixedUsage=capacityUsage(units,fixedQuantities);
    const fixedMercenaryRows=Object.keys(fixedQuantities).length?ladderRows(scoreEpicArmy({units,quantities:fixedQuantities,bonuses:message.bonuses})).filter(row=>row.category==='mercenary'):[];
    const authorityMaximum=Math.max(0,Math.floor(Number(message.fixedAuthorityMaximum)||0));
    if(Object.keys(fixedQuantities).length&&authorityMaximum>0&&fixedUsage.AUTHORITY>authorityMaximum+1e-9)throw new Error(`The Standard mercenary stack uses ${Math.round(fixedUsage.AUTHORITY).toLocaleString()} Authority, which exceeds the entered maximum of ${authorityMaximum.toLocaleString()}. Reduce the Authority fill or selected mercenaries.`);
    let cumulativeEvaluations=0,lastRawEvaluations=0,lastEvaluationScope='';
    const result=optimizeEpicQuantities({units,selectedIds:message.selectedIds,bonuses:message.bonuses,capacityLimits:{...(message.capacityLimits||{})},minimumHealthSeparationPct:.01,minimumQuantity:1,onProgress:progress=>{
      const raw=Math.max(0,Number(progress.evaluations)||0);
      let scope=String(progress.phase||'');
      if(progress.phase==='local'||progress.phase==='polish')scope+=`|seed:${progress.seedIndex??''}`;
      else if(progress.phase==='counterfactual')scope+=`|basin:${progress.basinIndex??''}`;
      else if(progress.phase==='paired-counterfactual')scope+=`|pair:${progress.pairIndex??''}`;
      else if(progress.phase==='group-redistribution')scope+=`|group:${progress.groupIndex??''}`;
      else if(progress.phase==='convergence-polish')scope+=`|pass:${progress.passIndex??''}`;
      if(scope!==lastEvaluationScope){cumulativeEvaluations+=raw;lastEvaluationScope=scope;}else cumulativeEvaluations+=Math.max(0,raw-lastRawEvaluations);
      lastRawEvaluations=raw;
      self.postMessage({type:'progress',requestId,payload:{...progress,evaluations:cumulativeEvaluations,healthLadder:mergeFixedMercenaryLadder(progress.healthLadder,fixedMercenaryRows),progressPct:Math.min(97,progressPercent(progress))}});
    }});
    if(result&&Object.keys(fixedQuantities).length){
      const coreResult=result.result;
      const coreQuantities=Object.fromEntries((coreResult?.squads||[]).map(squad=>[squad.name,squad.quantity]));
      const combinedResult=scoreEpicArmy({units,quantities:{...coreQuantities,...fixedQuantities},bonuses:message.bonuses});
      result.quantities=Object.fromEntries((combinedResult.squads||[]).map(squad=>[squad.name,squad.quantity]));
      result.result=combinedResult;
      result.diagnostics={...(result.diagnostics||{}),fixedMercenaries:Object.keys(fixedQuantities).length,mercenaryOptimizationMode:'standard-live',optimizerCoreExpectedLifetimeDamage:Number(coreResult?.expectedTotalLifetimeDamage||0),combinedExpectedLifetimeDamage:Number(combinedResult.expectedTotalLifetimeDamage||0)};
    }
    self.postMessage({type:'progress',requestId,payload:{phase:'finalizing',progressPct:98,evaluations:result?.diagnostics?.totalEvaluations??result?.diagnostics?.evaluations}});
    self.postMessage({type:'result',requestId,payload:result,diagnostics:{optimizerBuild:EPIC_OPTIMIZER_BUILD,engineBuild:EPIC_COMBAT_ENGINE_BUILD,mechanicsBuild:COMBAT_MECHANICS_BUILD,armyDatabase:ARMY_DATABASE_BUILD,armyCount:units.length,seedStrategy:result?.diagnostics?.seedStrategy,totalEvaluations:result?.diagnostics?.totalEvaluations,inputPayload:message.bonuses,capacityLimits:message.capacityLimits,fixedCapacityUsage:fixedUsage}});
  }catch(error){self.postMessage({type:'error',requestId,message:error?.message||String(error),stack:error?.stack||''});}
};
