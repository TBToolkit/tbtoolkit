export function preferHigherEldResult(current,trial){
  const currentEld=Number(current?.result?.expectedTotalLifetimeDamage||0);
  const trialEld=Number(trial?.result?.expectedTotalLifetimeDamage||0);
  return Number.isFinite(trialEld)&&trialEld>currentEld+Math.max(1e-6,currentEld*1e-9)?trial:current;
}
