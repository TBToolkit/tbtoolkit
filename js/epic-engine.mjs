import { BONUS_FAMILY_BY_SPECIES, effectiveHealthEachFromHealthInputs, legalizePhysicalCategoryRows } from './epic-mechanics.mjs?v=190-dev1';
import { mroundPositive } from './combat-mechanics.mjs?v=190-dev1';
import { buildSquad, deriveBonusInputs, scoreEpicArmy } from './epic-combat-engine-v2.mjs?v=190-dev1';

const SPECIES_GROUP = BONUS_FAMILY_BY_SPECIES;

const CATEGORY_CONFIG = Object.freeze({
  troop: {
    capacityInput: 'leadership',
    fillInput: 'leadershipFill',
    capacityEach: 'leadershipEach',
    totalName: 'leadership',
  },
  monster: {
    capacityInput: 'dominance',
    fillInput: 'dominanceFill',
    capacityEach: 'dominanceEach',
    totalName: 'dominance',
  },
  mercenary: {
    capacityInput: 'authority',
    fillInput: 'authorityFill',
    capacityEach: 'authorityEach',
    totalName: 'authority',
  },
});

function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function maxOf(values) {
  let max = 0;
  for (const value of values) {
    const n = numberOrZero(value);
    if (n > max) max = n;
  }
  return max;
}

/** Excel-compatible MROUND behavior for the positive quantities used by BIFF STACK. */
export { mroundPositive };

export function speciesAdjustment(species, healthInputs) {
  const group = SPECIES_GROUP[species];
  if (!group) throw new Error(`Unknown species: ${species}`);

  const humanHealth = healthInputs.HUMAN;
  const speciesHealth = healthInputs[group];
  if (!(humanHealth > 0) || !(speciesHealth > 0)) {
    throw new Error(`Health inputs must be > 0; HUMAN=${humanHealth}, ${group}=${speciesHealth}`);
  }
  return (humanHealth - speciesHealth) / humanHealth;
}

export function pveScore(unit, arachne = false) {
  const b = unit.bonuses ?? {};
  const core = [b.flying, b.mounted, b.melee, b.ranged];
  if (unit.category === 'mercenary') core.push(b.epic);
  let score = maxOf(core);
  if (unit.category === 'mercenary' && arachne) score += numberOrZero(b.arachne);
  return score;
}

function selectedUnits(units, selectedIds, selectedKeys) {
  // Native web UI selects individual unit records by stable ID. selectedKeys remains
  // supported for BIFF STACK v2.2 parity tests and migration from the first beta.
  const ids = new Set(selectedIds ?? []);
  if (ids.size) return units.filter((u) => ids.has(u.id));
  const keys = new Set(selectedKeys ?? []);
  return units.filter((u) => keys.has(u.selectionKey));
}

function rankSelected(units, arachne) {
  return [...units]
    .map((unit) => ({ unit, pve: pveScore(unit, arachne) }))
    .sort((a, b) => {
      if (b.pve !== a.pve) return b.pve - a.pve;
      return a.unit.displayOrder - b.unit.displayOrder;
    })
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function roundingMultiple(capacityEach, roundingTable) {
  if (!roundingTable?.length) return 1;
  // Mirrors XLOOKUP(..., match_mode=-1): exact or next smaller lookup value.
  const sorted = [...roundingTable].sort((a, b) => a.capacity - b.capacity);
  let match = sorted[0];
  for (const row of sorted) {
    if (row.capacity <= capacityEach) match = row;
    else break;
  }
  return match.roundTo;
}

export function calculateCategory({
  category,
  units,
  selectedKeys,
  selectedIds,
  deathOrderIds = null,
  inputs,
  roundingTable = [
    { capacity: 1, roundTo: 1 },
    { capacity: 2, roundTo: 1 },
    { capacity: 5, roundTo: 1 },
    { capacity: 10, roundTo: 1 },
    { capacity: 20, roundTo: 1 },
    { capacity: 1000, roundTo: 1 },
  ],
}) {
  const config = CATEGORY_CONFIG[category];
  if (!config) throw new Error(`Unknown category: ${category}`);

  const selected = selectedUnits(units, selectedIds, selectedKeys);
  if (selected.length === 0) {
    return {
      category,
      selectedCount: 0,
      maxHealthEach: 0,
      sumD: 0,
      totalCapacity: 0,
      capacityPercent: 0,
      results: [],
    };
  }

  const explicitDeathIndex = new Map((deathOrderIds ?? []).map((id,index)=>[id,index]));
  const hasCompleteDeathOrder = selected.length > 0 && selected.every(unit=>explicitDeathIndex.has(unit.id));
  const ranked = hasCompleteDeathOrder
    ? selected.map(unit=>({
        unit,
        pve:pveScore(unit,inputs.arachne),
        rank:selected.length-explicitDeathIndex.get(unit.id),
      }))
    : rankSelected(selected, inputs.arachne);
  const maxHealthEach = Math.max(...selected.map((u) => u.healthEach));
  const capacityLimit = inputs[config.capacityInput];
  const fill = inputs[config.fillInput];
  const rankSeparation = inputs.minimumSeparation ? 0 : inputs.rankSeparation;

  const interim = ranked.map(({ unit, pve, rank }) => {
    const adj = speciesAdjustment(unit.species, inputs.healthInputs);
    const pveModifier = (rank - 1) * rankSeparation;
    const modifier = 1 + pveModifier + adj;
    const capEach = unit[config.capacityEach];
    const physicalHealthEach = effectiveHealthEachFromHealthInputs(unit, inputs.healthInputs);
    const C = (modifier * maxHealthEach) / unit.healthEach;
    const D = C * capEach;
    return { unit, pve, rank, speciesAdjustment: adj, pveModifier, modifier, C, D, capEach, physicalHealthEach };
  });

  const sumD = interim.reduce((sum, row) => sum + row.D, 0);

  const results = interim.map((row) => {
    const rawQty = (row.D / sumD) * (capacityLimit / row.capEach) * fill;
    const roundTo = roundingMultiple(row.capEach, roundingTable);
    const qty = mroundPositive(rawQty, roundTo);
    const squadStrength = row.unit.strengthEach * qty;
    const totalCapacity = row.capEach * qty;
    const legacySquadHealth = (qty * row.unit.healthEach) / (1 + row.speciesAdjustment);
    const squadHealth = qty * row.physicalHealthEach;
    const nominalHealth =
      (row.D / sumD) * (capacityLimit / row.capEach) * row.unit.healthEach;

    return {
      id: row.unit.id,
      category,
      displayOrder: row.unit.displayOrder,
      selectionKey: row.unit.selectionKey,
      level: row.unit.level,
      type: row.unit.type,
      name: row.unit.name,
      icon: row.unit.icon,
      qty,
      rawQty,
      roundTo,
      pve: row.pve,
      rank: row.rank,
      pveModifier: row.pveModifier,
      speciesAdjustment: row.speciesAdjustment,
      modifier: row.modifier,
      C: row.C,
      D: row.D,
      squadHealth,
      legacySquadHealth,
      squadStrength,
      totalCapacity,unitCapacityEach:row.capEach,unitStrengthEach:row.unit.strengthEach,unitEffectiveHealthEach:row.physicalHealthEach,physicalHealthEach:row.physicalHealthEach,
      nominalHealth,
    };
  });

  if(inputs.minimumSeparation){
    const byId=new Map(results.map(r=>[r.id,r])),deathIds=ranked.slice().sort((a,b)=>b.rank-a.rank).map(x=>x.unit.id);let prev=null;
    for(const id of deathIds){const row=byId.get(id);if(!row)continue;const each=row.qty>0?row.squadHealth/row.qty:0,step=Math.max(1,row.roundTo||1);
      if(prev&&each>0&&row.squadHealth>=prev.squadHealth){const q=Math.max(step,Math.floor((Math.ceil(prev.squadHealth/each)-1)/step)*step);if(q<row.qty){row.qty=q;row.totalCapacity=row.unitCapacityEach*q;row.squadHealth=q*each;row.squadStrength=row.unitStrengthEach*q;}}
      prev=row;}
  }
  if(inputs.minimumSeparation&&capacityLimit>0){
    const targetCapacity=capacityLimit*Math.max(0,Math.min(1,Number(fill)||0));
    for(let pass=0;pass<5;pass++){
      const used=results.reduce((s,r)=>s+r.totalCapacity,0);if(!(used>0)||used>=targetCapacity*.9995)break;
      const scale=targetCapacity/used;
      for(const row of results){const step=Math.max(1,row.roundTo||1),q=Math.max(step,Math.floor((row.qty*scale)/step)*step);row.qty=q;row.totalCapacity=row.unitCapacityEach*q;const each=row.unitEffectiveHealthEach;row.squadHealth=each*q;row.squadStrength=row.unitStrengthEach*q;}
      const byId=new Map(results.map(r=>[r.id,r])),deathIds=ranked.slice().sort((a,b)=>b.rank-a.rank).map(x=>x.unit.id);let prev=null;
      for(const id of deathIds){const row=byId.get(id);if(!row)continue;const each=row.qty>0?row.squadHealth/row.qty:0,step=Math.max(1,row.roundTo||1);if(prev&&each>0&&row.squadHealth>=prev.squadHealth){const q=Math.max(step,Math.floor((Math.ceil(prev.squadHealth/each)-1)/step)*step);if(q<row.qty){row.qty=q;row.totalCapacity=row.unitCapacityEach*q;row.squadHealth=q*each;row.squadStrength=row.unitStrengthEach*q;}}prev=row;}
    }
  }
  const standardDeathIds=hasCompleteDeathOrder
    ? [...deathOrderIds]
    : ranked.slice().sort((a,b)=>b.rank-a.rank).map(x=>x.unit.id);
  if(!inputs._skipHardCapacity){
    const requestedCapacity=capacityLimit*Math.max(0,Math.min(1,Number(fill)||0));
    enforceRequestedCapacity(results,requestedCapacity,standardDeathIds);
  }
  const strictHealth=legalizePhysicalCategoryRows(results,standardDeathIds,{minimumSeparation:Boolean(inputs.minimumSeparation),separation:Number(inputs.rankSeparation||0)});
  const totalCapacity = results.reduce((sum, row) => sum + row.totalCapacity, 0);
  const displayResults = [...results].sort((a, b) => a.displayOrder - b.displayOrder);

  return {
    category,
    selectedCount: selected.length,
    maxHealthEach,
    sumD,
    capacityLimit,
    requestedFill: fill,
    totalCapacity,
    capacityPercent: capacityLimit ? totalCapacity / capacityLimit : 0,
    strictHealthAdjustments:strictHealth.adjustments,
    strictHealthUnresolved:strictHealth.unresolved,
    results: displayResults,
  };
}

function canonicalEpicUnit(unit,category){
  const capacityEach=category==='troop'?'leadershipEach':category==='monster'?'dominanceEach':'authorityEach';
  return{
    id:unit.id,
    unitId:Number.isInteger(unit.unitId)?unit.unitId:Number(unit.displayOrder||0),
    displayOrder:Number(unit.displayOrder||0),
    capacityType:unit.capacityType||(category==='troop'?'LEADERSHIP':category==='monster'?'DOMINANCE':'AUTHORITY'),
    category,
    combatType:unit.combatType||unit.type,
    unitClass:unit.unitClass||unit.class,
    species:unit.species,
    name:unit.name,
    tier:unit.tier||unit.level,
    tierNumber:Number(unit.tierNumber??String(unit.tier||unit.level||'').match(/\d+/)?.[0]??0),
    icon:unit.icon,
    capacityCost:Number(unit.capacityCost??unit[capacityEach]??0),
    baseStrength:Number(unit.baseStrength??unit.strengthEach??0),
    baseHealth:Number(unit.baseHealth??unit.healthEach??0),
    goldRevivalCost:Number(unit.goldRevivalCost||0),
    silverRevivalCost:Number(unit.silverRevivalCost||0),
    bonuses:{...(unit.bonuses||{})},
  };
}

function epicBonusPayloadFromEngineInputs(inputs){
  const required=[inputs?.monsterStrengthPct,inputs?.strengthAgainstEpicPct,inputs?.monsterDDPct,inputs?.monsterSTPct];
  if(required.some(value=>!Number.isFinite(Number(value))))return null;
  return{
    monsterHealthPct:Number(inputs.healthInputs?.MONSTER||0),
    monsterStrengthPct:Number(inputs.monsterStrengthPct),
    strengthAgainstEpicPct:Number(inputs.strengthAgainstEpicPct),
    monsterDDPct:Number(inputs.monsterDDPct),
    monsterSTPct:Number(inputs.monsterSTPct),
    arachne:Boolean(inputs.arachne),
    useCustomFamilyBonuses:true,
    customFamilyBonuses:{
      humanHealthPct:Number(inputs.healthInputs?.HUMAN||0),
      epicHunterHealthPct:Number(inputs.healthInputs?.EPIC_HUNTER||0),
      humanStrengthPct:Number(inputs.humanStrengthPct),
      epicHunterStrengthPct:Number(inputs.epicHunterStrengthPct),
      humanDDPct:Number(inputs.humanDDPct),
      epicHunterDDPct:Number(inputs.epicHunterDDPct),
      humanSTPct:Number(inputs.humanSTPct),
      epicHunterSTPct:Number(inputs.epicHunterSTPct),
    },
  };
}

function automaticDeathOrder(group,arachne){
  return rankSelected(group,arachne).slice().sort((a,b)=>b.rank-a.rank).map(row=>row.unit.id);
}

function epicDeathOrderCandidates(group,category,bonuses){
  const current=automaticDeathOrder(group,bonuses.arachne);
  if(!group.length)return{current,selective:current,tiebreak:current};
  const damage=new Map(group.map(unit=>[unit.id,buildSquad(canonicalEpicUnit(unit,category),1,bonuses).expectedDamagePerOpportunity]));
  const selective=category==='troop'
    ?group.slice().sort((a,b)=>{
      const ae=String(a.unitClass||a.class).toUpperCase()==='ENGINEER'?0:1;
      const be=String(b.unitClass||b.class).toUpperCase()==='ENGINEER'?0:1;
      if(ae!==be)return ae-be;
      if(ae===0)return Number(a.tierNumber||0)-Number(b.tierNumber||0)||Number(a.displayOrder||0)-Number(b.displayOrder||0);
      return damage.get(a.id)-damage.get(b.id)||Number(a.displayOrder||0)-Number(b.displayOrder||0);
    }).map(unit=>unit.id)
    :current;
  const tiebreak=group.slice().sort((a,b)=>
    pveScore(a,bonuses.arachne)-pveScore(b,bonuses.arachne)||
    damage.get(a.id)-damage.get(b.id)||
    Number(a.displayOrder||0)-Number(b.displayOrder||0)
  ).map(unit=>unit.id);
  return{current,selective,tiebreak};
}

function calculateEpicStackCandidate({troops,monsters,mercenaries,selectedKeys,selectedIds,inputs,roundingTable,orders,strategy}){
  const troop = calculateCategory({
    category: 'troop',
    units: troops,
    selectedKeys: selectedKeys.troop,
    selectedIds: selectedIds.troop,
    deathOrderIds:orders?.troop,
    inputs,
    roundingTable,
  });
  const monster = calculateCategory({
    category: 'monster',
    units: monsters,
    selectedKeys: selectedKeys.monster,
    selectedIds: selectedIds.monster,
    deathOrderIds:orders?.monster,
    inputs,
    roundingTable,
  });
  const mercenary = calculateCategory({
    category: 'mercenary',
    units: mercenaries,
    selectedKeys: selectedKeys.mercenary,
    selectedIds: selectedIds.mercenary,
    deathOrderIds:orders?.mercenary,
    inputs,
    roundingTable,
  });

  const categories={troop,monster,mercenary};
  const globalStrictHealth=enforceDistinctGlobalHealth(categories);
  for(const cat of [troop,monster,mercenary]){
    cat.totalCapacity=cat.results.reduce((s,r)=>s+Number(r.totalCapacity||0),0);
    cat.capacityPercent=cat.capacityLimit?cat.totalCapacity/cat.capacityLimit:0;
  }
  return {
    inputs: structuredClone(inputs),
    categories,
    strictHealthAdjustments:globalStrictHealth.adjustments,
    strictHealthUnresolved:globalStrictHealth.unresolved,
    totals: {
      leadership: troop.totalCapacity,
      dominance: monster.totalCapacity,
      authority: mercenary.totalCapacity,
    },
    plannedOrderByCategory:{troop:[...(orders?.troop||[])],monster:[...(orders?.monster||[])],mercenary:[...(orders?.mercenary||[])]},
    deathLadderStrategy:strategy,
  };
}

export function calculateEpicStack({ troops, monsters, mercenaries, selectedKeys = {}, selectedIds = {}, inputs, roundingTable }) {
  const bonusPayload=epicBonusPayloadFromEngineInputs(inputs);
  const selectedByCategory={
    troop:selectedUnits(troops,selectedIds.troop,selectedKeys.troop),
    monster:selectedUnits(monsters,selectedIds.monster,selectedKeys.monster),
    mercenary:selectedUnits(mercenaries,selectedIds.mercenary,selectedKeys.mercenary),
  };
  if(!bonusPayload){
    const orders=Object.fromEntries(Object.entries(selectedByCategory).map(([category,group])=>[category,automaticDeathOrder(group,inputs.arachne)]));
    return calculateEpicStackCandidate({troops,monsters,mercenaries,selectedKeys,selectedIds,inputs,roundingTable,orders,strategy:'current_matchup'});
  }

  const candidateOrders={current_matchup:{},selective_hybrid:{},matchup_damage_tiebreak:{}};
  const resolvedBonuses=deriveBonusInputs(bonusPayload);
  for(const [category,group] of Object.entries(selectedByCategory)){
    const orders=epicDeathOrderCandidates(group,category,resolvedBonuses);
    candidateOrders.current_matchup[category]=orders.current;
    candidateOrders.selective_hybrid[category]=orders.selective;
    candidateOrders.matchup_damage_tiebreak[category]=orders.tiebreak;
  }
  const canonicalUnits=Object.entries(selectedByCategory).flatMap(([category,group])=>group.map(unit=>canonicalEpicUnit(unit,category)));
  const candidates=Object.entries(candidateOrders).map(([strategy,orders])=>{
    const stack=calculateEpicStackCandidate({troops,monsters,mercenaries,selectedKeys,selectedIds,inputs,roundingTable,orders,strategy});
    const quantities={};
    for(const category of ['troop','monster','mercenary'])for(const row of stack.categories[category].results)quantities[row.id]=Number(row.qty||0);
    const score=scoreEpicArmy({units:canonicalUnits,quantities,bonuses:bonusPayload});
    return{strategy,orders,stack,eld:Number(score.expectedTotalLifetimeDamage||0)};
  });
  const chosen=candidates.reduce((best,candidate)=>candidate.eld>best.eld+1e-6?candidate:best,candidates[0]);
  chosen.stack.deathLadderSelection={
    strategy:chosen.strategy,
    expectedLifetimeDamage:chosen.eld,
    orders:structuredClone(chosen.orders),
    candidates:candidates.map(candidate=>({strategy:candidate.strategy,expectedLifetimeDamage:candidate.eld})),
  };
  return chosen.stack;
}



function enforceRequestedCapacity(results,targetCapacity,deathOrderIds=null){
  const target=Math.max(0,Number(targetCapacity||0));
  let used=results.reduce((s,r)=>s+Number(r.totalCapacity||0),0);
  if(used<=target+1e-9)return;

  const byId=new Map(results.map(r=>[r.id,r]));
  const ordered=(deathOrderIds||[]).map(id=>byId.get(id)).filter(Boolean);
  const seen=new Set(ordered.map(r=>r.id));
  for(const row of results)if(!seen.has(row.id))ordered.push(row);

  // Trim from the end of the planned death ladder. Reducing a later squad
  // lowers its health and therefore cannot move it ahead of an earlier squad.
  const trim=ordered.slice().reverse();
  let guard=0;
  while(used>target+1e-9&&guard++<100000){
    let changed=false;
    for(const row of trim){
      const step=Math.max(1,Number(row.roundTo||1));
      const qty=Math.max(0,Number(row.qty||0));
      if(qty<step)continue;
      const capEach=Number(row.capEach??row.unitCapacityEach??0);
      if(!(capEach>0))continue;

      const newQty=qty-step;
      row.qty=newQty;
      row.totalCapacity=capEach*newQty;

      const each=Number(
        row.effectiveEach ??
        row.unitEffectiveHealthEach ??
        (qty>0?Number(row.squadHealth||0)/qty:0)
      );
      row.squadHealth=each*newQty;
      row.squadStrength=Number(row.unitStrengthEach||0)*newQty;

      used-=capEach*step;
      changed=true;
      if(used<=target+1e-9)break;
    }
    if(!changed)break;
  }
}


function enforceStrictHealthOrder(results,deathOrderIds,minimumQuantity=1){
  const byId=new Map(results.map(r=>[r.id,r]));
  const ordered=(deathOrderIds||[]).map(id=>byId.get(id)).filter(Boolean);
  let adjustments=0,unresolved=0;
  let prev=null;

  for(const row of ordered){
    if(!(Number(row.qty)>0)){continue;}
    const each=Number(
      row.effectiveEach ??
      row.unitEffectiveHealthEach ??
      (Number(row.qty)>0?Number(row.squadHealth||0)/Number(row.qty):0)
    );
    const step=Math.max(1,Number(row.roundTo||1));

    const strictThreshold=prev?Number(prev.squadHealth)-Math.max(1e-6,Math.abs(Number(prev.squadHealth))*1e-10):null;
    if(prev&&each>0&&Number(row.squadHealth)>=strictThreshold){
      // Largest legal quantity whose health is strictly below the preceding
      // intended death. For the normal step=1 case, an exact tie becomes q-1.
      const minQty=Math.max(step,Math.ceil(Number(minimumQuantity||1)/step)*step);
      let maxQty=Math.floor((strictThreshold/each)/step)*step;
      while(maxQty>=minQty&&maxQty*each>=strictThreshold)maxQty-=step;
      const nextQty=Math.max(minQty,Math.min(Number(row.qty),maxQty));

      if(nextQty<Number(row.qty)){
        row.qty=nextQty;
        const capEach=Number(row.capEach??row.unitCapacityEach??0);
        row.totalCapacity=capEach*nextQty;
        row.squadHealth=each*nextQty;
        row.squadStrength=Number(row.unitStrengthEach||0)*nextQty;
        adjustments++;
      }
      if(Number(row.squadHealth)>=strictThreshold)unresolved++;
    }
    prev=row;
  }
  return{adjustments,unresolved};
}

function enforceDistinctGlobalHealth(categories){
  const rows=['troop','monster','mercenary'].flatMap(cat=>categories?.[cat]?.results||[])
    .filter(r=>Number(r.qty)>0)
    .sort((a,b)=>Number(b.squadHealth)-Number(a.squadHealth)||
      Number(a.deathIndex??a.rank??999)-Number(b.deathIndex??b.rank??999)||
      Number(a.displayOrder||0)-Number(b.displayOrder||0));
  let adjustments=0,unresolved=0,prev=null;
  for(const row of rows){
    if(!prev){prev=row;continue;}
    const strictThreshold=Number(prev.squadHealth)-Math.max(1e-6,Math.abs(Number(prev.squadHealth))*1e-10);
    if(Number(row.squadHealth)>=strictThreshold){
      const qty=Number(row.qty||0),step=Math.max(1,Number(row.roundTo||1));
      const each=Number(row.effectiveEach??row.unitEffectiveHealthEach??(qty>0?Number(row.squadHealth||0)/qty:0));
      if(each>0){
        let maxQty=Math.floor((strictThreshold/each)/step)*step;
        while(maxQty>=step&&maxQty*each>=strictThreshold)maxQty-=step;
        const nextQty=Math.max(step,Math.min(qty,maxQty));
        if(nextQty<qty){
          row.qty=nextQty;
          const capEach=Number(row.capEach??row.unitCapacityEach??0);
          row.totalCapacity=capEach*nextQty;
          row.squadHealth=each*nextQty;
          row.squadStrength=Number(row.unitStrengthEach||0)*nextQty;
          adjustments++;
        }
      }
      if(Number(row.squadHealth)>=strictThreshold)unresolved++;
    }
    prev=row;
  }
  return{adjustments,unresolved};
}

function customScore(unit) { return pveScore(unit, false); }

export function customInternalRank(unit, allUnits) {
  const score = customScore(unit);
  let lower = 0;
  for (const other of allUnits) {
    if (other.level === unit.level && customScore(other) < score) lower++;
  }
  return 1 + lower;
}

export function calculateCustomCategory({
  category, units, selectedIds, inputs, order, unitOrder = null,
  roundingTable = [
    {capacity:1,roundTo:1},{capacity:2,roundTo:1},{capacity:5,roundTo:1},
    {capacity:10,roundTo:1},{capacity:20,roundTo:1},{capacity:1000,roundTo:1}
  ]
}) {
  const config = CATEGORY_CONFIG[category];
  if (!config) throw new Error(`Unknown category: ${category}`);
  const selected = selectedUnits(units, selectedIds, null);
  if (!selected.length) return {category,selectedCount:0,maxHealthEach:0,sumD:0,totalCapacity:0,capacityPercent:0,results:[]};

  const orderMap = new Map((order || []).map((level,index)=>[level,index]));
  const explicitRank=new Map((unitOrder||[]).map((id,index)=>[id,index]));
  const explicitComplete=selected.every(unit=>explicitRank.has(unit.id));
  if(!explicitComplete)for (const unit of selected) if (!orderMap.has(unit.level)) throw new Error(`Add ${unit.level} to the ${category} die order.`);

  // Custom Order must use the same effective-health model as the battle
  // simulator. The previous relative species adjustment was only an
  // approximation and could invert manually ordered units from different
  // health families (for example Human vs Beast inside the same tier).
  const effectiveHealthEach = unit=>effectiveHealthEachFromHealthInputs(unit, inputs.healthInputs);
  const maxHealthEach = Math.max(...selected.map(effectiveHealthEach));
  const capacityLimit = inputs[config.capacityInput];
  const fill = inputs[config.fillInput];
  const separation = inputs.minimumSeparation ? 0 : (Number.isFinite(inputs.rankSeparation) ? inputs.rankSeparation : inputs.layerSeparation);

  // Custom Stacker uses the player's level order to define the death ladder.
  // Within each level, the existing matchup ranking remains automatic: weaker
  // matchup squads die earlier and stronger matchup squads die later. Squad
  // Separation is then applied between every adjacent squad in that full order,
  // matching the health-ladder concept used by Epic Stacker.
  const ordered = selected
    .map(unit=>({unit,orderIndex:orderMap.get(unit.level)??0,rank:explicitRank.has(unit.id)?explicitRank.get(unit.id):customInternalRank(unit,units)}))
    .sort((a,b)=>explicitComplete?(a.rank-b.rank||a.unit.displayOrder-b.unit.displayOrder):(a.orderIndex-b.orderIndex||a.rank-b.rank||a.unit.displayOrder-b.unit.displayOrder));
  const deathIndexById = new Map(ordered.map((row,index)=>[row.unit.id,index]));
  const squadCount = ordered.length;

  const interim = selected.map(unit=>{
    const orderIndex = orderMap.get(unit.level);
    const rank = customInternalRank(unit, units);
    const deathIndex = deathIndexById.get(unit.id) ?? 0;
    const squadModifier = 1 + (squadCount - 1 - deathIndex) * separation;
    const adj = 0;
    const modifier = squadModifier;
    const capEach = unit[config.capacityEach];
    const effectiveEach=effectiveHealthEach(unit);
    const C = modifier * maxHealthEach / effectiveEach;
    const D = C * capEach;
    return {unit,rank,orderIndex,deathIndex,squadModifier,speciesAdjustment:adj,modifier,C,D,capEach,effectiveEach};
  });

  const sumD = interim.reduce((s,r)=>s+r.D,0);
  const results = interim.map(row=>{
    const rawQty = (row.D/sumD) * (capacityLimit/row.capEach) * fill;
    const roundTo = roundingMultiple(row.capEach, roundingTable);
    const qty = mroundPositive(rawQty, roundTo);
    const totalCapacity = row.capEach * qty;
    return {
      id:row.unit.id,category,displayOrder:row.unit.displayOrder,selectionKey:row.unit.selectionKey,
      level:row.unit.level,type:row.unit.type,name:row.unit.name,icon:row.unit.icon,
      qty,rawQty,roundTo,rank:row.rank,orderIndex:row.orderIndex,deathIndex:row.deathIndex,
      squadModifier:row.squadModifier,speciesAdjustment:row.speciesAdjustment,modifier:row.modifier,C:row.C,D:row.D,
      squadHealth:qty*row.effectiveEach,
      squadStrength:row.unit.strengthEach*qty,totalCapacity,capEach:row.capEach,unitStrengthEach:row.unit.strengthEach,effectiveEach:row.effectiveEach,physicalHealthEach:row.effectiveEach,unitEffectiveHealthEach:row.effectiveEach,
      nominalHealth:(row.D/sumD)*(capacityLimit/row.capEach)*row.effectiveEach
    };
  });

  if(inputs.minimumSeparation){
    const byId=new Map(results.map(r=>[r.id,r]));let prev=null;
    for(const entry of ordered){const row=byId.get(entry.unit.id);if(!row)continue;const each=row.qty>0?row.squadHealth/row.qty:0,step=Math.max(1,row.roundTo||1);
      if(prev&&each>0&&row.squadHealth>=prev.squadHealth){const q=Math.max(step,Math.floor((Math.ceil(prev.squadHealth/each)-1)/step)*step);if(q<row.qty){row.qty=q;row.totalCapacity=row.capEach*q;row.squadHealth=q*each;row.squadStrength=row.unitStrengthEach*q;}}
      prev=row;}
  }
  if(inputs.minimumSeparation&&capacityLimit>0){
    const targetCapacity=capacityLimit*Math.max(0,Math.min(1,Number(fill)||0));
    for(let pass=0;pass<5;pass++){
      const used=results.reduce((s,r)=>s+r.totalCapacity,0);if(!(used>0)||used>=targetCapacity*.9995)break;const scale=targetCapacity/used;
      for(const row of results){const step=Math.max(1,row.roundTo||1),q=Math.max(step,Math.floor((row.qty*scale)/step)*step);row.qty=q;row.totalCapacity=row.capEach*q;row.squadHealth=row.effectiveEach*q;row.squadStrength=row.unitStrengthEach*q;}
      const byId=new Map(results.map(r=>[r.id,r]));let prev=null;for(const entry of ordered){const row=byId.get(entry.unit.id);if(!row)continue;const each=row.effectiveEach,step=Math.max(1,row.roundTo||1);if(prev&&each>0&&row.squadHealth>=prev.squadHealth){const q=Math.max(step,Math.floor((Math.ceil(prev.squadHealth/each)-1)/step)*step);if(q<row.qty){row.qty=q;row.totalCapacity=row.capEach*q;row.squadHealth=q*each;row.squadStrength=row.unitStrengthEach*q;}}prev=row;}
    }
  }
  const customDeathIds=ordered.map(x=>x.unit.id);
  if(!inputs._skipHardCapacity){
    const requestedCapacity=capacityLimit*Math.max(0,Math.min(1,Number(fill)||0));
    enforceRequestedCapacity(results,requestedCapacity,customDeathIds);
  }
  const strictHealth=legalizePhysicalCategoryRows(results,customDeathIds,{minimumSeparation:Boolean(inputs.minimumSeparation),separation:Number(Number.isFinite(inputs.rankSeparation)?inputs.rankSeparation:inputs.layerSeparation)||0});
  const totalCapacity = results.reduce((s,r)=>s+r.totalCapacity,0);
  return {
    category,selectedCount:selected.length,maxHealthEach,sumD,capacityLimit,requestedFill:fill,
    totalCapacity,capacityPercent:capacityLimit?totalCapacity/capacityLimit:0,
    strictHealthAdjustments:strictHealth.adjustments,
    strictHealthUnresolved:strictHealth.unresolved,
    results:[...results].sort((a,b)=>a.displayOrder-b.displayOrder)
  };
}

export function calculateCustomStack({troops,monsters,mercenaries,selectedIds,orders,unitOrders=null,squadOrders=null,inputs,roundingTable}) {
  const flat=c=>squadOrders?.[c]?.length?squadOrders[c]:(orders[c]||[]).flatMap(l=>unitOrders?.[c]?.[l]||[]);
  const troop=calculateCustomCategory({category:'troop',units:troops,selectedIds:selectedIds.troop,inputs,order:orders.troop,unitOrder:flat('troop'),roundingTable});
  const monster=calculateCustomCategory({category:'monster',units:monsters,selectedIds:selectedIds.monster,inputs,order:orders.monster,unitOrder:flat('monster'),roundingTable});
  const mercenary=calculateCustomCategory({category:'mercenary',units:mercenaries,selectedIds:selectedIds.mercenary,inputs,order:orders.mercenary,unitOrder:flat('mercenary'),roundingTable});
  const categories={troop,monster,mercenary};
  const globalStrictHealth=enforceDistinctGlobalHealth(categories);
  for(const cat of [troop,monster,mercenary]){
    cat.totalCapacity=cat.results.reduce((s,r)=>s+Number(r.totalCapacity||0),0);
    cat.capacityPercent=cat.capacityLimit?cat.totalCapacity/cat.capacityLimit:0;
  }
  return {inputs:structuredClone(inputs),orders:structuredClone(orders),categories,
    strictHealthAdjustments:globalStrictHealth.adjustments,
    strictHealthUnresolved:globalStrictHealth.unresolved,
    totals:{leadership:troop.totalCapacity,dominance:monster.totalCapacity,authority:mercenary.totalCapacity}};
}
