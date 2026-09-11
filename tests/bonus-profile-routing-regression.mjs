import assert from 'node:assert/strict';
import {bonusProfileForUnit} from '../js/combat-mechanics.mjs';
import {buildSquad,deriveBonusInputs} from '../js/epic-combat-engine-v2.mjs';

assert.equal(bonusProfileForUnit({species:'HUMAN',unitClass:'GUARDSMAN'}),'GUARDSMAN');
assert.equal(bonusProfileForUnit({species:'HUMAN',class:'SPECIALIST'}),'SPECIALIST');
assert.equal(bonusProfileForUnit({species:'HUMAN',unitClass:'ENGINEER'}),'ENGINEER');
assert.equal(bonusProfileForUnit({species:'BEAST',unitClass:'SPECIALIST'}),'MONSTER');
for(const species of ['CURSED','DEMON','ELVES','UNDEAD','BARBARIAN']){
  assert.equal(bonusProfileForUnit({species,unitClass:'SPECIALIST'}),'GUARDSMAN');
}
assert.equal(bonusProfileForUnit({species:'EPIC HUNTER',unitClass:'SPECIALIST'}),'EPIC_HUNTER');

const bonuses=deriveBonusInputs({
  monsterHealthPct:1000,monsterStrengthPct:2000,strengthAgainstEpicPct:0,monsterDDPct:10,monsterSTPct:20,
  useCustomProfileBonuses:true,
  customProfileBonuses:{
    guardsmanHealthPct:100,guardsmanStrengthPct:200,guardsmanDDPct:1,guardsmanSTPct:2,
    specialistHealthPct:300,specialistStrengthPct:400,specialistDDPct:3,specialistSTPct:4,
    engineerHealthPct:500,engineerStrengthPct:600,engineerDDPct:5,engineerSTPct:6,
    epicHunterHealthPct:700,epicHunterStrengthPct:800,epicHunterDDPct:7,epicHunterSTPct:8,
  }
});
const unit={id:'test',unitId:'test',displayOrder:1,category:'TROOP',capacityType:'LEADERSHIP',combatType:'FLYING',unitClass:'SPECIALIST',name:'Test',tier:'S9',icon:'',baseStrength:10,baseHealth:10,capacityCost:1,goldRevivalCost:1,bonuses:{doubleDamage:.05}};
const human=buildSquad({...unit,species:'HUMAN'},1,bonuses);
const beast=buildSquad({...unit,species:'BEAST'},1,bonuses);
const cursed=buildSquad({...unit,species:'CURSED'},1,bonuses);
assert.equal(human.bonusFamily,'SPECIALIST');
assert.equal(human.effectiveHealth,40);
assert.equal(human.pDD,.08);
assert.equal(beast.bonusFamily,'MONSTER');
assert.equal(beast.effectiveHealth,110);
assert.ok(Math.abs(beast.pDD-.15)<1e-12);
assert.equal(cursed.bonusFamily,'GUARDSMAN');
assert.equal(cursed.effectiveHealth,20);
assert.ok(Math.abs(cursed.pDD-.06)<1e-12);

console.log(JSON.stringify({ok:true,routes:8}));
