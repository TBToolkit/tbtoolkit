const MAX_POINTS=240;

export function createOptimizerSearchJourney(){return{points:[],best:0};}

export function recordOptimizerSearchJourney(journey,progress){
  const eld=Number(progress?.expectedLifetimeDamage);
  if(!Number.isFinite(eld)||eld<=0)return false;
  const previous=journey.points.at(-1);
  const reported=Number(progress?.evaluations);
  const evaluations=Math.max(previous?.evaluations||0,Number.isFinite(reported)&&reported>=0?reported:0);
  const reportedBest=Number(progress?.bestExpectedLifetimeDamage);
  const best=Math.max(journey.best,eld,Number.isFinite(reportedBest)?reportedBest:0);
  const point={evaluations,eld,best,phase:String(progress?.phase||'search')};
  if(previous?.evaluations===evaluations&&previous.phase===point.phase)journey.points[journey.points.length-1]=point;
  else journey.points.push(point);
  journey.best=best;
  if(journey.points.length>MAX_POINTS){
    const last=journey.points.length-1;
    journey.points=journey.points.filter((_,index)=>index===0||index===last||index%2===0);
  }
  return true;
}
