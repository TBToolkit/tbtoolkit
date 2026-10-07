export function optimizerLadderRows(result){
  return(Array.isArray(result?.squads)?result.squads:[])
    .filter(squad=>Number(squad.quantity)>0)
    .map(squad=>({id:squad.id,category:squad.category,tier:squad.tier,effectiveHealth:squad.effectiveHealth,deathPosition:squad.predictedDeathPosition}));
}

export function createExploreProgressState(baselinePayload=null){
  const baselineEld=Math.max(0,Number(baselinePayload?.result?.expectedTotalLifetimeDamage)||0);
  return{
    trialKey:'baseline',trialBestEld:baselineEld,currentEld:baselineEld,
    verifiedBestEld:baselineEld,rows:optimizerLadderRows(baselinePayload?.result),
    chartTitle:'Starting Army Health Ladder',
    emptyMessage:'Optimizing your starting army…',revision:baselineEld>0?1:0
  };
}

export function advanceExploreProgress(previous,progress={}){
  const next={...previous};
  const value=Math.max(0,Number(progress.expectedLifetimeDamage)||0);
  const verified=Math.max(0,Number(progress.verifiedBestEld)||0);
  if(verified>0)next.verifiedBestEld=Math.max(next.verifiedBestEld,verified);

  if(progress.exploreStage==='baseline-ready'){
    next.trialKey='baseline';next.trialBestEld=value;next.currentEld=value;
    next.verifiedBestEld=Math.max(next.verifiedBestEld,value);
    next.rows=Array.isArray(progress.healthLadder)?progress.healthLadder:[];
    next.chartTitle='Starting Army Health Ladder';next.revision++;
    return next;
  }
  if(progress.exploreStage==='screen'||progress.exploreStage==='screen-complete'){
    next.chartTitle='Starting Army Health Ladder';
    next.emptyMessage='Screening unit combinations…';
    return next;
  }
  if(progress.exploreStage==='finalist'||progress.exploreStage==='finalist-complete'){
    const key=`finalist-${Number(progress.candidateIndex)||0}`;
    if(key!==next.trialKey){
      next.trialKey=key;next.trialBestEld=0;next.currentEld=0;
      next.rows=[];next.revision++;
    }
    next.chartTitle=`Finalist ${Number(progress.candidateIndex)||0} of ${Number(progress.candidateCount)||0} Health Ladder`;
    next.emptyMessage=`Preparing finalist ${Number(progress.candidateIndex)||0}…`;
    if(progress.exploreStage==='finalist-complete'){
      next.currentEld=value;next.trialBestEld=value;
      if(Array.isArray(progress.healthLadder)){next.rows=progress.healthLadder;next.revision++;}
      next.verifiedBestEld=Math.max(next.verifiedBestEld,verified);
    }else if(value>next.trialBestEld&&Array.isArray(progress.healthLadder)){
      next.currentEld=value;next.trialBestEld=value;
      next.rows=progress.healthLadder;next.revision++;
    }
    return next;
  }
  if(progress.exploreStage==='baseline'&&value>next.trialBestEld&&Array.isArray(progress.healthLadder)){
    next.trialBestEld=value;next.currentEld=value;
    next.rows=progress.healthLadder;next.revision++;
  }
  return next;
}
