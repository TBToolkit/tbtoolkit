// Epic cycles contain one enemy attack (and friendly death) per enemy squad.
// Use the same death cycles as Battle Details; live snapshots can derive them
// from death position. Reserve the entire last cycle, even when it is partial.
export function battleCycleLayout(rows,{separated=false,enemySquadCount=0}={}){
  if(separated)return null;
  const count=Number.isInteger(enemySquadCount)&&enemySquadCount>0?enemySquadCount:0;
  const valid=rows.map(row=>{
    const position=Number(row.deathPosition),explicit=Number(row.cycle);
    const cycle=Number.isInteger(explicit)&&explicit>0?explicit:count&&Number.isInteger(position)&&position>0?Math.ceil(position/count):null;
    return {position,cycle};
  }).filter(row=>row.cycle!==null&&Number.isInteger(row.position)&&row.position>0);
  if(!valid.length)return null;
  const lastCycle=Math.max(...valid.map(row=>row.cycle));
  const pointFractions=new Map(valid.map(row=>{
    const inCycle=count?(row.position-1)%count:valid.filter(other=>other.cycle===row.cycle&&other.position<row.position).length;
    const size=count||valid.filter(other=>other.cycle===row.cycle).length;
    return [row.position,(row.cycle-1+inCycle/size)/lastCycle];
  }));
  return {
    lastCycle,pointFractions,
    guides:Array.from({length:lastCycle},(_,i)=>({cycle:i+1,fraction:i/lastCycle,centerFraction:(i+.5)/lastCycle})),
    ticks:Array.from({length:lastCycle+1},(_,i)=>({cycle:i+1,fraction:i/lastCycle})),
  };
}
