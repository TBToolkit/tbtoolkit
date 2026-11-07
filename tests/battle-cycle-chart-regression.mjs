import assert from 'node:assert/strict';
import {battleCycleLayout} from '../js/battle-cycle-chart.mjs';
import {simulateInitiativeCase} from '../js/battle-simulator.mjs';

const squads=Array.from({length:13},(_,i)=>({id:String(i),unitId:i,category:i%2?'monster':'troop',quantity:1,effectiveHealth:100-i,nominalSquadStrength:1,expectedDamagePerOpportunity:1}));
for(const enemyCount of [1,4,8]){
  const result=simulateInitiativeCase(squads,true,enemyCount,{enemyStartsAfterOpening:true});
  const compact=squads.map(s=>({...s,deathPosition:result.death[s.id].position}));
  const explicit=compact.map(s=>({...s,cycle:result.death[s.id].cycle}));
  assert.deepEqual(battleCycleLayout(compact,{enemySquadCount:enemyCount}),battleCycleLayout(explicit,{enemySquadCount:enemyCount}),'Live compact progress must match Battle Details cycles');
  assert.equal(battleCycleLayout(compact,{separated:true,enemySquadCount:enemyCount}),null,'By Army Type has no cycle overlay');
}
const rows=Array.from({length:29},(_,i)=>({deathPosition:i+1}));
const layout=battleCycleLayout(rows,{enemySquadCount:4});
assert.equal(layout.lastCycle,8);
assert.deepEqual(layout.ticks.map(t=>t.cycle),[1,2,3,4,5,6,7,8,9],'Axis includes the boundary after the final cycle');
assert.equal(layout.guides[7].centerFraction,7.5/8,'Last badge sits in the middle of the full final cycle');
assert.equal(layout.pointFractions.get(29),7/8,'Partial final cycle keeps space to its right');
assert.equal(layout.pointFractions.get(5),1/8,'First death of cycle two aligns with boundary two');
assert.equal(layout.pointFractions.get(4),.75/8);
const single=battleCycleLayout([{deathPosition:1}],{enemySquadCount:4});
assert.deepEqual(single.ticks,[{cycle:1,fraction:0},{cycle:2,fraction:1}]);
assert.equal(single.guides[0].centerFraction,.5);
assert.equal(battleCycleLayout([{deathPosition:Infinity}],{enemySquadCount:4}),null);
assert.equal(battleCycleLayout([]),null);
assert.equal(battleCycleLayout([{deathPosition:1}]),null,'No invented cycles without simulation or encounter information');
console.log('Combined cycle axis: simulator agreement, integer boundaries, centered badges, full final cycle, and no By Army Type overlay.');
