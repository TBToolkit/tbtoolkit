import {calculateEncounterPlan,ENCOUNTER_PLAN_STRATEGIES} from './encounter-plan.mjs';
import {OPTIMIZER_CACHE_BUILD} from './build-info.mjs';
import {estimatedEpicPoints} from './epic-points-estimates.mjs';

const multipliers={B:1e9,M:1e6,K:1e3};

export function linkedPlayerAccounts(savedState,profileId){
  return Object.values(savedState?.accounts||{}).filter(account=>account?.clanProfileId===profileId).map(account=>({id:account.id,name:account.name||'Player'}));
}

export function planFromSavedCosts(bridge,accountId,activity,method,clanMembers,profileId,{selectedStrategy}={}){
  const encounter=Object.values(bridge?.accounts?.[accountId]?.encounters||{}).find(item=>String(item?.name||'').toUpperCase()===String(activity?.name||'').toUpperCase());
  const model=encounter?.methods?.[method]?.costModel,requirement=activity?.norm,reward=activity?.reward;
  if(!model||model.build!==OPTIMIZER_CACHE_BUILD||!(Number(model.pointsPerAttack)>0)||!Array.isArray(model.rebuildRows)||!requirement||!reward||!(Number(requirement.pointsPerChest)>0))return null;
  const normPoints=requirement.basis==='chests'?Number(requirement.value)*requirement.pointsPerChest:Number(requirement.value)*(multipliers[requirement.unit]||0);
  const members=Number(clanMembers),chestsPerMember=Math.floor(normPoints/requirement.pointsPerChest);
  if(!Number.isFinite(normPoints)||normPoints<=0||!Number.isInteger(members)||members<=0||chestsPerMember<=0)return null;
  const received={gold:chestsPerMember*members*(Number(reward.gold)||0),potion:chestsPerMember*members*(Number(reward.potion)||0),silver:chestsPerMember*members*(Number(reward.silver)||0),dragonCoins:chestsPerMember*members*(Number(reward.dragonCoins)||0)};
  const outcomes=Object.fromEntries(Object.keys(ENCOUNTER_PLAN_STRATEGIES).map(strategy=>{
    const costs=calculateEncounterPlan({normPoints,pointsPerAttack:model.pointsPerAttack,goldByCategory:model.goldByCategory,rebuildRows:model.rebuildRows,strategy});
    const revival=received.gold+received.potion;
    return[strategy,{hits:costs.hits,gold:{spent:costs.totalGold,received:revival,goldReceived:received.gold,potionReceived:received.potion,net:revival-costs.totalGold},silver:{spent:costs.totalSilver,received:received.silver,net:received.silver-costs.totalSilver},dragonCoins:{spent:costs.totalDragonCoins,received:received.dragonCoins,net:received.dragonCoins-costs.totalDragonCoins},complete:costs.rebuildCostsComplete}];
  }));
  const saved=encounter.plansByMethod?.[method],strategy=Object.hasOwn(outcomes,selectedStrategy)?selectedStrategy:Object.hasOwn(outcomes,saved?.selectedStrategy)?saved.selectedStrategy:'full';
  return{method,profileId,norm:Number(requirement.value),unit:requirement.unit,basis:requirement.basis,clanMembers:members,selectedStrategy:strategy,outcomes,savedAt:encounter.methods[method].savedAt||saved?.savedAt||0};
}

export function tinmanPlanFromSavedCosts(bridge,accountId,{normValue,normUnit='B',normBillions,bonus,method,selectedStrategy}={}){
  const encounter=Object.values(bridge?.accounts?.[accountId]?.encounters||{}).find(item=>String(item?.name||'').toUpperCase()==='TINMAN');
  const result=encounter?.methods?.[method],model=result?.costModel;
  const norm=normValue===undefined?Number(normBillions)*1e9:Number(normValue)*(multipliers[normUnit]||0),pointsPerAttack=estimatedEpicPoints('Tinman',result?.expectedLifetimeDamage,{tinmanBonus:bonus});
  if(!model||model.build!==OPTIMIZER_CACHE_BUILD||!(norm>0)||!(pointsPerAttack>0)||!Array.isArray(model.rebuildRows))return null;
  const saved=encounter.plansByMethod?.[method],strategy=Object.hasOwn(ENCOUNTER_PLAN_STRATEGIES,selectedStrategy)?selectedStrategy:Object.hasOwn(ENCOUNTER_PLAN_STRATEGIES,saved?.selectedStrategy)?saved.selectedStrategy:'full';
  const outcomes=Object.fromEntries(Object.keys(ENCOUNTER_PLAN_STRATEGIES).map(strategy=>{
    const costs=calculateEncounterPlan({normPoints:norm,pointsPerAttack,goldByCategory:model.goldByCategory,rebuildRows:model.rebuildRows,strategy});
    return[strategy,{hits:costs.hits,gold:{spent:costs.totalGold},silver:{spent:costs.totalSilver},dragonCoins:{spent:costs.totalDragonCoins},complete:costs.rebuildCostsComplete}];
  }));
  return{method,selectedStrategy:strategy,outcomes,pointsPerAttack};
}

export function planMatchesRequirement(plan,requirement,clanMembers,profileId,{acceptUnlinkedPlan=false}={}){
  if(!plan||(plan.profileId!==profileId&&!(acceptUnlinkedPlan&&!plan.profileId))||!requirement||Number(plan.clanMembers)!==Number(clanMembers))return false;
  const basis=plan.basis==='chests'?'chests':'points';
  const points=basis==='chests'?Number(plan.norm)*requirement.pointsPerChest:Number(plan.norm)*(multipliers[plan.unit]||0);
  const expected=requirement.basis==='chests'?Number(requirement.value)*requirement.pointsPerChest:Number(requirement.value)*(multipliers[requirement.unit]||0);
  if(!Number.isFinite(points)||!Number.isFinite(expected)||points<=0||expected<=0)return false;
  if(Math.abs(points-expected)<=Math.max(1,expected*1e-8))return true;
  if(basis===requirement.basis||!(requirement.pointsPerChest>0))return false;
  const plannedChests=basis==='chests'?Math.floor(Number(plan.norm)):Math.floor(points/requirement.pointsPerChest);
  const requiredChests=requirement.basis==='chests'?Math.floor(Number(requirement.value)):Math.floor(expected/requirement.pointsPerChest);
  return plannedChests>0&&plannedChests===requiredChests;
}

export function convertEpicNormBasis({value,unit='B',basis='points',pointsPerChest},targetBasis){
  const amount=Number(value),chestPoints=Number(pointsPerChest);
  if(!Number.isFinite(amount)||amount<=0||!Number.isFinite(chestPoints)||chestPoints<=0)return{value:0,unit,basis:targetBasis};
  if(basis===targetBasis)return{value:amount,unit,basis};
  if(targetBasis==='chests')return{value:Math.floor(amount*(multipliers[unit]||0)/chestPoints),unit,basis:'chests'};
  const points=amount*chestPoints;
  const nextUnit=points>=1e9?'B':points>=1e6?'M':'K';
  return{value:Number((points/multipliers[nextUnit]).toPrecision(12)),unit:nextUnit,basis:'points'};
}

export function netResourcesForPeriod(activities,selectedPlans,periodDays){
  const epics=activities.filter(activity=>activity.category==='Epic monsters'||activity.category==='Tinman');
  const missing=epics.filter(activity=>!selectedPlans.get(activity.name)?.outcomes?.[selectedPlans.get(activity.name)?.selectedStrategy]?.complete);
  if(missing.length)return{complete:false,missing:missing.map(activity=>activity.name)};
  const gross=key=>activities.reduce((sum,activity)=>sum+(Number(activity.prorated)||0)*(Number(activity.reward?.[key])||0),0);
  const spent={revival:0,silver:0,dragonCoins:0};
  for(const activity of epics){
    const plan=selectedPlans.get(activity.name),outcome=plan.outcomes[plan.selectedStrategy],scale=periodDays/activity.cadence;
    spent.revival+=(Number(outcome.gold?.spent)||0)*scale;
    spent.silver+=(Number(outcome.silver?.spent)||0)*scale;
    spent.dragonCoins+=(Number(outcome.dragonCoins?.spent)||0)*scale;
  }
  const received={revival:gross('gold')+gross('potion'),silver:gross('silver'),dragonCoins:gross('dragonCoins')};
  return{complete:true,received,spent,net:{revival:received.revival-spent.revival,silver:received.silver-spent.silver,dragonCoins:received.dragonCoins-spent.dragonCoins}};
}
