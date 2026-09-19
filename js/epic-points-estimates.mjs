// Observed Expected Lifetime Damage per Epic point. These encounter-specific
// averages convert the calculator's ELD into an estimated field-result score.
export const EPIC_ELD_PER_POINT=Object.freeze({
  ARACHNE:63450,
  ARCANOMANCER:53039,
  ARMAGEDDON:19766,
  ASHEN:62166,
  BASILISK:19243,
  BRIAREUS:56345,
  CHIMERA:46696,
  DOOMSDAY:55450,
  FENRIR:53953,
  HELLFORGE:18618,
  JORMUNGANDR:48862,
  'SHADOW CITY':10559,
});

export function estimatedEpicPoints(encounterName,expectedLifetimeDamage){
  const key=String(encounterName||'').trim().replace(/\s+/g,' ').toUpperCase();
  const eldPerPoint=EPIC_ELD_PER_POINT[key];
  const eld=Number(expectedLifetimeDamage);
  return eldPerPoint&&Number.isFinite(eld)&&eld>=0?eld/eldPerPoint:null;
}
