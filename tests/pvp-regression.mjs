import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  calculatePvpCpStack,calculatePvpCustomStack,
  calculatePvpUnknownStack,calculatePvpUnknownCustomStack,pvpDamageProfile,
} from '../js/battle-engine.mjs';
import { squadRevivalCosts } from '../js/combat-mechanics.mjs';

const canonical=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const mercGroups={COM:'COMMON',MNST:'MONSTER',SPCL:'SPECIALIST',GRD:'GUARDSMAN',EMH:'EPIC - HUNTER',EX:'EPIC - EVENT',ARNE:'ARACHNE',ENG:'ENGINEER'};
function legacy(unit){
  const capacityField=unit.category==='troop'?'leadershipEach':unit.category==='monster'?'dominanceEach':'authorityEach';
  const subtype=String(unit.tier||'').toUpperCase().split('-').slice(1).join('-');
  return{id:unit.id,unitId:unit.unitId,category:unit.category,displayOrder:unit.displayOrder,
    class:unit.category==='mercenary'?(mercGroups[subtype]||unit.unitClass):unit.unitClass,
    type:unit.combatType,name:unit.name,level:unit.tier,strengthEach:unit.baseStrength,healthEach:unit.baseHealth,
    [capacityField]:unit.capacityCost,species:unit.species,selectionKey:`${unit.tier}|${unit.combatType}`,
    icon:unit.icon,bonuses:{...(unit.bonuses||{})},goldRevivalCost:Number(unit.goldRevivalCost||0),silverRevivalCost:Number(unit.silverRevivalCost||0)};
}
const army=canonical.map(legacy),troops=army.filter(u=>u.category==='troop'),monsters=army.filter(u=>u.category==='monster'),mercenaries=army.filter(u=>u.category==='mercenary');
const byId=new Map(army.map(unit=>[unit.id,unit]));
const selectedIds={
  troop:troops.filter(unit=>/^[GSE][89]$/.test(unit.level)).map(unit=>unit.id),
  monster:monsters.filter(unit=>/^M[789]$/.test(unit.level)).map(unit=>unit.id),
  mercenary:mercenaries.filter(unit=>['2-SPCL','2-GRD','2-ENG'].includes(unit.level)).slice(0,6).map(unit=>unit.id),
};
const baseInputs={leadership:667968,leadershipFill:.9996,dominance:141006,dominanceFill:.9982,authority:289680,authorityFill:.10,
  healthInputs:{MONSTER:1637.5,HUMAN:1537.5,EPIC_HUNTER:896.5},monsterStrengthPct:1982,humanStrengthPct:1882,epicHunterStrengthPct:1241,
  monsterDDPct:24,humanDDPct:24,epicHunterDDPct:24,monsterSTPct:24,humanSTPct:19,epicHunterSTPct:19,
  templeLevel:45,templeRevivalDivisor:5.91,minimumSeparation:true,rankSeparation:.0005};
const enemy=byId.get('troop-g9-flying-corax-2');

function rows(result){return [...result.categories.troop.results,...result.categories.monster.results,...result.categories.mercenary.results];}
function defaultCustomArgs(standard){
  const squadOrders=Object.fromEntries(['troop','monster','mercenary'].map(category=>[category,standard.plannedOrder.filter(id=>byId.get(id)?.category===category)]));
  const orders=Object.fromEntries(['troop','monster','mercenary'].map(category=>[category,[...new Set(squadOrders[category].map(id=>byId.get(id).level))]]));
  return{orders,squadOrders};
}
function assertPhysical(result,inputs){
  const resultRows=rows(result),actual=resultRows.slice().sort((a,b)=>b.squadHealth-a.squadHealth||a.unitId-b.unitId);
  for(let index=0;index<resultRows.length;index++){
    const row=resultRows[index],unit=byId.get(row.id),profile=pvpDamageProfile(unit,inputs,result.enemy);
    assert.equal(row.expectedPvpDamage,profile.expectedEach*row.qty,`${row.id} stale damage`);
    const revival=squadRevivalCosts({quantity:row.qty,goldEach:unit.goldRevivalCost,silverEach:unit.silverRevivalCost,templeDivisor:inputs.templeRevivalDivisor});
    assert.equal(row.actualGoldRevivalCost,revival.actualGold,`${row.id} stale Gold`);
    assert.equal(row.actualSilverRevivalCost,revival.actualSilver,`${row.id} stale Silver`);
    assert.ok(Number.isInteger(row.qty)&&row.qty>=0,`${row.id} illegal quantity`);
  }
  for(let index=1;index<actual.length;index++)assert.ok(actual[index-1].squadHealth>actual[index].squadHealth,'health order must be strict');
  assert.equal(result.strictHealthUnresolved,0,'health legalization must resolve all ties');
  assert.ok(result.totals.leadership<=inputs.leadership*inputs.leadershipFill+1e-6,'Leadership capacity exceeded');
  assert.ok(result.totals.dominance<=inputs.dominance*inputs.dominanceFill+1e-6,'Dominance capacity exceeded');
  assert.ok(result.totals.authority<=inputs.authority*inputs.authorityFill+1e-6,'Authority capacity exceeded');
  const pld=resultRows.reduce((sum,row)=>sum+row.expectedPvpDamage*row.averageAttackOpportunities,0);
  assert.ok(Math.abs(pld-result.projectedLifetimeDamage)<=Math.max(1e-6,Math.abs(pld)*1e-12),'PLD does not equal squad total');
}
function assertDefaultParity(standard,custom){
  assert.equal(custom.projectedLifetimeDamage,standard.projectedLifetimeDamage,'Custom default PLD must equal Standard');
  assert.deepEqual(custom.plannedOrder,standard.plannedOrder,'Custom default must preserve the global Standard ladder');
  assert.deepEqual(Object.fromEntries(rows(custom).map(row=>[row.id,row.qty])),Object.fromEntries(rows(standard).map(row=>[row.id,row.qty])),'Custom default quantities must equal Standard');
}

const expectedGolden={
  minimum:{knownPld:1371809909488.4553,knownGold:302446.02368866326,unknownPld:1416770760642.2603,unknownGold:297545.8544839255},
  fixed:{knownPld:1371809909488.4553,knownGold:302446.02368866326,unknownPld:1405132679896.9216,unknownGold:295449.0693739424},
};

const emptySelected={troop:[],monster:[],mercenary:[]};
for(const empty of [
  calculatePvpCpStack({troops,monsters,mercenaries,selectedIds:emptySelected,inputs:baseInputs,enemy,battleType:'pvp_single_cp'}),
  calculatePvpUnknownStack({troops,monsters,mercenaries,selectedIds:emptySelected,inputs:baseInputs}),
]){
  assert.equal(empty.projectedLifetimeDamage,0);
  assert.equal(empty.actualAttritionGold,0);
  assert.equal(empty.actualAttritionSilver,0);
  assert.deepEqual(empty.plannedOrder,[]);
  assert.equal(empty.strictHealthUnresolved,0);
}

const golden={};
for(const minimumSeparation of [true,false]){
  const inputs={...baseInputs,minimumSeparation};
  const known=calculatePvpCpStack({troops,monsters,mercenaries,selectedIds,inputs,enemy,battleType:'pvp_single_cp'});
  assert.equal(known.projectionModel,'two-initiative-event-v1');
  if(known.diagnostics.orderCycleDetected){
    assert.ok(known.diagnostics.orderCycleLength>1,'known-enemy cycle length must be reported');
    assert.equal(known.diagnostics.orderCycleResolution,'gold-band-damage-silver');
  }
  assertPhysical(known,inputs);
  const knownDefault=defaultCustomArgs(known);
  const knownCustom=calculatePvpCustomStack({troops,monsters,mercenaries,selectedIds,...knownDefault,inputs,enemy,battleType:'pvp_single_cp'});
  assertPhysical(knownCustom,inputs);assertDefaultParity(known,knownCustom);

  const unknown=calculatePvpUnknownStack({troops,monsters,mercenaries,selectedIds,inputs});
  assert.equal(unknown.projectionModel,'unknown-archetype-comparison-v1');
  assert.equal(unknown.enemy.archetypeWeighting,'equal-supported-archetype');
  assert.equal(unknown.enemy.archetypes.length,20);
  if(unknown.diagnostics.orderCycleDetected){
    assert.ok(unknown.diagnostics.orderCycleLength>1,'unknown-enemy cycle length must be reported');
    assert.equal(unknown.diagnostics.orderCycleResolution,'gold-band-damage-silver');
  }
  assertPhysical(unknown,inputs);
  const unknownDefault=defaultCustomArgs(unknown);
  const unknownCustom=calculatePvpUnknownCustomStack({troops,monsters,mercenaries,selectedIds,...unknownDefault,inputs});
  assertPhysical(unknownCustom,inputs);assertDefaultParity(unknown,unknownCustom);

  const manualOrders=structuredClone(knownDefault.squadOrders);
  [manualOrders.troop[0],manualOrders.troop[1]]=[manualOrders.troop[1],manualOrders.troop[0]];
  const manual=calculatePvpCustomStack({troops,monsters,mercenaries,selectedIds,orders:knownDefault.orders,squadOrders:manualOrders,inputs,enemy,battleType:'pvp_single_cp'});
  assertPhysical(manual,inputs);
  assert.notDeepEqual(manual.plannedOrder,known.plannedOrder,'manual order must change the ladder');
  assert.deepEqual(manual.plannedOrder.map(id=>byId.get(id).category),known.plannedOrder.map(id=>byId.get(id).category),'manual category order must preserve the global category slot pattern');

  golden[minimumSeparation?'minimum':'fixed']={knownPld:known.projectedLifetimeDamage,knownGold:known.actualAttritionGold,unknownPld:unknown.projectedLifetimeDamage,unknownGold:unknown.actualAttritionGold};
}
assert.deepEqual(golden,expectedGolden,'PvP golden fixture changed');
console.log(JSON.stringify({ok:true,selected:Object.fromEntries(Object.entries(selectedIds).map(([category,ids])=>[category,ids.length])),golden},null,2));
