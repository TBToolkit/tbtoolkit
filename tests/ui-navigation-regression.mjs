import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../js/epic-stacker.js',import.meta.url),'utf8');
const start=source.indexOf('function calculatorNumericNavigationOrder()');
const end=source.indexOf('function handleCalculatorNumericNavigation',start);
assert.ok(start>=0&&end>start,'numeric navigation function must exist');
const navigation=source.slice(start,end);

const monsterHealth=navigation.indexOf("'monsterHealth'");
const pvpHealth=navigation.indexOf("isPvp?'pvpHealth':null");
const monsterStrength=navigation.indexOf("'monsterStrength'");
assert.ok(monsterHealth>=0&&pvpHealth>monsterHealth&&monsterStrength>pvpHealth,
  'PvP navigation must place Health PvP after Monster Health and before Monster Strength');

console.log(JSON.stringify({ok:true,pvpOrder:['monsterHealth','pvpHealth','monsterStrength']}));
