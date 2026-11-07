export const DEFAULT_EXPLORE_TIER_DEPTHS=Object.freeze({guardsman:1,specialist:1,engineer:1,monster:2});

export function normalizeExploreTierDepths(value){
  const object=value&&typeof value==='object';
  return Object.fromEntries(Object.entries(DEFAULT_EXPLORE_TIER_DEPTHS).map(([family,fallback])=>{
    const raw=object?value[family]:value;
    const n=raw===undefined||raw===null?fallback:Number(raw);
    return [family,Number.isFinite(n)?Math.max(0,Math.min(4,Math.floor(n))):fallback];
  }));
}

export function exploreTimePolicy(depth=DEFAULT_EXPLORE_TIER_DEPTHS){
  const tiers=Math.max(...Object.values(normalizeExploreTierDepths(depth)));
  const extra=Math.max(0,tiers-2);
  return {totalMs:(6+extra*2)*60_000,screeningMs:60_000+extra*30_000,neighborhoodMs:15_000+extra*5_000};
}
export function exploreTimeBudgetMs(depth=DEFAULT_EXPLORE_TIER_DEPTHS){return exploreTimePolicy(depth).totalMs;}
