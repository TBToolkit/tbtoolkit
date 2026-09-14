import assert from 'node:assert/strict';
import fs from 'node:fs';
import {optimizeEpicQuantities} from '../js/epic-quantity-optimizer.mjs';

const units=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const selectedIds=units.filter(unit=>['G9','S9','E9','M9'].includes(unit.tier)).map(unit=>unit.id);
assert.throws(()=>optimizeEpicQuantities({
  units,selectedIds,
  bonuses:{monsterHealthPct:1600,monsterStrengthPct:2000,strengthAgainstEpicPct:2000,monsterDDPct:10,monsterSTPct:10,enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED']},
  capacityLimits:{LEADERSHIP:400000,DOMINANCE:75000,AUTHORITY:0},
  shouldAbort:()=>true,
}),error=>error?.code==='TIME_BUDGET');

const workerSource=fs.readFileSync(new URL('../js/epic-optimizer-worker.mjs',import.meta.url),'utf8');
assert.match(workerSource,/OPTIMIZER_TIME_BUDGET_MS\s*=\s*180000/,'Production worker must define a finite optimizer time budget.');
assert.match(workerSource,/shouldAbort\s*,\s*onProgress/,'Production worker must pass shouldAbort into optimizeEpicQuantities.');
assert.match(workerSource,/code:timedOut\?'TIME_BUDGET'/,'Production worker must identify time-budget exits distinctly.');

const workerFactorySource=fs.readFileSync(new URL('../js/calculator-workers.mjs',import.meta.url),'utf8');
assert.match(workerFactorySource,/OPTIMIZER_WATCHDOG_MS\s*=\s*195000/,'Optimizer worker must have a main-thread watchdog.');
assert.match(workerFactorySource,/WORKER_WATCHDOG/,'Watchdog termination must surface a distinct worker error code.');
assert.match(workerFactorySource,/nativeTerminate\(\)/,'Watchdog must terminate a nonresponsive worker.');

console.log(JSON.stringify({ok:true}));
