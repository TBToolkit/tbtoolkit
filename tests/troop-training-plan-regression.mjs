import assert from 'node:assert/strict';
import fs from 'node:fs';
import {troopTrainingPlan,parseTrainingAttacks} from '../js/troop-training-plan.mjs';
import {makeAccount} from '../js/workspace-model.mjs';
import {serializeAccountToBiff,parseBiff} from '../js/biff-format.mjs';
import {copySharedEpicArmy} from '../js/shared-epic-armies.mjs';

const units=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const guard=units.find(u=>u.unitClass==='GUARDSMAN');
const monster=units.find(u=>u.category==='monster');
const merc=units.find(u=>u.category==='mercenary');
const squads=[guard,monster,merc].map(u=>({id:u.id,quantity:101}));
const plan=strategy=>troopTrainingPlan({squads,units,attacks:'10',strategy});
assert.equal(plan('full').GUARDSMAN[0].required,200n,'Initial army plus nine rounded permanent-loss replacements');
assert.equal(plan('full').MONSTER[0].required,200n);
assert.equal(plan('mercenary-monster').GUARDSMAN[0].required,1010n);
assert.equal(plan('mercenary-monster').MONSTER[0].required,200n);
assert.equal(plan('mercenary-only').MONSTER[0].required,1010n);
assert.equal(Object.values(plan('full')).flat().length,2,'Mercenaries cannot be trained');
assert.equal(troopTrainingPlan({squads,units,attacks:'1',strategy:'mercenary-only'}).MONSTER[0].required,101n,'No post-final-attack replacements');
for(const invalid of ['','0','-1','1.5','1e3','Infinity','no'])assert.equal(parseTrainingAttacks(invalid),null);
assert.equal(parseTrainingAttacks('00010'),10n);
const huge='999999999999999999999999999999';
assert.equal(troopTrainingPlan({squads,units,attacks:huge,strategy:'mercenary-only'}).GUARDSMAN[0].required,BigInt(huge)*101n,'Large attack counts must remain exact');
const all=troopTrainingPlan({squads:units.map(u=>({id:u.id,quantity:1})),units});
assert.deepEqual([...new Set(all.GUARDSMAN.map(r=>r.tierNumber))],[9,1,2,3,4,5,6,7,8]);
for(const family of ['GUARDSMAN','SPECIALIST']){
  assert.deepEqual(all[family].filter(r=>r.tierNumber===9).map(r=>r.combatType),['RANGED','MELEE','MOUNTED','FLYING']);
}
for(const [tier,names] of Object.entries({
  3:['WATER ELEMENTAL','BATTLE BOAR','EMERALD DRAGON','STONE GARGOYLE'],
  4:['MAGIC DRAGON','GORGON MEDUSA','MANY-ARMED GUARDIAN','ICE PHOENIX'],
  5:['ETTIN','DESERT VANQUISHER','FLAMING CENTAUR','FEARSOME MANTICORE'],
  6:['CRYSTAL DRAGON','RUBY GOLEM','JUNGLE DESTROYER','TROLL RIDER'],
  7:['DESTRUCTIVE COLOSSUS','WIND LORD','ANCIENT TERROR','BLACK DRAGON'],
  8:['TRICKSTER 1','KRAKEN 1','DEVASTATOR 1','FIRE PHOENIX 1'],
  9:['TRICKSTER 2','KRAKEN 2','DEVASTATOR 2','FIRE PHOENIX 2'],
}))assert.deepEqual(all.MONSTER.filter(r=>r.tierNumber===Number(tier)).map(r=>r.name),names);
const account=makeAccount({id:'training',name:'Training'});
account.battle.workspaces={'epic-doomsday':{inputs:{trainingPlanAttacks:huge},selectedIds:{troop:[],monster:[],mercenary:[]}}};
assert.equal(parseBiff(serializeAccountToBiff(account)).account.workspaces[0].inputs.trainingPlanAttacks,huge);
const target={inputs:{trainingPlanAttacks:'7'},selectedIds:{troop:[],monster:[],mercenary:[]}};
copySharedEpicArmy(account.battle.workspaces['epic-doomsday'],target);
assert.equal(target.inputs.trainingPlanAttacks,'7','Attack target belongs to each encounter');
console.log('Training plans: revival rounding, final attack, large integers, family/tier/game ordering, and player-file persistence passed.');
