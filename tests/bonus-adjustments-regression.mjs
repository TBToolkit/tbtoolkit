import assert from 'node:assert/strict';
import {normalizeBonusAdjustments,applyAutomaticBonusAdjustments,captureBonusAdjustments,effectiveBonusAdjustments,updateAccountBonusAdjustments,bonusAdjustmentColumns} from '../js/bonus-adjustments.mjs';
import {makeAccount} from '../js/workspace-model.mjs';
import {serializeAccountToBiff,parseBiff,materializeImportedAccount} from '../js/biff-format.mjs';
import {persistentAccountSnapshot,validateAccountState} from '../js/browser-storage.mjs';
import {copySharedEpicArmy} from '../js/shared-epic-armies.mjs';
import {exploreSection2Context} from '../js/epic-explore-results.mjs';

const base={monsterHealth:'1600',monsterStrength:'2000',monsterDD:'10',monsterST:'10',strengthAgainstEpic:'2000',fenrirStrength:'550',pvpHealth:'1600',pvpStrength:'2000',autoHumanBonuses:true,autoGuardsmanBonuses:true,autoSpecialistBonuses:true,autoEngineerBonuses:true,autoEpicHunterBonuses:true};
const defaults=normalizeBonusAdjustments();
assert.deepEqual(bonusAdjustmentColumns().map(([stat])=>stat),['DD','ST','Health','Strength']);
assert.deepEqual(bonusAdjustmentColumns({isFenrir:true}).map(([stat])=>stat),['DD','ST','Health','Strength']);
assert.deepEqual(bonusAdjustmentColumns({isPvp:true}).map(([stat])=>stat),['DD','ST','PvpHealth','Health','PvpStrength','Strength']);
const normal=applyAutomaticBonusAdjustments(base,defaults);
assert.equal(normal.humanHealth,'1500');assert.equal(normal.guardsmanHealth,'1500');
assert.equal(normal.specialistStrength,'1900');assert.equal(normal.engineerST,'5');
assert.equal(normal.epicHunterHealth,'859');assert.equal(normal.epicHunterStrength,'1259');assert.equal(normal.epicHunterST,'5');
const custom=normalizeBonusAdjustments({guardsman:{Health:-300.5,Strength:125.25,DD:1.2,ST:-9.5,StrengthAgainstEpic:50,FenrirStrength:-100},specialist:{Health:-50},engineer:{Strength:33},epicHunter:{Health:-400}});
const adjusted=applyAutomaticBonusAdjustments(base,custom);
assert.equal(adjusted.guardsmanHealth,'1299.5');assert.equal(adjusted.guardsmanStrength,'2125.25');
assert.equal(adjusted.guardsmanDD,'11.2');assert.equal(adjusted.guardsmanST,'0.5');
assert.equal(adjusted.guardsmanStrengthAgainstEpic,'2050');assert.equal(adjusted.guardsmanFenrirStrength,'450');
assert.equal(adjusted.specialistHealth,'1550');assert.equal(adjusted.engineerStrength,'2033');assert.equal(adjusted.epicHunterHealth,'1200');
const lower=applyAutomaticBonusAdjustments({...base,monsterHealth:'10',monsterST:'1'},defaults);
assert.equal(lower.guardsmanHealth,'0');assert.equal(lower.epicHunterST,'0','Bonuses must not become negative');
const manual=applyAutomaticBonusAdjustments({...base,autoSpecialistBonuses:false,specialistHealth:'123.45',specialistStrength:'987.65'},custom);
assert.equal(manual.specialistHealth,'123.45');assert.equal(manual.specialistStrength,'987.65');
const manualHuman=applyAutomaticBonusAdjustments({...base,autoHumanBonuses:false,humanHealth:'777.5',humanStrength:'888',humanStrengthAgainstEpic:'432'},custom);
assert.equal(manualHuman.guardsmanHealth,'777.5');assert.equal(manualHuman.engineerStrengthAgainstEpic,'432','Preserve the shared Human manual override');
const captured=captureBonusAdjustments(adjusted);
assert.deepEqual(captured,custom,'Capture must recover signed adjustments without floating-point noise');
const changed=applyAutomaticBonusAdjustments({...adjusted,monsterHealth:'1700',monsterDD:'12'},captured);
assert.equal(changed.guardsmanHealth,'1399.5');assert.equal(changed.guardsmanDD,'13.2');
assert.equal(normalizeBonusAdjustments({guardsman:{Health:Infinity,ST:'bad'}}).guardsman.Health,-100);

const account=makeAccount({id:'sk',name:'Seasonal'});
account.battle.workspaces={
 'epic-doomsday':{inputs:{...normal,shareEpicArmy:true},selectedIds:{troop:[],monster:[],mercenary:[]}},
 'epic-fenrir':{inputs:{...normal,useEncounterBonusAdjustments:true,bonusAdjustments:defaults},selectedIds:{troop:[],monster:[],mercenary:[]}}
};
updateAccountBonusAdjustments(account,custom);
assert.equal(account.battle.workspaces['epic-doomsday'].inputs.guardsmanHealth,'1299.5');
assert.equal(account.battle.workspaces['epic-fenrir'].inputs.guardsmanHealth,'1500','Player-wide changes must preserve encounter overrides');
assert.deepEqual(effectiveBonusAdjustments(account,account.battle.workspaces['epic-fenrir'].inputs),defaults);
const second=makeAccount({id:'main',name:'Main'});
assert.deepEqual(effectiveBonusAdjustments(second,{}),defaults,'Different player accounts must stay independent');
const before=JSON.stringify(account.battle.workspaces['epic-fenrir']);
copySharedEpicArmy(account.battle.workspaces['epic-doomsday'],account.battle.workspaces['epic-fenrir']);
assert.equal(JSON.stringify(account.battle.workspaces['epic-fenrir']),before,'Shared armies must not overwrite customized encounter bonuses');
const reload=JSON.parse(JSON.stringify(persistentAccountSnapshot({sk:account})));
assert.deepEqual(reload.sk.bonusAdjustments,custom);
validateAccountState({schemaVersion:20,accounts:reload,activeAccountId:'sk'});
const exported=serializeAccountToBiff(account),raw=JSON.parse(exported);
assert.equal(raw.schemaVersion,3,'Older calculators must not silently discard custom bonus adjustments');
const imported=materializeImportedAccount(parseBiff(exported),{builtInEncounterIds:['epic-doomsday','epic-fenrir','pvp-single']}).account;
assert.deepEqual(imported.bonusAdjustments,custom);
assert.deepEqual(imported.battle.workspaces['epic-fenrir'].inputs.bonusAdjustments,defaults);
assert.equal(imported.battle.workspaces['epic-fenrir'].inputs.useEncounterBonusAdjustments,true);
raw.schemaVersion=2;delete raw.account.bonusAdjustments;
for(const w of raw.account.workspaces){delete w.inputs.bonusAdjustments;delete w.inputs.useEncounterBonusAdjustments;}
assert.deepEqual(parseBiff(JSON.stringify(raw)).account.bonusAdjustments,defaults,'Existing player files must use the original defaults');
assert.notEqual(exploreSection2Context('sk|fenrir',{...normal,bonusAdjustments:defaults}),exploreSection2Context('sk|fenrir',{...normal,bonusAdjustments:custom}),'Changing Section 2 adjustments must hide saved Explore results even when Manual bonuses are unchanged');
console.log('Bonus adjustments: independent families, decimals, Manual overrides, calibration, account scope, encounter scope, reload, and player serialization passed.');
