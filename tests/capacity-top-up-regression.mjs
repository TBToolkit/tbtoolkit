import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateCategory, calculateCustomCategory, calculateEpicStack } from '../js/epic-engine.mjs';

const canonical=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const legacy=canonical.map(unit=>{
  const capacityField=unit.category==='troop'?'leadershipEach':unit.category==='monster'?'dominanceEach':'authorityEach';
  return{
    id:unit.id,category:unit.category,displayOrder:unit.displayOrder,class:unit.unitClass,
    type:unit.combatType,name:unit.name,level:unit.tier,strengthEach:unit.baseStrength,
    healthEach:unit.baseHealth,[capacityField]:unit.capacityCost,species:unit.species,
    selectionKey:`${unit.tier}|${unit.combatType}`,icon:unit.icon,bonuses:{...(unit.bonuses||{})},
  };
});
const troops=legacy.filter(unit=>unit.category==='troop');
const monsters=legacy.filter(unit=>unit.category==='monster');
const troopIds=troops.filter(unit=>['G9','G8','S9','S8','E9','E8'].includes(unit.level)).map(unit=>unit.id);
const monsterIds=monsters.filter(unit=>['M9','M8','M7'].includes(unit.level)).map(unit=>unit.id);
const inputs={
  leadership:448_448,leadershipFill:1,authority:165_287,authorityFill:.1,
  dominance:80_518,dominanceFill:1,arachne:false,minimumSeparation:true,
  rankSeparation:.0005,layerSeparation:.0005,
  healthInputs:{
    MONSTER:2017.5,BEAST:2017.5,DRAGON:2017.5,ELEMENTAL:2017.5,GIANT:2017.5,
    HUMAN:1917.5,GUARDSMAN:1917.5,SPECIALIST:1917.5,ENGINEER:1917.5,EPIC_HUNTER:1276.5,
  },
};

function assertCategoryIsFullestLegal(result){
  const target=Math.floor(result.capacityLimit*Math.max(0,Math.min(1,result.requestedFill)));
  const remaining=target-result.totalCapacity;
  assert.ok(remaining>=0,`${result.category} exceeded its requested capacity`);
  const byId=new Map(result.results.map(row=>[row.id,row]));
  const ordered=result.deathOrderIds.map(id=>byId.get(id)).filter(Boolean);
  for(let index=0;index<ordered.length;index++){
    const row=ordered[index];
    const previous=index>0?ordered[index-1]:null;
    if(previous){
      const separated=result.minimumSeparation
        ?previous.squadHealth>row.squadHealth
        :previous.squadHealth+1e-9>=row.squadHealth*(1+result.separation);
      assert.ok(separated,`${result.category} death order or separation was not preserved`);
    }
    const step=Math.max(1,Number(row.roundTo||1));
    const cost=step*Number(row.capEach??row.unitCapacityEach??0);
    if(cost>remaining)continue;
    const nextHealth=(Number(row.qty)+step)*Number(row.physicalHealthEach??row.effectiveEach??row.unitEffectiveHealthEach);
    assert.ok(previous&&nextHealth>=previous.squadHealth,`${result.category} left a legal ${cost}-capacity top-up unused`);
  }
}

const standardTroop=calculateCategory({category:'troop',units:troops,selectedIds:troopIds,inputs});
const standardMonster=calculateCategory({category:'monster',units:monsters,selectedIds:monsterIds,inputs});
assert.ok(standardTroop.capacityTopUpUsed>0,'Standard troops should exercise the deterministic top-up pass');
assert.ok(standardMonster.capacityTopUpUsed>0,'Standard monsters should exercise the deterministic top-up pass');
assertCategoryIsFullestLegal(standardTroop);
assertCategoryIsFullestLegal(standardMonster);

const customTroop=calculateCustomCategory({
  category:'troop',units:troops,selectedIds:troopIds,inputs,
  order:[...new Set(standardTroop.deathOrderIds.map(id=>troops.find(unit=>unit.id===id)?.level))],
  unitOrder:standardTroop.deathOrderIds,
});
assert.ok(customTroop.capacityTopUpUsed>0,'Custom Order should exercise the deterministic top-up pass');
assertCategoryIsFullestLegal(customTroop);

const repeat=calculateCategory({category:'monster',units:monsters,selectedIds:monsterIds,inputs});
assert.deepEqual(
  repeat.results.map(row=>[row.id,row.qty]),
  standardMonster.results.map(row=>[row.id,row.qty]),
  'Top-up quantities must be deterministic',
);

const stack=calculateEpicStack({
  troops,monsters,mercenaries:[],
  selectedIds:{troop:troopIds,monster:monsterIds,mercenary:[]},inputs,
});
for(const [category,result] of Object.entries(stack.categories)){
  if(!result.results.length)continue;
  assert.ok(result.totalCapacity<=result.capacityLimit*Math.max(0,Math.min(1,result.requestedFill))+1e-9,`${category} stack capacity exceeded its target`);
}
const globalHealth=Object.values(stack.categories).flatMap(result=>result.results).filter(row=>row.qty>0).map(row=>row.squadHealth).sort((a,b)=>b-a);
for(let index=1;index<globalHealth.length;index++)assert.ok(globalHealth[index-1]>globalHealth[index],'Final combined top-up reintroduced a global health tie');

console.log(JSON.stringify({
  standardLeadership:{used:standardTroop.totalCapacity,limit:inputs.leadership,topUp:standardTroop.capacityTopUpUsed},
  standardDominance:{used:standardMonster.totalCapacity,limit:inputs.dominance,topUp:standardMonster.capacityTopUpUsed},
  customLeadership:{used:customTroop.totalCapacity,limit:inputs.leadership,topUp:customTroop.capacityTopUpUsed},
}));
