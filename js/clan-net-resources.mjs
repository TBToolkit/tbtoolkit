const multipliers={B:1e9,M:1e6,K:1e3};

export function linkedPlayerAccounts(savedState,profileId){
  return Object.values(savedState?.accounts||{}).filter(account=>account?.clanProfileId===profileId).map(account=>({id:account.id,name:account.name||'Player'}));
}

export function planForMethod(bridge,accountId,encounterName,method){
  const account=bridge?.accounts?.[accountId];
  const encounter=Object.values(account?.encounters||{}).find(item=>String(item?.name||'').toUpperCase()===String(encounterName||'').toUpperCase());
  const plan=encounter?.plansByMethod?.[method];
  return plan?.method===method?plan:null;
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
  const epics=activities.filter(activity=>activity.category==='Epic monsters');
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
