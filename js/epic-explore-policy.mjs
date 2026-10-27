export function exploreTimePolicy(depth=2){
  const tiers=Math.max(0,Math.min(4,Math.floor(Number(depth)||0)));
  const extra=Math.max(0,tiers-2);
  return {totalMs:(6+extra*2)*60_000,screeningMs:60_000+extra*30_000,neighborhoodMs:15_000+extra*5_000};
}
export function exploreTimeBudgetMs(depth=2){return exploreTimePolicy(depth).totalMs;}
