// Observed Expected Lifetime Damage per Epic point. These encounter-specific
// averages convert the calculator's ELD into an estimated field-result score.
export const EPIC_ELD_PER_POINT=Object.freeze({
  ARACHNE:63450,
  ARCANOMANCER:53039,
  ARMAGEDDON:19359,
  ASHEN:62186,
  BASILISK:19243,
  BRIAREUS:55771,
  CHIMERA:46696,
  DOOMSDAY:55450,
  FENRIR:53953,
  HELLFORGE:18618,
  JORMUNGANDR:48862,
  'SHADOW CITY':10559,
});

// 25,508 ELD/point was observed with a 100% Tinman point bonus.
export const TINMAN_BASE_ELD_PER_POINT=51016;

export function estimatedEpicPoints(encounterName,expectedLifetimeDamage,{tinmanBonus=0}={}){
  const key=String(encounterName||'').trim().replace(/\s+/g,' ').toUpperCase();
  const bonus=Math.min(100,Math.max(0,Number(tinmanBonus)||0));
  const eldPerPoint=key==='TINMAN'?TINMAN_BASE_ELD_PER_POINT/(1+bonus/100):EPIC_ELD_PER_POINT[key];
  const eld=Number(expectedLifetimeDamage);
  return eldPerPoint&&Number.isFinite(eld)&&eld>=0?eld/eldPerPoint:null;
}
