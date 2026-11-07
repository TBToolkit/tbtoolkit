// Normalized cycle starts work with both chart sizes. The live optimizer's
// compact snapshots omit cycle maps, so derive their cycle from death position:
// each enemy squad kills one friendly squad per cycle in the Epic model.
export function battleCycleGuides(rows,{separated=false,enemySquadCount=0}={}){
  const groups=separated?['troop','monster','mercenary'].map(category=>({category,rows:rows.filter(r=>r.category===category)})):[{category:null,rows:[...rows]}];
  return groups.flatMap(group=>{
    const ordered=group.rows.slice().sort((a,b)=>Number(a.deathPosition)-Number(b.deathPosition));
    let previous=null;
    return ordered.flatMap((row,index)=>{
      const explicit=Number(row.cycle),position=Number(row.deathPosition);
      const cycle=Number.isInteger(explicit)&&explicit>0?explicit:Number.isInteger(enemySquadCount)&&enemySquadCount>0&&Number.isInteger(position)&&position>0?Math.ceil(position/enemySquadCount):null;
      if(cycle===null||cycle===previous)return[];
      previous=cycle;
      return[{category:group.category,cycle,fraction:ordered.length<=1?.5:Math.max(0,index-.5)/(ordered.length-1)}];
    });
  });
}
