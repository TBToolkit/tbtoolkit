import assert from 'node:assert/strict';
import fs from 'node:fs';
import {optimizeEpicQuantities} from '../js/epic-quantity-optimizer.mjs';

const units=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const selected=[
  ...units.filter(unit=>unit.category==='troop'&&['G9','S9'].includes(unit.tier)).slice(0,4),
  ...units.filter(unit=>unit.category==='monster'&&unit.tier==='M9').slice(0,4)
];
const args={
  units,selectedIds:selected.map(unit=>unit.id),
  bonuses:{monsterHealthPct:1800,monsterStrengthPct:2200,strengthAgainstEpicPct:3000,monsterDDPct:14,monsterSTPct:18,arachne:false,enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED'],includeMercenariesInOptimization:false,useCustomFamilyBonuses:false},
  capacityLimits:{LEADERSHIP:350000,DOMINANCE:70000,AUTHORITY:0},
  minimumHealthSeparationPct:.01,minimumQuantity:1
};

const skipped=optimizeEpicQuantities({...args,remainingTimeMs:()=>0});
assert.equal(skipped.diagnostics.secondPass.skipped,'time-reserve');
assert.equal(skipped.diagnostics.secondPass.attempted,0);

const progress=[];
const refined=optimizeEpicQuantities({...args,remainingTimeMs:()=>Infinity,onProgress:update=>progress.push(update)});
assert.ok(refined.result.expectedTotalLifetimeDamage>=skipped.result.expectedTotalLifetimeDamage,'A second pass must never replace the existing best with a lower ELD.');
assert.ok(refined.diagnostics.secondPass.attempted<=4,'The second pass must remain bounded to at most four finalist seeds.');
assert.equal(refined.diagnostics.secondPass.completed,refined.diagnostics.secondPass.attempted);
assert.equal(refined.diagnostics.secondPass.timedOut,false);
assert.ok(refined.diagnostics.totalEvaluations>=skipped.diagnostics.totalEvaluations);
assert.equal(refined.diagnostics.maximumExpectedLifetimeDamage,refined.result.expectedTotalLifetimeDamage);
assert.ok(progress.every(update=>update.phase!=='second-pass'||update.seedCount<=4));

let timeChecks=0;
const timeLimited=optimizeEpicQuantities({...args,remainingTimeMs:()=>++timeChecks<=10?30000:15000});
assert.equal(timeLimited.diagnostics.secondPass.timedOut,true,'The second pass must stop when its finishing reserve is reached.');
assert.equal(timeLimited.result.expectedTotalLifetimeDamage,skipped.result.expectedTotalLifetimeDamage,'Stopping the optional pass must preserve the completed original result.');

console.log(JSON.stringify({ok:true,selectedUnits:selected.length,baselineEld:skipped.result.expectedTotalLifetimeDamage,secondPassEld:refined.result.expectedTotalLifetimeDamage,attempted:refined.diagnostics.secondPass.attempted}));
