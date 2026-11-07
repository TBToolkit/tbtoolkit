import assert from 'node:assert/strict';
import {battleCycleGuides} from '../js/battle-cycle-chart.mjs';
import {simulateInitiativeCase} from '../js/battle-simulator.mjs';

const squads=Array.from({length:13},(_,i)=>({id:String(i),unitId:i,category:i%2?'monster':'troop',quantity:1,effectiveHealth:100-i,nominalSquadStrength:1,expectedDamagePerOpportunity:1}));
for(const enemyCount of [1,4,8]){
  const result=simulateInitiativeCase(squads,true,enemyCount,{enemyStartsAfterOpening:true});
  const compact=squads.map(s=>({...s,deathPosition:result.death[s.id].position}));
  const explicit=compact.map(s=>({...s,cycle:result.death[s.id].cycle}));
  for(const separated of [false,true])assert.deepEqual(battleCycleGuides(compact,{separated,enemySquadCount:enemyCount}),battleCycleGuides(explicit,{separated}),'Live compact progress must match the Battle Details cycles');
}
const rows=[{category:'troop',deathPosition:1,cycle:1},{category:'monster',deathPosition:2,cycle:1},{category:'troop',deathPosition:3,cycle:2},{category:'monster',deathPosition:4,cycle:2}];
assert.deepEqual(battleCycleGuides(rows),[{category:null,cycle:1,fraction:0},{category:null,cycle:2,fraction:.5}]);
assert.deepEqual(battleCycleGuides(rows,{separated:true}).map(g=>[g.category,g.cycle,g.fraction]),[['troop',1,0],['troop',2,.5],['monster',1,0],['monster',2,.5]]);
assert.equal(battleCycleGuides(rows.slice(0,1))[0].fraction,.5);
assert.deepEqual(battleCycleGuides([{deathPosition:Infinity}],{enemySquadCount:4}),[]);
assert.deepEqual(battleCycleGuides([]),[]);
assert.deepEqual(battleCycleGuides([{deathPosition:1}]),[],'No invented cycles without simulation or encounter information');
console.log('Chart cycle boundaries match simulated death cycles, combined/category positioning, and compact optimizer progress.');
