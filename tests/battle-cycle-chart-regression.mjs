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
assert.deepEqual(layout.ticks.map(t=>t.cycle),[0,1,2,3,4,5,6,7,8],'Axis starts at zero and includes the end of the final cycle');
assert.equal(layout.guides[7].centerFraction,7.5/8,'Last badge sits in the middle of the full final cycle');
assert.equal(layout.pointFractions.get(29),7.125/8,'Partial final cycle keeps space to its right');
assert.equal(layout.pointFractions.get(5),1.125/8,'First death of cycle two sits inside its interval');
assert.equal(layout.pointFractions.get(4),.875/8);
assert.equal((layout.pointFractions.get(4)+layout.pointFractions.get(5))/2,layout.guides[1].fraction,'Cycle two boundary bisects the gap between its adjacent squads');
for(const count of [1,4,8]){
  const plan=battleCycleLayout(Array.from({length:count*3},(_,i)=>({deathPosition:i+1})),{enemySquadCount:count});
  for(let cycle=1;cycle<3;cycle++){
    const before=plan.pointFractions.get(cycle*count),after=plan.pointFractions.get(cycle*count+1),boundary=plan.guides[cycle].fraction;
    assert.ok(before<boundary&&boundary<after);
    assert.ok(Math.abs((before+after)/2-boundary)<1e-12);
  }
}
const single=battleCycleLayout([{deathPosition:1}],{enemySquadCount:4});
assert.deepEqual(single.ticks,[{cycle:0,fraction:0},{cycle:1,fraction:1}]);
assert.equal(single.guides[0].centerFraction,.5);
assert.equal(battleCycleLayout([{deathPosition:Infinity}],{enemySquadCount:4}),null);
assert.equal(battleCycleLayout([]),null);
assert.equal(battleCycleLayout([{deathPosition:1}]),null,'No invented cycles without simulation or encounter information');
console.log('Combined cycle axis: simulator agreement, integer boundaries, centered badges, full final cycle, and no By Army Type overlay.');
