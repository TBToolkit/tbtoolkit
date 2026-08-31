/**
 * Shared Epic battle mechanics primitives.
 *
 * This module intentionally contains only physical interpretation of player/unit
 * inputs. Strategy code (Standard ranking, Custom order, optimizer search) must
 * remain outside this file so all methods can share the same mechanics without
 * sharing the same strategy.
 */
export const EPIC_MECHANICS_BUILD = '189-dev1';

export const BONUS_FAMILY_BY_SPECIES = Object.freeze({
  BEAST: 'MONSTER',
  DRAGON: 'MONSTER',
  ELEMENTAL: 'MONSTER',
  GIANT: 'MONSTER',
  HUMAN: 'HUMAN',
  CURSED: 'HUMAN',
  DEMON: 'HUMAN',
  ELVES: 'HUMAN',
  UNDEAD: 'HUMAN',
  BARBARIAN: 'HUMAN',
  'EPIC HUNTER': 'EPIC_HUNTER',
});

export function finiteNumber(v, label) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a finite number.`);
  return n;
}

export function pctPoints(v, label) {
  return finiteNumber(v, label) / 100;
}

export function clampProbability(v) {
  return Math.max(0, Math.min(1, v));
}

export function bonusFamilyForSpecies(species) {
  const family = BONUS_FAMILY_BY_SPECIES[String(species ?? '').toUpperCase()];
  if (!family) throw new Error(`Unknown bonus-family species: ${species}`);
  return family;
}

export function assertLegalQuantity(quantity, label = 'Quantity') {
  const q = finiteNumber(quantity, label);
  if (!Number.isInteger(q) || q < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return q;
}

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
