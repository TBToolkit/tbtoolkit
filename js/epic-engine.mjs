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

function selectedUnits(units, selectedKeys) {
  const selected = new Set(selectedKeys ?? []);
  return units.filter((u) => selected.has(u.selectionKey));
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

  const selected = selectedUnits(units, selectedKeys);
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
  const rankSeparation = inputs.rankSeparation;

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
      totalCapacity,
      nominalHealth,
    };
  });

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

export function calculateEpicStack({ troops, monsters, mercenaries, selectedKeys, inputs, roundingTable }) {
  const troop = calculateCategory({
    category: 'troop',
    units: troops,
    selectedKeys: selectedKeys.troop,
    inputs,
    roundingTable,
  });
  const monster = calculateCategory({
    category: 'monster',
    units: monsters,
    selectedKeys: selectedKeys.monster,
    inputs,
    roundingTable,
  });
  const mercenary = calculateCategory({
    category: 'mercenary',
    units: mercenaries,
    selectedKeys: selectedKeys.mercenary,
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
