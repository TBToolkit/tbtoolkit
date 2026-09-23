import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import {scoreEpicArmy} from '../js/epic-combat-engine-v2.mjs';
import {optimizeEpicQuantities} from '../js/epic-quantity-optimizer.mjs';

const exportPath=process.argv[2];
const encounterIds=process.argv.slice(3).filter(value=>value!=='--full');
if(!exportPath||!encounterIds.length)throw new Error('Usage: node tests/second-pass-seed-experiment.mjs <account.stacks> <epic-id>...');
const account=JSON.parse(fs.readFileSync(exportPath,'utf8'));
if(account.format!=='tbtoolkit-biff'||account.kind!=='account')throw new Error('Expected a TB Toolkit account export.');
const units=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const byId=new Map(units.map(unit=>[unit.id,unit]));
const number=value=>Number(String(value??0).replaceAll(',',''))||0;

function inputsFor(workspace){
  const i=workspace.inputs;
  const limit=(name,fill,auto)=>Math.floor(number(i[name])*(i[auto]?1:Math.max(0,Math.min(1,number(i[fill])/100))));
  const profiles=['beast','dragon','elemental','giant','guardsman','specialist','engineer','human','epicHunter'];
  const stats=['Health','Strength','DD','ST'];
  return{
    selectedIds:[...workspace.selectedIds.troop,...workspace.selectedIds.monster,...(i.includeMercenariesInOptimization?workspace.selectedIds.mercenary:[])],
    capacityLimits:{LEADERSHIP:limit('leadership','leadershipFill','autoLeadership'),DOMINANCE:limit('dominance','dominanceFill','autoDominance'),AUTHORITY:i.includeMercenariesInOptimization?limit('authority','authorityFill','autoAuthority'):0},
    bonuses:{monsterHealthPct:number(i.monsterHealth),monsterStrengthPct:number(i.monsterStrength),strengthAgainstEpicPct:number(i.strengthAgainstEpic),monsterDDPct:number(i.monsterDD),monsterSTPct:number(i.monsterST),arachne:!!i.arachne,enemySquadTypes:i.enemySquadTypes,includeMercenariesInOptimization:!!i.includeMercenariesInOptimization,useCustomProfileBonuses:true,customProfileBonuses:Object.fromEntries(profiles.flatMap(profile=>stats.map(stat=>[`${profile}${stat}Pct`,number(i[`${profile}${stat}`])])))}
  };
}
function deathOrder(result){return result.squads.slice().sort((a,b)=>a.predictedDeathPosition-b.predictedDeathPosition).map(s=>s.id).join('|');}
function candidateSeeds(base,params){
  const selected=params.selectedIds.map(id=>byId.get(id)).filter(Boolean);
  const groups=['LEADERSHIP','DOMINANCE','AUTHORITY'].map(type=>({type,units:selected.filter(unit=>unit.capacityType===type)})).filter(group=>group.units.length>1);
  const candidates=[];
  for(const {type,units:group} of groups){
    for(const fraction of [.005,.015,.04]){
      for(const donor of group){
        for(const receiver of group){
          if(donor.id===receiver.id)continue;
          const movedCapacity=Math.round(params.capacityLimits[type]*fraction);
          const give=Math.min(number(base[donor.name])-1,Math.max(1,Math.floor(movedCapacity/number(donor.capacityCost))));
          if(give<1)continue;
          const receive=Math.floor(give*number(donor.capacityCost)/number(receiver.capacityCost));
          if(receive<1)continue;
          const quantities={...base,[donor.name]:number(base[donor.name])-give,[receiver.name]:number(base[receiver.name])+receive};
          const result=scoreEpicArmy({units,quantities,bonuses:params.bonuses,recordEvents:false});
          candidates.push({quantities,eld:result.expectedTotalLifetimeDamage,deathOrder:deathOrder(result),transfer:`${donor.tier}->${receiver.tier}`,fraction});
        }
      }
    }
  }
  return candidates.sort((a,b)=>b.eld-a.eld);
}
function runLocal(params,seed){
  const started=performance.now();
  const optimized=optimizeEpicQuantities({...params,units,initialQuantities:seed,minimumHealthSeparationPct:.01,minimumQuantity:1,stageFractions:[.01,.005,.001,.0002],maxRoundsPerStage:4});
  return{eld:optimized.result.expectedTotalLifetimeDamage,quantities:optimized.quantities,elapsedMs:performance.now()-started,evaluations:optimized.diagnostics.evaluations};
}

for(const encounterId of encounterIds){
  const experimentStarted=performance.now();
  const workspace=account.account.workspaces.find(row=>row.encounterId===encounterId);
  if(!workspace?.resultCache?.payload?.quantities)throw new Error(`Missing saved optimizer result for ${encounterId}.`);
  const params=inputsFor(workspace);
  const baseline=workspace.resultCache.payload;
  const rescored=scoreEpicArmy({units,quantities:baseline.quantities,bonuses:params.bonuses,recordEvents:false});
  const baselineEld=number(baseline.result.expectedTotalLifetimeDamage);
  const scoreMismatchPct=baselineEld?100*(rescored.expectedTotalLifetimeDamage/baselineEld-1):null;
  if(Math.abs(scoreMismatchPct)>1e-7){
    console.log(JSON.stringify({encounterId,skipped:'Saved ELD does not match current exported inputs.',scoreMismatchPct},null,2));
    continue;
  }
  const screenStarted=performance.now();
  const screened=candidateSeeds(baseline.quantities,params);
  const screeningElapsedMs=performance.now()-screenStarted;
  const baselineOrder=deathOrder(rescored);
  const distinct=[];const seen=new Set([baselineOrder]);
  for(const candidate of screened){
    if(seen.has(candidate.deathOrder))continue;
    if(candidate.eld<baselineEld*.98)continue;
    distinct.push(candidate);seen.add(candidate.deathOrder);
    if(distinct.length>=3)break;
  }
  console.error(`[${encounterId}] ${params.selectedIds.length} selected units, ${screened.length} screened variants, ${distinct.length} alternate death orders`);
  const runs=[];
  let best={eld:baselineEld,quantities:baseline.quantities};
  for(const [label,seed] of [['winner',baseline.quantities],...distinct.map((candidate,index)=>[`alternate-${index+1}`,candidate.quantities])]){
    try{
      const result=runLocal(params,seed);
      if(result.eld>best.eld)best=result;
      runs.push({label,seedEld:label==='winner'?baselineEld:distinct[number(label.slice(-1))-1].eld,eld:result.eld,elapsedMs:result.elapsedMs,evaluations:result.evaluations,gainPct:100*(result.eld/baselineEld-1)});
      console.error(`[${encounterId}] ${label}: ${runs.at(-1).gainPct.toFixed(5)}% vs saved winner in ${(result.elapsedMs/1000).toFixed(1)}s`);
    }catch(error){runs.push({label,error:error.message});console.error(`[${encounterId}] ${label}: ${error.message}`);}
  }
  const followUp=runLocal(params,best.quantities);
  let productionRun=null;
  if(process.argv.includes('--full')){
    const started=performance.now();
    const optimized=optimizeEpicQuantities({...params,units,minimumHealthSeparationPct:.01,minimumQuantity:1,remainingTimeMs:()=>180000-(performance.now()-started),shouldAbort:()=>performance.now()-started>=180000});
    productionRun={eld:optimized.result.expectedTotalLifetimeDamage,elapsedMs:performance.now()-started,totalEvaluations:optimized.diagnostics.totalEvaluations,secondPass:optimized.diagnostics.secondPass,gainOverSavedPct:100*(optimized.result.expectedTotalLifetimeDamage/baselineEld-1)};
  }
  console.log(JSON.stringify({encounterId,selectedUnits:params.selectedIds.length,baselineEld,baselineElapsedMs:number(workspace.resultCache.payload.diagnostics?.optimizationElapsedMs),screenedVariants:screened.length,screeningElapsedMs,alternateDeathOrders:distinct.length,alternates:distinct.map(({eld,transfer,fraction})=>({seedEld:eld,transfer,fraction})),runs,followUpBest:{eld:followUp.eld,elapsedMs:followUp.elapsedMs,gainOverBestPct:100*(followUp.eld/best.eld-1)},productionRun,totalExperimentElapsedMs:performance.now()-experimentStarted},null,2));
}
