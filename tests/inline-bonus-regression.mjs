import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../js/epic-stacker.js',import.meta.url),'utf8');
function functionSource(start,end){
  const first=source.indexOf(`function ${start}(`),last=source.indexOf(`function ${end}(`,first);
  assert.ok(first>=0&&last>first,`${start} must exist`);
  return source.slice(first,last);
}
const inputs={
  monsterHealth:'2000',monsterStrength:'3000',monsterDD:'12',monsterST:'8',
  strengthAgainstEpic:'1000',fenrirStrength:'300',pvpHealth:'1500',pvpStrength:'800',
  beastHealth:'1900',beastStrength:'2800',beastDD:'12',beastST:'8',
  beastStrengthAgainstEpic:'1100',beastFenrirStrength:'400',beastPvpHealth:'1700',beastPvpStrength:'900',
  leadership:'100',authority:'50',dominance:'40',leadershipFill:'100',authorityFill:'100',dominanceFill:'100',
  enemySquadTypes:['FLYING']
};
const context=vm.createContext({
  activeMode:'battle',state:{modes:{battle:{activeEncounterId:'epic-fenrir'}}},
  modeState:()=>({inputs}),parseNumber:value=>Number(value)||0,
  BONUS_PROFILE_ROWS:[{key:'beast'}],templeLevel:()=>45,templeRevivalDivisor:()=>5.91
});
vm.runInContext(`${functionSource('profileExtraId','updateOptimizerElapsed')}${functionSource('epicBonusPayload','fixedStandardMercenaryQuantitiesForOptimizer')}${functionSource('baseEngineInputs','categoryProbe')}`,context);
let epic=vm.runInContext('epicBonusPayload()',context);
assert.equal(epic.strengthAgainstEpicPct,1000);
assert.equal(epic.fenrirStrengthPct,300);
assert.equal(epic.customProfileBonuses.beastStrengthPct,3000,'Independent Beast PvE and Fenrir bonuses must add to its effective Strength');
let engine=vm.runInContext('baseEngineInputs()',context);
assert.equal(engine.monsterStrengthPct+engine.strengthAgainstEpicPct,4300);
assert.equal(engine.beastStrengthPct+engine.strengthAgainstEpicPct,4300,'Epic engine must receive the same Beast total as optimizer scoring');

context.state.modes.battle.activeEncounterId='pvp-single';
inputs.battleType='pvp_single_cp';
engine=vm.runInContext('baseEngineInputs()',context);
assert.equal(engine.healthInputs.MONSTER,3500);
assert.equal(engine.healthInputs.BEAST,3600,'PvP Health must use the Beast row override');
assert.equal(engine.monsterStrengthPct,3800);
assert.equal(engine.beastStrengthPct,3700,'PvP Strength must use the Beast row override');
console.log('Inline bonus calculations passed.');
