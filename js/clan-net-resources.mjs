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

export function planMatchesRequirement(plan,requirement,clanMembers,profileId){
  if(!plan||plan.profileId!==profileId||!requirement||Number(plan.clanMembers)!==Number(clanMembers))return false;
  const basis=plan.basis==='chests'?'chests':'points';
  const points=basis==='chests'?Number(plan.norm)*requirement.pointsPerChest:Number(plan.norm)*(multipliers[plan.unit]||0);
  const expected=requirement.basis==='chests'?Number(requirement.value)*requirement.pointsPerChest:Number(requirement.value)*(multipliers[requirement.unit]||0);
  return Number.isFinite(points)&&Number.isFinite(expected)&&points>0&&Math.abs(points-expected)<=Math.max(1,expected*1e-8);
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
