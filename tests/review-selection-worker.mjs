import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runOptimizeReviewSelection} from '../js/epic-review-engine.mjs';

const canonical=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const chosen=[];
for(const category of ['troop','monster','mercenary']){
  const unit=canonical.find(row=>row.category===category);
  if(unit)chosen.push(unit);
}
const currentIds=chosen.map(unit=>unit.id),mercenaryId=chosen.find(unit=>unit.category==='mercenary').id;
const progress=[];
const result=await runOptimizeReviewSelection({
  units:chosen,currentIds,
  bonuses:{monsterHealthPct:1600,monsterStrengthPct:2000,strengthAgainstEpicPct:2000,monsterDDPct:10,monsterSTPct:10,arachne:false,enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED'],includeMercenariesInOptimization:true,useCustomFamilyBonuses:false},
  capacityLimits:{LEADERSHIP:10_000,DOMINANCE:10_000,AUTHORITY:10_000},timeBudgetMs:30_000,
  onProgress:update=>progress.push(update)
});
assert.ok(result.mandatoryMercenaryIds.includes(mercenaryId),'Worker engine must mark selected mercenaries as mandatory');
assert.ok(result.proposal.selectedIds.includes(mercenaryId),'Worker proposal must preserve selected mercenaries');
assert.ok(progress.some(update=>update.phase==='complete'&&update.progressPct===100),'Worker engine must report completion');
assert.ok(result.elapsedMs>=0&&result.elapsedMs<30_000,'Worker engine must report elapsed time within its budget');
console.log(JSON.stringify({ok:true,build:result.build,elapsedMs:result.elapsedMs,progressUpdates:progress.length,mandatoryMercenaries:result.mandatoryMercenaryIds.length}));
