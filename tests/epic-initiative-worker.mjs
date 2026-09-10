import fs from 'node:fs';
import {parentPort,workerData} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {optimizeEpicQuantities} from '../js/epic-quantity-optimizer.mjs';
import {scoreEpicArmy} from '../js/epic-combat-engine-v2.mjs';

const army=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const started=performance.now();
try{
  const currentBonuses={...workerData.bonuses,initiativeModel:'alternating'};
  const correctedBonuses={...workerData.bonuses,initiativeModel:'opening-coin-toss'};
  const current=optimizeEpicQuantities({units:army,selectedIds:workerData.selectedIds,bonuses:currentBonuses,capacityLimits:workerData.capacityLimits,minimumHealthSeparationPct:.01,minimumQuantity:1});
  const currentArmyCorrectedScore=scoreEpicArmy({units:army,quantities:current.quantities,bonuses:correctedBonuses});
  const corrected=optimizeEpicQuantities({units:army,selectedIds:workerData.selectedIds,bonuses:correctedBonuses,capacityLimits:workerData.capacityLimits,minimumHealthSeparationPct:.01,minimumQuantity:1});
  const names=new Set([...Object.keys(current.quantities),...Object.keys(corrected.quantities)]);
  const quantityChanges=[...names].map(name=>({name,current:Number(current.quantities[name]||0),corrected:Number(corrected.quantities[name]||0)})).filter(row=>row.current!==row.corrected);
  parentPort.postMessage({ok:true,encounterId:workerData.encounterId,elapsedMs:performance.now()-started,currentEld:Number(current.result.expectedTotalLifetimeDamage||0),currentArmyCorrectedEld:Number(currentArmyCorrectedScore.expectedTotalLifetimeDamage||0),correctedOptimizedEld:Number(corrected.result.expectedTotalLifetimeDamage||0),reoptimizationGainPct:(Number(corrected.result.expectedTotalLifetimeDamage||0)/Number(currentArmyCorrectedScore.expectedTotalLifetimeDamage||0)-1)*100,reportedEldChangePct:(Number(currentArmyCorrectedScore.expectedTotalLifetimeDamage||0)/Number(current.result.expectedTotalLifetimeDamage||0)-1)*100,quantityChanges,currentDeathOrder:current.result.squads.map(row=>row.name),correctedDeathOrder:corrected.result.squads.map(row=>row.name),currentEvaluations:current.diagnostics.totalEvaluations,correctedEvaluations:corrected.diagnostics.totalEvaluations});
}catch(error){parentPort.postMessage({ok:false,encounterId:workerData.encounterId,error:error?.stack||String(error)});}
