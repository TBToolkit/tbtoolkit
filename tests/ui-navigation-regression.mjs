import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../js/epic-stacker.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../css/epic-stacker.css',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../stacking.html',import.meta.url),'utf8');
const start=source.indexOf('function calculatorNumericNavigationOrder()');
const end=source.indexOf('function handleCalculatorNumericNavigation',start);
assert.ok(start>=0&&end>start,'numeric navigation function must exist');
const navigation=source.slice(start,end);

const monsterHealth=navigation.indexOf("'monsterHealth'");
const pvpHealth=navigation.indexOf("isPvp?'pvpHealth':null");
const monsterStrength=navigation.indexOf("'monsterStrength'");
assert.ok(monsterHealth>=0&&pvpHealth>monsterHealth&&monsterStrength>pvpHealth,
  'PvP navigation must place Health PvP after Monster Health and before Monster Strength');
assert.match(source,/pvpEnemyUnitField\.hidden=type!==['"]pvp_single_cp['"]/, 'Enemy Unit selector must only show for one-squad PvP');
assert.match(css,/#pvpEnemyUnitField\[hidden\][\s\S]*?display:none!important/, 'Hidden Enemy Unit selector must override grid display');
assert.match(css,/#pvpModelField\[hidden\][\s\S]*?display:none!important/, 'Hidden PvP encounter model must override dialog label display');
assert.match(source,/battleType===['"]epic['"]&&untouchedEpicCustomOrderMatchesStandard\(\)/, 'Untouched Epic Custom Order must reuse Standard');
assert.match(html,/id="exportAccount"/, 'Player Account must expose .biff export');
assert.match(html,/id="importAccount"/, 'Player Account must expose .biff import');
assert.match(html,/id="biffImportDialog"/, 'Import must provide a preview dialog');
assert.match(html,/id="biffImportName"/, 'Import preview must require a new Player Account name');
assert.match(source,/importedAccountNameSuggestion/, 'Import must suggest a unique Player Account name');
assert.match(source,/Choose a name that is different from an existing Player Account/, 'Import must reject duplicate visible account names');

console.log(JSON.stringify({ok:true,pvpOrder:['monsterHealth','pvpHealth','monsterStrength']}));
