import {optimizeEpicQuantities} from './epic-quantity-optimizer.mjs';
import {runOptimizeReviewSelection} from './epic-review-engine.mjs';
import {preferHigherEldResult} from './epic-explore-compare.mjs';
import {compositionSignature} from './epic-composition-search.mjs';
import {scoreEpicArmy,validateArmyDatabase} from './epic-combat-engine-v2.mjs';
import {APP_BUILD,ARMY_DATABASE_BUILD,EPIC_COMBAT_ENGINE_BUILD,COMBAT_MECHANICS_BUILD,EPIC_OPTIMIZER_BUILD} from './build-info.mjs';

const OPTIMIZER_TIME_BUDGET_MS=180000;

let armyPromise;
function loadArmy(){
  if(!armyPromise)armyPromise=fetch(new URL('../data/army-v2.json',import.meta.url),{cache:'no-store'}).then(async response=>{
    if(!response.ok)throw new Error(`Unable to load canonical army database (${response.status}).`);
    const units=await response.json(),validation=validateArmyDatabase(units);
    if(!validation.valid)throw new Error(`Army database validation failed: ${validation.errors.join('; ')}`);
    return units;
  });
  return armyPromise;
}
function capacityUsage(units,quantities){
  const totals={LEADERSHIP:0,DOMINANCE:0,AUTHORITY:0};
  const byKey=new Map(units.flatMap(unit=>[[unit.id,unit],[unit.name,unit]]));
  for(const [key,value] of Object.entries(quantities||{})){
    const unit=byKey.get(key),quantity=Math.max(0,Number(value)||0);
    if(unit&&quantity)totals[unit.capacityType]+=quantity*Number(unit.capacityCost||0);
  }
  return totals;
}
function ladderRows(result){
  return (result?.squads||[]).filter(squad=>Number(squad.quantity)>0).map(squad=>({id:squad.id,category:squad.category,tier:squad.tier,effectiveHealth:squad.effectiveHealth,deathPosition:squad.predictedDeathPosition}));
}
function mergeFixedMercenaryLadder(coreRows,fixedRows){
  const combined=[...(Array.isArray(coreRows)?coreRows:[]),...fixedRows];
  return combined.sort((a,b)=>Number(b.effectiveHealth)-Number(a.effectiveHealth)||Number(a.deathPosition)-Number(b.deathPosition)).map((row,index)=>({...row,deathPosition:index+1}));
}
function progressPercent(progress){
  const fraction=(value,total)=>(Number(value||0)+1)/Math.max(1,Number(total||1));
  if(progress.phase==='seed-screen')return 5+Math.round(fraction(progress.seedIndex,progress.seedCount)*15);
  if(progress.phase==='local')return 22+Math.round(((Number(progress.seedIndex||0)+fraction(progress.stageIndex,progress.stageCount))/Math.max(1,Number(progress.seedCount||1)))*48);
  if(progress.phase==='evolution')return 72+Math.round((Number(progress.generation||0)/Math.max(1,Number(progress.generationCount||1)))*12);
  if(progress.phase==='threshold')return 84+Math.round((Number(progress.round||0)/Math.max(1,Number(progress.roundCount||1)))*4);
  if(progress.phase==='counterfactual')return 88+Math.round(fraction(progress.basinIndex,progress.basinCount)*3);
  if(progress.phase==='paired-counterfactual')return 91+Math.round(fraction(progress.pairIndex,progress.pairCount)*2);
  if(progress.phase==='group-redistribution')return 92+Math.round(fraction(progress.groupIndex,progress.groupCount)*2);
  if(progress.phase==='polish')return 95;
  if(progress.phase==='death-position'||progress.phase==='convergence-polish')return 96;
  return 10;
}

self.onmessage=async event=>{
  const message=event.data??{};if(message.type!=='optimize')return;
  const requestId=message.requestId;
  if(message.appBuild!==APP_BUILD){
    self.postMessage({
      type:'error',requestId,
      code:'BUILD_MISMATCH',
      message:'The calculator was updated while this page was open. Refresh the page and run Optimize again.',
      pageBuild:message.appBuild??null,
      workerBuild:APP_BUILD
    });
    return;
  }
  const startedAt=performance.now();
  const requestedBudget=Number(message.timeBudgetMs);
  const timeBudgetMs=Number.isFinite(requestedBudget)&&requestedBudget>0?Math.max(1000,requestedBudget):OPTIMIZER_TIME_BUDGET_MS;
  const shouldAbort=()=>performance.now()-startedAt>=timeBudgetMs;
  try{
    const units=await loadArmy();
    self.postMessage({type:'progress',requestId,payload:{phase:'loading',progressPct:2}});
    const fixedQuantities=message.fixedQuantities&&typeof message.fixedQuantities==='object'?{...message.fixedQuantities}:{};
    const fixedUsage=capacityUsage(units,fixedQuantities);
    const fixedMercenaryRows=Object.keys(fixedQuantities).length?ladderRows(scoreEpicArmy({units,quantities:fixedQuantities,bonuses:message.bonuses})).filter(row=>row.category==='mercenary'):[];
    const authorityMaximum=Math.max(0,Math.floor(Number(message.fixedAuthorityMaximum)||0));
    if(Object.keys(fixedQuantities).length&&authorityMaximum>0&&fixedUsage.AUTHORITY>authorityMaximum+1e-9)throw new Error(`The Standard mercenary stack uses ${Math.round(fixedUsage.AUTHORITY).toLocaleString()} Authority, which exceeds the entered maximum of ${authorityMaximum.toLocaleString()}. Reduce the Authority fill or selected mercenaries.`);
    let cumulativeEvaluations=0,lastRawEvaluations=0,lastEvaluationScope='',screeningEvaluations=0,verifiedBestEld=0;
    const optimizeOne=(selectedIds,exploreStage='',candidateIndex=0,candidateCount=0)=>{
      lastRawEvaluations=0;lastEvaluationScope='';
      const result=optimizeEpicQuantities({units,selectedIds,bonuses:message.bonuses,capacityLimits:{...(message.capacityLimits||{})},minimumHealthSeparationPct:.01,minimumQuantity:1,shouldAbort,onProgress:progress=>{
      const raw=Math.max(0,Number(progress.evaluations)||0);
      let scope=String(progress.phase||'');
      if(progress.phase==='local'||progress.phase==='polish')scope+=`|seed:${progress.seedIndex??''}`;
      else if(progress.phase==='counterfactual')scope+=`|basin:${progress.basinIndex??''}`;
      else if(progress.phase==='paired-counterfactual')scope+=`|pair:${progress.pairIndex??''}`;
      else if(progress.phase==='group-redistribution')scope+=`|group:${progress.groupIndex??''}`;
      else if(progress.phase==='convergence-polish')scope+=`|pass:${progress.passIndex??''}`;
      if(scope!==lastEvaluationScope){cumulativeEvaluations+=raw;lastEvaluationScope=scope;}else cumulativeEvaluations+=Math.max(0,raw-lastRawEvaluations);
      lastRawEvaluations=raw;
      self.postMessage({type:'progress',requestId,payload:{...progress,exploreStage,candidateIndex,candidateCount,screeningEvaluations,verifiedBestEld,evaluations:cumulativeEvaluations,healthLadder:mergeFixedMercenaryLadder(progress.healthLadder,fixedMercenaryRows),progressPct:message.exploreMode?Math.min(96,exploreStage==='baseline'?5+Math.round(progressPercent(progress)*.35):50+Math.round((candidateIndex-1+progressPercent(progress)/100)*43/Math.max(1,candidateCount))):Math.min(97,progressPercent(progress))}});
      }});
      if(!result||!Object.keys(fixedQuantities).length)return result;
      const coreResult=result.result;
      const coreQuantities=Object.fromEntries((coreResult?.squads||[]).map(squad=>[squad.name,squad.quantity]));
      const combinedResult=scoreEpicArmy({units,quantities:{...coreQuantities,...fixedQuantities},bonuses:message.bonuses});
      result.quantities=Object.fromEntries((combinedResult.squads||[]).map(squad=>[squad.name,squad.quantity]));
      result.result=combinedResult;
      result.diagnostics={...(result.diagnostics||{}),fixedMercenaries:Object.keys(fixedQuantities).length,mercenaryOptimizationMode:'standard-live',optimizerCoreExpectedLifetimeDamage:Number(coreResult?.expectedTotalLifetimeDamage||0),combinedExpectedLifetimeDamage:Number(combinedResult.expectedTotalLifetimeDamage||0)};
      return result;
    };
    let result=message.exploreMode&&message.baselineResult?.result?.expectedTotalLifetimeDamage>0
      ?structuredClone(message.baselineResult)
      :optimizeOne(message.selectedIds,message.exploreMode?'baseline':'');
    delete result.exploredSelectedIds;delete result.exploration;
    const baselineEld=Number(result?.result?.expectedTotalLifetimeDamage||0);
    verifiedBestEld=baselineEld;
    let explored=0,explorationNote='';
    if(message.exploreMode){
      // A reusable baseline skips optimizeOne's progress events. Always send its
      // actual ladder before screening so the popup never starts with a blank chart.
      self.postMessage({type:'progress',requestId,payload:{phase:'baseline-ready',exploreStage:'baseline-ready',progressPct:40,expectedLifetimeDamage:baselineEld,verifiedBestEld,healthLadder:ladderRows(result?.result),evaluations:cumulativeEvaluations}});
      const originalIds=[...message.selectedIds,...(message.fixedMercenaryIds||[])];
      let review=null;
      try{
        const remaining=timeBudgetMs-(performance.now()-startedAt);
        if(remaining>25_000)review=await runOptimizeReviewSelection({units,currentIds:originalIds,bonuses:message.bonuses,capacityLimits:message.capacityLimits,fixedQuantities,maxTierDepth:Math.max(0,Math.min(4,Number(message.exploreTierDepth)||0)),includeChallengeFinalists:true,timeBudgetMs:Math.min(45_000,remaining-20_000),onProgress:progress=>{screeningEvaluations=Number(progress.evaluations)||0;self.postMessage({type:'progress',requestId,payload:{phase:'explore-screen',exploreStage:'screen',progressPct:40+Math.round(Number(progress.progressPct||0)*.09),screeningEvaluations,verifiedBestEld,evaluations:cumulativeEvaluations}});}});
      }catch(error){if(error?.code!=='TIME_BUDGET')throw error;explorationNote='The unit-combination screen reached its time limit; your original optimized army was kept.';}
      const byId=new Map(units.map(unit=>[unit.id,unit]));
      const fixedNames=new Set(Object.keys(fixedQuantities));
      const baselineMercs=new Set(originalIds.filter(id=>byId.get(id)?.category==='mercenary'));
      screeningEvaluations=review?.evaluations??screeningEvaluations;
      const seen=new Set([compositionSignature(originalIds)]);
      const candidates=[...(review?.challengeFinalists||[]),...(review?.finalists||[])].filter(row=>{
        const signature=compositionSignature(row.selectedIds);
        if(seen.has(signature)||!row.selectedIds.some(id=>byId.get(id)?.category==='troop'||byId.get(id)?.category==='monster')||row.selectedIds.filter(id=>byId.get(id)?.category==='mercenary').length!==baselineMercs.size||![...baselineMercs].every(id=>row.selectedIds.includes(id)))return false;
        seen.add(signature);return true;
      }).slice(0,7);
      self.postMessage({type:'progress',requestId,payload:{phase:'explore-screen',exploreStage:'screen-complete',progressPct:49,screeningEvaluations,candidateCount:candidates.length,verifiedBestEld,evaluations:cumulativeEvaluations}});
      for(const [index,candidate] of candidates.entries()){
        if(timeBudgetMs-(performance.now()-startedAt)<20_000){explorationNote='The search reached its time limit; the best fully optimized army so far was kept.';break;}
        const selectedIds=candidate.selectedIds.filter(id=>!fixedNames.has(byId.get(id)?.name));
        try{
          const trial=optimizeOne(selectedIds,'finalist',index+1,candidates.length);explored++;
          if(preferHigherEldResult(result,trial)===trial){result=trial;result.exploredSelectedIds=candidate.selectedIds;}
          verifiedBestEld=Number(result?.result?.expectedTotalLifetimeDamage||0);
          self.postMessage({type:'progress',requestId,payload:{phase:'finalist-complete',exploreStage:'finalist-complete',candidateIndex:index+1,candidateCount:candidates.length,expectedLifetimeDamage:Number(trial?.result?.expectedTotalLifetimeDamage||0),verifiedBestEld,healthLadder:ladderRows(trial?.result),screeningEvaluations,evaluations:cumulativeEvaluations,progressPct:50+Math.round((index+1)*43/Math.max(1,candidates.length))}});
        }catch(error){if(error?.code!=='TIME_BUDGET'&&!shouldAbort())throw error;explorationNote='The search reached its time limit; the best fully optimized army so far was kept.';break;}
      }
      result.exploration={baselineEld,finalEld:Number(result?.result?.expectedTotalLifetimeDamage||0),screeningEvaluations,screenedCandidates:candidates.length,finalistCount:candidates.length,fullyOptimizedCandidates:explored,changedSelection:!!result.exploredSelectedIds,note:explorationNote};
    }
    self.postMessage({type:'progress',requestId,payload:{phase:'finalizing',progressPct:98,evaluations:result?.diagnostics?.totalEvaluations??result?.diagnostics?.evaluations}});
    self.postMessage({type:'result',requestId,payload:result,diagnostics:{optimizerBuild:EPIC_OPTIMIZER_BUILD,engineBuild:EPIC_COMBAT_ENGINE_BUILD,mechanicsBuild:COMBAT_MECHANICS_BUILD,armyDatabase:ARMY_DATABASE_BUILD,armyCount:units.length,seedStrategy:result?.diagnostics?.seedStrategy,totalEvaluations:result?.diagnostics?.totalEvaluations,inputPayload:message.bonuses,capacityLimits:message.capacityLimits,fixedCapacityUsage:fixedUsage,timeBudgetMs}});
  }catch(error){
    const timedOut=error?.code==='TIME_BUDGET'||shouldAbort();
    self.postMessage({
      type:'error',requestId,
      code:timedOut?'TIME_BUDGET':error?.code,
      message:timedOut?`Optimization reached its ${message.exploreMode?'6-minute':'3-minute'} safety limit. Try narrowing the tier range or reducing the number of selected squads.`:(error?.message||String(error)),
      stack:error?.stack||''
    });
  }
};
