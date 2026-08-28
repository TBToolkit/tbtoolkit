const SPECIES_GROUP = Object.freeze({
  BEAST: 'MONSTER',
  DRAGON: 'MONSTER',
  ELEMENTAL: 'MONSTER',
  GIANT: 'MONSTER',
  'EPIC HUNTER': 'EPIC_HUNTER',
  HUMAN: 'HUMAN',
  CURSED: 'HUMAN',
  DEMON: 'HUMAN',
  ELVES: 'HUMAN',
  UNDEAD: 'HUMAN',
  BARBARIAN: 'HUMAN',
});

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
export function mroundPositive(value, multiple = 1) {
  if (!Number.isFinite(value) || !Number.isFinite(multiple) || multiple <= 0) {
    throw new Error(`Invalid MROUND inputs: value=${value}, multiple=${multiple}`);
  }
  return Math.floor(value / multiple + 0.5 + Number.EPSILON) * multiple;
}

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

  const ranked = rankSelected(selected, inputs.arachne);
  const maxHealthEach = Math.max(...selected.map((u) => u.healthEach));
  const capacityLimit = inputs[config.capacityInput];
  const fill = inputs[config.fillInput];
  const rankSeparation = inputs.minimumSeparation ? 0 : inputs.rankSeparation;

  const interim = ranked.map(({ unit, pve, rank }) => {
    const adj = speciesAdjustment(unit.species, inputs.healthInputs);
    const pveModifier = (rank - 1) * rankSeparation;
    const modifier = 1 + pveModifier + adj;
    const capEach = unit[config.capacityEach];
    const C = (modifier * maxHealthEach) / unit.healthEach;
    const D = C * capEach;
    return { unit, pve, rank, speciesAdjustment: adj, pveModifier, modifier, C, D, capEach };
  });

  const sumD = interim.reduce((sum, row) => sum + row.D, 0);

  const results = interim.map((row) => {
    const rawQty = (row.D / sumD) * (capacityLimit / row.capEach) * fill;
    const roundTo = roundingMultiple(row.capEach, roundingTable);
    const qty = mroundPositive(rawQty, roundTo);
    const squadStrength = row.unit.strengthEach * qty;
    const totalCapacity = row.capEach * qty;
    const squadHealth = (qty * row.unit.healthEach) / (1 + row.speciesAdjustment);
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
      squadStrength,
      totalCapacity,unitCapacityEach:row.capEach,unitStrengthEach:row.unit.strengthEach,unitEffectiveHealthEach:squadHealth/Math.max(1,qty),
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
    results: displayResults,
  };
}

export function calculateEpicStack({ troops, monsters, mercenaries, selectedKeys = {}, selectedIds = {}, inputs, roundingTable }) {
  const troop = calculateCategory({
    category: 'troop',
    units: troops,
    selectedKeys: selectedKeys.troop,
    selectedIds: selectedIds.troop,
    inputs,
    roundingTable,
  });
  const monster = calculateCategory({
    category: 'monster',
    units: monsters,
    selectedKeys: selectedKeys.monster,
    selectedIds: selectedIds.monster,
    inputs,
    roundingTable,
  });
  const mercenary = calculateCategory({
    category: 'mercenary',
    units: mercenaries,
    selectedKeys: selectedKeys.mercenary,
    selectedIds: selectedIds.mercenary,
    inputs,
    roundingTable,
  });

  return {
    inputs: structuredClone(inputs),
    categories: { troop, monster, mercenary },
    totals: {
      leadership: troop.totalCapacity,
      dominance: monster.totalCapacity,
      authority: mercenary.totalCapacity,
    },
  };
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
  for (const unit of selected) if (!orderMap.has(unit.level)) throw new Error(`Add ${unit.level} to the ${category} die order.`);

  // Custom Order must use the same effective-health model as the battle
  // simulator. The previous relative species adjustment was only an
  // approximation and could invert manually ordered units from different
  // health families (for example Human vs Beast inside the same tier).
  const effectiveHealthEach = unit=>{
    const group=SPECIES_GROUP[unit.species];
    if(!group)throw new Error(`Unknown species: ${unit.species}`);
    const pct=Number(inputs.healthInputs?.[group]||0);
    return Number(unit.healthEach||0)*(1+pct/100);
  };
  const maxHealthEach = Math.max(...selected.map(effectiveHealthEach));
  const capacityLimit = inputs[config.capacityInput];
  const fill = inputs[config.fillInput];
  const separation = inputs.minimumSeparation ? 0 : (Number.isFinite(inputs.rankSeparation) ? inputs.rankSeparation : inputs.layerSeparation);

  // Custom Stacker uses the player's level order to define the death ladder.
  // Within each level, the existing matchup ranking remains automatic: weaker
  // matchup squads die earlier and stronger matchup squads die later. Squad
  // Separation is then applied between every adjacent squad in that full order,
  // matching the health-ladder concept used by Epic Stacker.
  const explicitRank=new Map((unitOrder||[]).map((id,index)=>[id,index]));
  const ordered = selected
    .map(unit=>({unit,orderIndex:orderMap.get(unit.level),rank:explicitRank.has(unit.id)?explicitRank.get(unit.id):customInternalRank(unit,units)}))
    .sort((a,b)=>a.orderIndex-b.orderIndex || a.rank-b.rank || a.unit.displayOrder-b.unit.displayOrder);
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
      squadStrength:row.unit.strengthEach*qty,totalCapacity,capEach:row.capEach,unitStrengthEach:row.unit.strengthEach,effectiveEach:row.effectiveEach,
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
  const totalCapacity = results.reduce((s,r)=>s+r.totalCapacity,0);
  return {
    category,selectedCount:selected.length,maxHealthEach,sumD,capacityLimit,requestedFill:fill,
    totalCapacity,capacityPercent:capacityLimit?totalCapacity/capacityLimit:0,
    results:[...results].sort((a,b)=>a.displayOrder-b.displayOrder)
  };
}

export function calculateCustomStack({troops,monsters,mercenaries,selectedIds,orders,unitOrders=null,inputs,roundingTable}) {
  const flat=c=>(orders[c]||[]).flatMap(l=>unitOrders?.[c]?.[l]||[]);
  const troop=calculateCustomCategory({category:'troop',units:troops,selectedIds:selectedIds.troop,inputs,order:orders.troop,unitOrder:flat('troop'),roundingTable});
  const monster=calculateCustomCategory({category:'monster',units:monsters,selectedIds:selectedIds.monster,inputs,order:orders.monster,unitOrder:flat('monster'),roundingTable});
  const mercenary=calculateCustomCategory({category:'mercenary',units:mercenaries,selectedIds:selectedIds.mercenary,inputs,order:orders.mercenary,unitOrder:flat('mercenary'),roundingTable});
  return {inputs:structuredClone(inputs),orders:structuredClone(orders),categories:{troop,monster,mercenary},
    totals:{leadership:troop.totalCapacity,dominance:monster.totalCapacity,authority:mercenary.totalCapacity}};
}
