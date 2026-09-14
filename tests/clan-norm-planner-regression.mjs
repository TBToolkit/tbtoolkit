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
assert.match(script,/normalizeEpicValue/,'Fractional B and M entries must normalize to the next smaller unit.');
assert.match(script,/resourcePreset=.*same\(coreKeys\)/,'Saved resource selections must restore the matching highlighted preset.');
assert.match(script,/amount\/totals\[k\]\*100/,'Dashboard activity cells must calculate their share of each resource total.');
assert.match(html,/<details class="norm-activity" open><summary><span>Tinman \/ Ancients/,'Tinman controls must be expanded by default.');
assert.match(script,/filter\(x=>x\.monster!==\'ASHEN\'\)/,'Ashen must be hidden in a new plan by default.');
assert.match(script,/sortedEpics\(\).*monster\.localeCompare/s,'Epic controls must be alphabetized.');
assert.match(html,/id="resourceDonutCharts"/,'The dashboard must include per-resource event charts.');
assert.match(html,/id="resourceCategoryChart"/,'The dashboard must include a resource-category summary chart.');
assert.match(script,/part\.category===\'Tinman\'\?\'Tinman\':part\.name/,'All Tinman levels must share one event-chart slice.');
assert.match(script,/\[\'Crypts\'.*\[\'Citadels\'/,'Crypts and Citadels must remain separate summary categories.');
assert.match(script,/Other activities/,'Crowded callout charts must consolidate excess small slices.');
assert.match(html,/All resource values are per member per 6-day cycle/,'The dashboard must make its per-member cycle scope explicit.');
assert.doesNotMatch(html,/id="normResourceCards"/,'Resource totals must not be repeated above the donut charts.');
assert.match(html,/<details class="norm-data-details"><summary>/,'The detailed activity table must be collapsed by default.');
assert.match(script,/stableActivityColor/,'Activity colors must remain stable across resource charts.');
assert.match(script,/class="slice-percent"/,'Donut percentages must be rendered within sufficiently large slices.');
assert.match(script,/class="donut-label".*transform="rotate/s,'Donut labels must follow a radial orientation.');
assert.match(script,/allResources:\[\.\.\.allResourceSelection\]/,'Custom All resource selections must be saved with each clan profile.');
assert.match(script,/resourcePreset==='all'\?\[\.\.\.allResourceSelection\]/,'Returning to All must restore the clan profile’s custom resource choices.');

console.log('Clan norm planner regression checks passed.');
