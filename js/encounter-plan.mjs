export const ENCOUNTER_PLAN_STRATEGIES=Object.freeze({
  full:Object.freeze({mercenary:1,monster:1,troop:1}),
  'mercenary-monster':Object.freeze({mercenary:1,monster:1,troop:0}),
  'mercenary-only':Object.freeze({mercenary:1,monster:0,troop:0}),
  none:Object.freeze({mercenary:0,monster:0,troop:0}),
});

export function calculateEncounterPlan({normPoints,pointsPerAttack,goldByCategory={},strategy='full'}={}){
  const norm=Math.max(0,Number(normPoints)||0);
  const points=Math.max(0,Number(pointsPerAttack)||0);
  const fractions=ENCOUNTER_PLAN_STRATEGIES[strategy]||ENCOUNTER_PLAN_STRATEGIES.full;
  const goldPerHit=['mercenary','monster','troop'].reduce((sum,category)=>sum+Math.max(0,Number(goldByCategory[category])||0)*fractions[category],0);
  const hits=norm>0&&points>0?Math.ceil(norm/points):0;
  return{hits,goldPerHit,totalGold:hits*goldPerHit,pointsPerGold:goldPerHit>0?points/goldPerHit:null};
}
