import fs from 'node:fs';
import {Worker} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';

const biffPath=process.argv[2];
if(!biffPath)throw new Error('Pass the .biff file path as the first argument.');
const payload=JSON.parse(fs.readFileSync(biffPath,'utf8'));
if(payload.format!=='tbtoolkit-biff'||payload.kind!=='account')throw new Error('Expected a TB Toolkit account .biff file.');
const requestedIds=new Set(process.argv.slice(3));
const workspaces=payload.account.workspaces.filter(workspace=>workspace.encounterId.startsWith('epic-')&&Object.values(workspace.selectedIds||{}).some(ids=>ids.length)&&(!requestedIds.size||requestedIds.has(workspace.encounterId)));
const parse=value=>{const n=Number(String(value??'').replaceAll(',',''));return Number.isFinite(n)?n:0;};
const makeJob=workspace=>{
  const i=workspace.inputs;
  const limit=(key,fill,auto)=>Math.floor(parse(i[key])*(i[auto]?1:Math.max(0,Math.min(1,parse(i[fill])/100))));
  return{encounterId:workspace.encounterId,selectedIds:Object.values(workspace.selectedIds).flat(),capacityLimits:{LEADERSHIP:limit('leadership','leadershipFill','autoLeadership'),DOMINANCE:limit('dominance','dominanceFill','autoDominance'),AUTHORITY:i.includeMercenariesInOptimization?limit('authority','authorityFill','autoAuthority'):0},bonuses:{monsterHealthPct:parse(i.monsterHealth),monsterStrengthPct:parse(i.monsterStrength),strengthAgainstEpicPct:parse(i.strengthAgainstEpic),monsterDDPct:parse(i.monsterDD),monsterSTPct:parse(i.monsterST),arachne:!!i.arachne,enemySquadTypes:i.enemySquadTypes,includeMercenariesInOptimization:!!i.includeMercenariesInOptimization,useCustomFamilyBonuses:!!i.useCustomFamilyBonuses,customFamilyBonuses:{humanHealthPct:parse(i.humanHealth),epicHunterHealthPct:parse(i.epicHunterHealth),humanStrengthPct:parse(i.humanStrength),epicHunterStrengthPct:parse(i.epicHunterStrength),humanDDPct:parse(i.humanDD),epicHunterDDPct:parse(i.epicHunterDD),humanSTPct:parse(i.humanST),epicHunterSTPct:parse(i.epicHunterST)}}};
};
const run=workerData=>new Promise((resolve,reject)=>{const worker=new Worker(new URL('./epic-initiative-worker.mjs',import.meta.url),{workerData});worker.once('message',message=>message.ok?resolve(message):reject(new Error(message.error)));worker.once('error',reject);worker.once('exit',code=>{if(code!==0)reject(new Error(`Initiative worker exited with code ${code}.`));});});
const jobs=workspaces.map(makeJob),results=[];let next=0;
const started=performance.now();
const consume=async()=>{while(next<jobs.length){const job=jobs[next++];console.error(`[initiative] ${job.encounterId}`);results.push(await run(job));}};
await Promise.all(Array.from({length:Math.min(2,jobs.length)},consume));
results.sort((a,b)=>a.encounterId.localeCompare(b.encounterId));
const summary=results.map(row=>({encounterId:row.encounterId,elapsedMs:row.elapsedMs,currentEld:row.currentEld,currentArmyCorrectedEld:row.currentArmyCorrectedEld,correctedOptimizedEld:row.correctedOptimizedEld,reportedEldChangePct:row.reportedEldChangePct,reoptimizationGainPct:row.reoptimizationGainPct,quantityChangeCount:row.quantityChanges.length,deathOrderChanged:JSON.stringify(row.currentDeathOrder)!==JSON.stringify(row.correctedDeathOrder),currentDeathOrder:row.currentDeathOrder,correctedDeathOrder:row.correctedDeathOrder,currentEvaluations:row.currentEvaluations,correctedEvaluations:row.correctedEvaluations}));
console.log(JSON.stringify({generatedAt:new Date().toISOString(),source:{accountName:payload.account.name,templeLevel:payload.account.templeLevel,configuredEpicWorkspaces:jobs.length},wallMs:performance.now()-started,results:summary},null,2));
