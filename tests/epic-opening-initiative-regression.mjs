import assert from 'node:assert/strict';
import {simulateInitiativeCase} from '../js/battle-simulator.mjs';
import {scoreEpicArmy} from '../js/epic-combat-engine-v2.mjs';

const squads=Array.from({length:5},(_,index)=>({
  id:`s${index+1}`,unitId:index+1,name:`Squad ${index+1}`,
  quantity:1,effectiveHealth:500-index*50,nominalSquadStrength:100-index,
  expectedDamagePerOpportunity:10
}));
const firstSideByCycle=result=>{
  const first=new Map();
  for(const event of result.events)if(!first.has(event.cycle))first.set(event.cycle,event.side);
  return [...first.values()];
};

const playerWinsOpening=simulateInitiativeCase(squads,true,1,{enemyStartsAfterOpening:true});
const epicWinsOpening=simulateInitiativeCase(squads,false,1,{enemyStartsAfterOpening:true});
assert.deepEqual(firstSideByCycle(playerWinsOpening),['FRIENDLY','ENEMY','ENEMY','ENEMY','ENEMY'],'Player may start cycle 1, but the epic must start every later cycle');
assert.deepEqual(firstSideByCycle(epicWinsOpening),['ENEMY','ENEMY','ENEMY','ENEMY','ENEMY'],'Epic must start every cycle when it wins the opening toss');

const publishedAlternating=simulateInitiativeCase(squads,true,1);
assert.deepEqual(firstSideByCycle(publishedAlternating),['FRIENDLY','ENEMY','FRIENDLY','ENEMY','FRIENDLY'],'Control case must retain the published alternating behavior by default');

const unit={id:'test-unit',unitId:1,displayOrder:1,category:'troop',capacityType:'LEADERSHIP',combatType:'MELEE',unitClass:'GUARDSMEN',species:'HUMAN',name:'Test Unit',tier:1,capacityCost:1,baseStrength:100,baseHealth:100,goldRevivalCost:1,bonuses:{}};
const bonuses={monsterHealthPct:0,monsterStrengthPct:0,strengthAgainstEpicPct:0,monsterDDPct:0,monsterSTPct:0,arachne:false,useCustomFamilyBonuses:false};
const productionDefault=scoreEpicArmy({units:[unit],quantities:{'test-unit':5},bonuses});
assert.equal(productionDefault.initiativeModel,'opening-coin-toss','Epic scoring must use the corrected initiative model by default');
assert.equal(productionDefault.cases.friendlyFirst.enemyStartsAfterOpening,true,'Optimizer/Review shared scorer must make the epic start after cycle 1');
const explicitControl=scoreEpicArmy({units:[unit],quantities:{'test-unit':5},bonuses:{...bonuses,initiativeModel:'alternating'}});
assert.equal(explicitControl.initiativeModel,'alternating','Offline comparisons may explicitly request the former model');
console.log(JSON.stringify({ok:true,playerWinsOpening:firstSideByCycle(playerWinsOpening),epicWinsOpening:firstSideByCycle(epicWinsOpening)}));
