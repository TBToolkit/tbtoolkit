export const ENCOUNTER_PLAN_STRATEGIES=Object.freeze({
  full:Object.freeze({mercenary:1,monster:1,troop:1}),
  'mercenary-monster':Object.freeze({mercenary:1,monster:1,troop:0}),
  'mercenary-only':Object.freeze({mercenary:1,monster:0,troop:0}),
});

export function calculateEncounterPlan({normPoints,pointsPerAttack,goldByCategory={},rebuildRows=[],strategy='full'}={}){
  const norm=Math.max(0,Number(normPoints)||0);
  const points=Math.max(0,Number(pointsPerAttack)||0);
  const fractions=ENCOUNTER_PLAN_STRATEGIES[strategy]||ENCOUNTER_PLAN_STRATEGIES.full;
  const goldPerHit=['mercenary','monster','troop'].reduce((sum,category)=>sum+Math.max(0,Number(goldByCategory[category])||0)*fractions[category],0);
  const hits=norm>0&&points>0?Math.ceil(norm/points):0;
  let silverPerHit=0,dragonCoinsPerHit=0,rebuildCostsComplete=true;
  for(const row of rebuildRows){
    const category=String(row?.category||'');
    const quantity=Math.max(0,Math.floor(Number(row?.quantity)||0));
    const revivableQuantity=Math.max(0,Math.min(quantity,Math.floor(Number(row?.revivableQuantity)||0)));
    const goldRevived=fractions[category]||0;
    const rebuildQuantity=quantity-revivableQuantity*goldRevived;
    if(category==='mercenary')continue;
    const silverEach=Number(row?.silverEach),dragonCoinsEach=Number(row?.dragonCoinsEach);
    if(!Number.isFinite(silverEach)||!Number.isFinite(dragonCoinsEach)){
      rebuildCostsComplete=false;
      continue;
    }
    silverPerHit+=rebuildQuantity*Math.max(0,silverEach);
    dragonCoinsPerHit+=rebuildQuantity*Math.max(0,dragonCoinsEach);
  }
  return{
    hits,goldPerHit,silverPerHit,dragonCoinsPerHit,rebuildCostsComplete,
    totalGold:hits*goldPerHit,totalSilver:hits*silverPerHit,totalDragonCoins:hits*dragonCoinsPerHit,
    pointsPerGold:goldPerHit>0?points/goldPerHit:null,
  };
}
