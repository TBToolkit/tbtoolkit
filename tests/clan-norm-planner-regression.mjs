import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const [html,script,data]=await Promise.all([
  readFile(new URL('chests.html',root),'utf8'),
  readFile(new URL('js/chests.js',root),'utf8'),
  readFile(new URL('data/norm-planner-data.json',root),'utf8').then(JSON.parse)
]);

assert.match(html,/Clan Norm Planner/);
assert.match(html,/id="epicNormRows"/);
assert.match(html,/id="normResourceOptions"/);
assert.match(html,/Chest Reward Averages/);
assert.equal(data.epicMonsters.length,12);
assert.equal(data.tinman.length,250);
assert.equal(data.epicMonsters.find(x=>x.monster==='ARACHNE').cadenceDays,6);
assert.equal(data.epicMonsters.find(x=>x.monster==='DOOMSDAY').cadenceDays,6);
assert.ok(data.epicMonsters.filter(x=>!['ARACHNE','DOOMSDAY'].includes(x.monster)).every(x=>x.cadenceDays===24));
assert.equal(data.tinman.at(-1).level,250);
assert.equal(data.tinmanCadenceDays,6);
assert.match(script,/Math\.floor\(value\/item\.pointsPerChest\)/,'Point norms must round chest payouts down.');
assert.match(script,/actual\*period\/item\.cadenceDays/,'Epic resource estimates must be prorated by cadence.');
assert.doesNotMatch(script,/const plannerKeys=.*clanWealth/,'Clan Wealth must remain outside the first planner version.');
assert.match(html,/accept="\.norms,application\/json"/,'Clan profiles must support portable .norms files.');
assert.match(html,/id="clanContributors"/,'Contributor count must be a single plan-level input.');
assert.doesNotMatch(html,/id="cryptContributors"/,'Crypting must use the shared contributor count.');
assert.match(script,/multipliers=\{B:1e9,M:1e6,K:1e3\}/,'Point norms must support B, M, and K units.');
assert.match(script,/Math\.min\(250,start\+i\)/,'Tinman sequences must advance by level and cap at 250.');
assert.match(script,/event\.key!==\'Enter\'&&event\.key!==\'Tab\'/,'Epic value fields must support direct Enter and Tab navigation.');

console.log('Clan norm planner regression checks passed.');
