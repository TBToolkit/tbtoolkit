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
console.log(JSON.stringify({ok:true}));
