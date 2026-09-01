import {
  COMBAT_MECHANICS_BUILD,
  BONUS_FAMILY_BY_SPECIES,
  finiteNumber,
  pctPoints,
  clampProbability,
  bonusFamilyForSpecies,
  assertLegalQuantity,
} from './combat-mechanics.mjs?v=190-dev2';

export { COMBAT_MECHANICS_BUILD, BONUS_FAMILY_BY_SPECIES, finiteNumber, pctPoints, clampProbability, bonusFamilyForSpecies, assertLegalQuantity };

/**
 * Shared Epic battle mechanics primitives.
 *
 * This module intentionally contains only physical interpretation of player/unit
 * inputs. Strategy code (Standard ranking, Custom order, optimizer search) must
 * remain outside this file so all methods can share the same mechanics without
 * sharing the same strategy.
 */
export const EPIC_MECHANICS_BUILD = '191-dev1';

/**
 * Resolve the player-facing Epic health/strength/DD/ST inputs into the three
 * bonus families used by Total Battle combat calculations.
 */
export function deriveBonusInputs(input) {
  const monsterHealthPct = finiteNumber(input.monsterHealthPct, 'Monster Health %');
  const monsterStrengthPct = finiteNumber(input.monsterStrengthPct, 'Monster Strength %');
  const strengthAgainstEpicPct = finiteNumber(input.strengthAgainstEpicPct, 'Strength Against Epic %');
  const monsterDDPct = finiteNumber(input.monsterDDPct, 'Monster Double Damage %');
  const monsterSTPct = finiteNumber(input.monsterSTPct, 'Monster Strike Twice %');

  const defaults = {
    humanHealthPct: monsterHealthPct - 100,
    epicHunterHealthPct: monsterHealthPct - 741,
    humanStrengthPct: monsterStrengthPct - 100,
    epicHunterStrengthPct: monsterStrengthPct - 741,
    humanDDPct: monsterDDPct,
    epicHunterDDPct: monsterDDPct,
    humanSTPct: Math.max(0, monsterSTPct - 5),
    epicHunterSTPct: Math.max(0, monsterSTPct - 5),
  };
  const custom = input.customFamilyBonuses ?? {};
  const resolved = input.useCustomFamilyBonuses ? { ...defaults, ...custom } : defaults;

  const defaultEnemySquadTypes=input.arachne
    ?['FLYING','FLYING','MOUNTED','MOUNTED','MELEE','MELEE','RANGED','RANGED']
    :['FLYING','MOUNTED','MELEE','RANGED'];
  const enemySquadTypes=Array.isArray(input.enemySquadTypes)&&input.enemySquadTypes.length
    ?input.enemySquadTypes.map(type=>String(type).toUpperCase())
    :defaultEnemySquadTypes;
  if(enemySquadTypes.length<1||enemySquadTypes.length>8||enemySquadTypes.some(type=>!['FLYING','MOUNTED','MELEE','RANGED'].includes(type))){
    throw new Error('Epic enemy formation must contain 1–8 valid combat-type squads.');
  }

  return {
    family: {
      MONSTER: {
        health: pctPoints(monsterHealthPct, 'Monster Health %'),
        strength: pctPoints(monsterStrengthPct, 'Monster Strength %'),
        dd: clampProbability(pctPoints(monsterDDPct, 'Monster Double Damage %')),
        st: clampProbability(pctPoints(monsterSTPct, 'Monster Strike Twice %')),
      },
      HUMAN: {
        health: pctPoints(resolved.humanHealthPct, 'Human Health %'),
        strength: pctPoints(resolved.humanStrengthPct, 'Human Strength %'),
        dd: clampProbability(pctPoints(resolved.humanDDPct, 'Human Double Damage %')),
        st: clampProbability(pctPoints(resolved.humanSTPct, 'Human Strike Twice %')),
      },
      EPIC_HUNTER: {
        health: pctPoints(resolved.epicHunterHealthPct, 'Epic Hunter Health %'),
        strength: pctPoints(resolved.epicHunterStrengthPct, 'Epic Hunter Strength %'),
        dd: clampProbability(pctPoints(resolved.epicHunterDDPct, 'Epic Hunter Double Damage %')),
        st: clampProbability(pctPoints(resolved.epicHunterSTPct, 'Epic Hunter Strike Twice %')),
      },
    },
    strengthAgainstEpic: pctPoints(strengthAgainstEpicPct, 'Strength Against Epic %'),
    arachne: Boolean(input.arachne),
    enemySquadTypes,
    userFacing: {
      monsterHealthPct,
      monsterStrengthPct,
      strengthAgainstEpicPct,
      monsterDDPct,
      monsterSTPct,
      ...resolved,
    },
  };
}

/** Effective health of one unit using already-resolved family bonuses. */
export function effectiveHealthEachFromResolved(unit, resolvedBonuses) {
  const familyName = bonusFamilyForSpecies(unit.species);
  const family = resolvedBonuses?.family?.[familyName];
  if (!family) throw new Error(`Missing ${familyName} family bonuses.`);
  return finiteNumber(unit.baseHealth, `${unit.name ?? unit.id} base health`) * (1 + finiteNumber(family.health, `${familyName} health bonus`));
}

/**
 * Effective health of one unit from the percentage-point healthInputs shape
 * used by epic-engine.mjs: {MONSTER, HUMAN, EPIC_HUNTER}.
 */
export function effectiveHealthEachFromHealthInputs(unit, healthInputs) {
  const familyName = bonusFamilyForSpecies(unit.species);
  const pct = finiteNumber(healthInputs?.[familyName], `${familyName} Health %`);
  const base = Number(unit.baseHealth ?? unit.healthEach);
  return finiteNumber(base, `${unit.name ?? unit.id} base health`) * (1 + pct / 100);
}


/**
 * Recompute and legalize a deterministic Epic category using actual effective
 * health and legal integer quantities. Allocation strategy is intentionally
 * outside this function: callers may propose quantities however they want,
 * but every scored/displayed physical army must pass through this contract.
 *
 * deathOrderIds are ordered from earliest death (healthiest) to latest death.
 * For Minimum Separation, each later squad must have strictly lower health.
 * For Fixed Separation s, H_earlier >= H_later * (1+s) after integer rounding.
 */
export function legalizePhysicalCategoryRows(results, deathOrderIds, {
  minimumSeparation = true,
  separation = 0,
  minimumQuantity = 1,
} = {}) {
  const rows = Array.isArray(results) ? results : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = (deathOrderIds ?? []).map((id) => byId.get(id)).filter(Boolean);
  const fixedSeparation = minimumSeparation ? 0 : Math.max(0, finiteNumber(separation ?? 0, 'Squad Separation'));
  let adjustments = 0;
  let unresolved = 0;

  // First make the row representation physically authoritative.
  for (const row of rows) {
    const q = assertLegalQuantity(row.qty ?? 0, `${row.name ?? row.id} quantity`);
    const step = Math.max(1, assertLegalQuantity(row.roundTo ?? 1, `${row.name ?? row.id} roundTo`));
    if (q % step !== 0) throw new Error(`${row.name ?? row.id} quantity ${q} is not a legal multiple of ${step}.`);
    const each = finiteNumber(
      row.physicalHealthEach ?? row.effectiveEach ?? row.unitEffectiveHealthEach,
      `${row.name ?? row.id} effective health/unit`,
    );
    if (!(each > 0)) throw new Error(`${row.name ?? row.id} effective health/unit must be > 0.`);
    const capEach = finiteNumber(row.capEach ?? row.unitCapacityEach ?? 0, `${row.name ?? row.id} capacity/unit`);
    const strEach = finiteNumber(row.unitStrengthEach ?? 0, `${row.name ?? row.id} strength/unit`);
    row.physicalHealthEach = each;
    row.effectiveEach = each;
    row.unitEffectiveHealthEach = each;
    row.squadHealth = q * each;
    row.totalCapacity = q * capEach;
    row.squadStrength = q * strEach;
  }

  let prev = null;
  for (const row of ordered) {
    const qty = assertLegalQuantity(row.qty ?? 0, `${row.name ?? row.id} quantity`);
    if (qty <= 0) continue;
    const each = row.physicalHealthEach;
    const step = Math.max(1, Number(row.roundTo || 1));
    if (prev) {
      const prevHealth = Number(prev.squadHealth);
      // Fixed separation is interpreted on final physical health. For minimum
      // separation use a tiny strict threshold to avoid floating-point ties.
      const maxLaterHealth = fixedSeparation > 0
        ? prevHealth / (1 + fixedSeparation)
        : prevHealth - Math.max(1e-6, Math.abs(prevHealth) * 1e-10);
      const minQty = Math.max(step, Math.ceil(Number(minimumQuantity || 1) / step) * step);
      if (Number(row.squadHealth) > maxLaterHealth + 1e-9 ||
          (fixedSeparation === 0 && Number(row.squadHealth) >= maxLaterHealth)) {
        let maxQty = Math.floor((maxLaterHealth / each) / step) * step;
        while (maxQty >= minQty && maxQty * each > maxLaterHealth + 1e-9) maxQty -= step;
        if (fixedSeparation === 0) {
          while (maxQty >= minQty && maxQty * each >= prevHealth) maxQty -= step;
        }
        const nextQty = Math.max(minQty, Math.min(qty, maxQty));
        if (nextQty < qty) {
          row.qty = nextQty;
          row.squadHealth = nextQty * each;
          row.totalCapacity = nextQty * Number(row.capEach ?? row.unitCapacityEach ?? 0);
          row.squadStrength = nextQty * Number(row.unitStrengthEach ?? 0);
          adjustments++;
        }
      }
      const actualGapOk = fixedSeparation > 0
        ? prevHealth + 1e-9 >= Number(row.squadHealth) * (1 + fixedSeparation)
        : prevHealth > Number(row.squadHealth);
      if (!actualGapOk) unresolved++;
    }
    prev = row;
  }

  return { adjustments, unresolved, separation: fixedSeparation };
}
