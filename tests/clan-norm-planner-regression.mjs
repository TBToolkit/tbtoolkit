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
assert.match(script,/plannerKeys=resourceKeys\.filter\(k=>k!==\'clanWealth\'\)/,'Clan Wealth must remain outside the first planner version.');
assert.match(html,/accept="\.norms,application\/json"/,'Clan profiles must support portable .norms files.');
assert.doesNotMatch(html,/id="clanContributors"/,'The planner must use one clan member count.');
assert.match(html,/id="epicVisibilityOptions"/,'Clan leaders must be able to show or hide individual Epic events.');
assert.match(html,/id="addChestNorm"/,'Clan leaders must be able to add multiple Crypt and Citadel requirements.');
assert.match(html,/id="normBreakdownHead"/,'The breakdown must support dynamic resource columns.');
assert.match(script,/multipliers=\{B:1e9,M:1e6,K:1e3\}/,'Point norms must support B, M, and K units.');
assert.match(script,/Math\.min\(250,start\+i\)/,'Tinman sequences must advance by level and cap at 250.');
assert.match(script,/event\.key!==\'Enter\'&&event\.key!==\'Tab\'/,'Epic value fields must support direct Enter and Tab navigation.');
assert.match(script,/r\.type===\'CRYPT\'\|\|r\.type===\'CITADEL\'/,'The norm planner must offer Crypt and Citadel chests.');
assert.match(script,/focusin.*\.select\(\)/,'Numeric inputs must select their full value on focus.');

console.log('Clan norm planner regression checks passed.');
