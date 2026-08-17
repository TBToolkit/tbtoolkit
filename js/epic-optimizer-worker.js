/* TB Toolkit Epic Optimizer 1.2 Beta */
const EPIC_COMBAT_ENGINE_BUILD = '2.1-arachne8';
const TARGET_TYPES=Object.freeze(['FLYING','MOUNTED','MELEE','RANGED']);
const TARGETS=TARGET_TYPES; // backward-compatible export alias
function enemySquadsForBattle(arachne){
 const copies=arachne?2:1,squads=[];
 for(const type of TARGET_TYPES)for(let copy=1;copy<=copies;copy++)squads.push({id:`${type}-${copy}`,type,copy});
 return squads;
}

const BONUS_FAMILY_BY_SPECIES = Object.freeze({
  BEAST: 'MONSTER', DRAGON: 'MONSTER', GIANT: 'MONSTER', ELEMENTAL: 'MONSTER',
  HUMAN: 'HUMAN', CURSED: 'HUMAN', BARBARIAN: 'HUMAN', ELVES: 'HUMAN',
  DEMON: 'HUMAN', UNDEAD: 'HUMAN',
  'EPIC HUNTER': 'EPIC_HUNTER',
});

const MATCHUP_KEY = Object.freeze({
  FLYING: 'flying', MOUNTED: 'mounted', MELEE: 'melee', RANGED: 'ranged',
});

function finiteNumber(v, label) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a finite number.`);
  return n;
}

function pctPoints(v, label) {
  return finiteNumber(v, label) / 100;
}

function clampProbability(v) {
  return Math.max(0, Math.min(1, v));
}

function deriveBonusInputs(input) {
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
      monsterHealthPct, monsterStrengthPct, strengthAgainstEpicPct, monsterDDPct, monsterSTPct,
      ...resolved,
    },
  };
}

function bonusFamilyForSpecies(species) {
  const family = BONUS_FAMILY_BY_SPECIES[String(species ?? '').toUpperCase()];
  if (!family) throw new Error(`Unknown bonus-family species: ${species}`);
  return family;
}

function validateArmyDatabase(units) {
  if (!Array.isArray(units)) throw new Error('Army database must be an array.');
  const ids = new Set();
  const numericIds = new Set();
  const errors = [];
  for (const u of units) {
    if (!u.id || ids.has(u.id)) errors.push(`Duplicate/missing stable id: ${u.id}`); else ids.add(u.id);
    if (!Number.isInteger(u.unitId) || numericIds.has(u.unitId)) errors.push(`Duplicate/invalid UNIT ID: ${u.unitId}`); else numericIds.add(u.unitId);
    if (!['troop','monster','mercenary'].includes(u.category)) errors.push(`${u.id}: invalid category ${u.category}`);
    if (!['LEADERSHIP','DOMINANCE','AUTHORITY'].includes(u.capacityType)) errors.push(`${u.id}: invalid capacity type ${u.capacityType}`);
    for (const [k,v] of [['capacityCost',u.capacityCost],['baseStrength',u.baseStrength],['baseHealth',u.baseHealth],['goldRevivalCost',u.goldRevivalCost]]) {
      if (!(Number(v) >= 0)) errors.push(`${u.id}: invalid ${k}`);
    }
    try { bonusFamilyForSpecies(u.species); } catch (e) { errors.push(`${u.id}: ${e.message}`); }
  }
  return { valid: errors.length === 0, errors, count: units.length, stableIds: ids.size, unitIds: numericIds.size };
}

function buildSquad(unit, quantity, bonusInputs) {
  const q = finiteNumber(quantity, `${unit.name} quantity`);
  if (!Number.isInteger(q) || q < 0) throw new Error(`${unit.name} quantity must be a non-negative integer.`);
  const familyName = bonusFamilyForSpecies(unit.species);
  const family = bonusInputs.family[familyName];
  const intrinsicDD = Number(unit.bonuses?.doubleDamage ?? 0);
  const pDD = clampProbability(family.dd + intrinsicDD);
  const pST = clampProbability(family.st);

  const commonBonus = 1 + family.strength + bonusInputs.strengthAgainstEpic + Number(unit.bonuses?.epic ?? 0) + (bonusInputs.arachne ? Number(unit.bonuses?.arachne ?? 0) : 0);
  const targetDamages=enemySquadsForBattle(bonusInputs.arachne).map((enemy,targetOrder)=>{
    const matchup=Number(unit.bonuses?.[MATCHUP_KEY[enemy.type]]??0);
    return {target:enemy.type,targetId:enemy.id,targetCopy:enemy.copy,targetOrder,matchup,
      deterministicDamage:q*Number(unit.baseStrength)*(commonBonus+matchup)};
  }).sort((a,b)=>b.deterministicDamage-a.deterministicDamage||a.targetOrder-b.targetOrder);
  const first=targetDamages[0];
  const second=targetDamages.find(x=>x.targetId!==first.targetId);
  const expectedDamagePerOpportunity=(1+pDD)*(first.deterministicDamage+pST*second.deterministicDamage);

  return {
    id: unit.id,
    unitId: unit.unitId,
    displayOrder: unit.displayOrder,
    category: unit.category,
    capacityType: unit.capacityType,
    combatType: unit.combatType,
    unitClass: unit.unitClass,
    species: unit.species,
    bonusFamily: familyName,
    name: unit.name,
    tier: unit.tier,
    icon: unit.icon,
    quantity: q,
    baseStrength: Number(unit.baseStrength),
    baseHealth: Number(unit.baseHealth),
    capacityCost: Number(unit.capacityCost),
    effectiveHealth: q * Number(unit.baseHealth) * (1 + family.health),
    nominalSquadStrength: q * Number(unit.baseStrength),
    capacityUsed: q * Number(unit.capacityCost),
    rawGoldRevivalCost: q * Number(unit.goldRevivalCost),
    pDD,
    pST,
    firstStrike:{target:first.target,targetId:first.targetId,deterministicDamage:first.deterministicDamage,matchup:first.matchup},
    secondStrike:{target:second.target,targetId:second.targetId,deterministicDamage:second.deterministicDamage,matchup:second.matchup},
    expectedDamagePerOpportunity,
  };
}

function chooseFriendlyAttacker(squads, alive, attackedThisCycle) {
  let best = null;
  for (const s of squads) {
    if (!alive.has(s.id) || attackedThisCycle.has(s.id)) continue;
    if (!best || s.nominalSquadStrength > best.nominalSquadStrength ||
       (s.nominalSquadStrength === best.nominalSquadStrength && s.unitId < best.unitId)) best = s;
  }
  return best;
}

function chooseEnemyTarget(squads, alive) {
  let best = null;
  for (const s of squads) {
    if (!alive.has(s.id)) continue;
    if (!best || s.effectiveHealth > best.effectiveHealth ||
       (s.effectiveHealth === best.effectiveHealth && s.unitId < best.unitId)) best = s;
  }
  return best;
}

function simulateInitiativeCase(squads, friendlyStarts, enemySquadCount = 4) {
  const alive = new Set(squads.filter(s => s.quantity > 0).map(s => s.id));
  const attackOpportunities = Object.fromEntries(squads.map(s => [s.id, 0]));
  const lifetimeDamage = Object.fromEntries(squads.map(s => [s.id, 0]));
  const death = {};
  const events = [];
  let totalDamage = 0;
  let cycle = 1;
  let friendlyHasInitiative = Boolean(friendlyStarts);
  let deathPosition = 0;

  const friendlyAttack = (attackedThisCycle) => {
    const attacker = chooseFriendlyAttacker(squads, alive, attackedThisCycle);
    if (!attacker) return false;
    attackedThisCycle.add(attacker.id);
    attackOpportunities[attacker.id] += 1;
    lifetimeDamage[attacker.id] += attacker.expectedDamagePerOpportunity;
    totalDamage += attacker.expectedDamagePerOpportunity;
    events.push({ cycle, side: 'FRIENDLY', unitId: attacker.unitId, id: attacker.id, name: attacker.name, expectedDamage: attacker.expectedDamagePerOpportunity });
    return true;
  };

  const enemyAttack = () => {
    const target = chooseEnemyTarget(squads, alive);
    if (!target) return false;
    alive.delete(target.id);
    deathPosition += 1;
    death[target.id] = { cycle, position: deathPosition };
    events.push({ cycle, side: 'EPIC', killedUnitId: target.unitId, killedId: target.id, killedName: target.name, targetHealth: target.effectiveHealth });
    return true;
  };

  while (alive.size) {
    const attackedThisCycle = new Set();
    let enemyAttacks = 0;
    let friendlyTurn = friendlyHasInitiative;

    while (enemyAttacks < enemySquadCount && alive.size) {
      if (friendlyTurn) friendlyAttack(attackedThisCycle);
      else { enemyAttack(); enemyAttacks += 1; }
      friendlyTurn = !friendlyTurn;
    }

    while (alive.size && friendlyAttack(attackedThisCycle)) { /* exhaust surviving eligible squads */ }

    cycle += 1;
    friendlyHasInitiative = !friendlyHasInitiative;
    if (cycle > squads.length + 5) throw new Error('Simulation exceeded expected cycle bound.');
  }

  return {
    friendlyStarts: Boolean(friendlyStarts),
    totalDamage,
    cycles: cycle - 1,
    attackOpportunities,
    lifetimeDamage,
    death,
    events,
  };
}

function measuredHealthSeparations(squads) {
  const ordered = squads.filter(s => s.quantity > 0).slice().sort((a,b) => b.effectiveHealth - a.effectiveHealth || a.unitId - b.unitId);
  const rows = [];
  for (let i=0; i<ordered.length-1; i++) {
    const higher = ordered[i], lower = ordered[i+1];
    const separationPct = lower.effectiveHealth > 0 ? (higher.effectiveHealth / lower.effectiveHealth - 1) * 100 : Infinity;
    rows.push({ higherId: higher.id, higherName: higher.name, lowerId: lower.id, lowerName: lower.name, separationPct });
  }
  return rows;
}

function scoreEpicArmy({ units, quantities, bonuses, goldRevivalMultiplier = 1 }) {
  const resolvedBonuses = deriveBonusInputs(bonuses);
  const byId = new Map(units.map(u => [u.id,u]));
  const byUnitId = new Map(units.map(u => [u.unitId,u]));
  const byName = new Map(units.map(u => [u.name,u]));
  const squads = [];

  for (const [key, quantity] of Object.entries(quantities)) {
    let unit = byId.get(key);
    if (!unit && /^\d+$/.test(key)) unit = byUnitId.get(Number(key));
    if (!unit) unit = byName.get(key);
    if (!unit) throw new Error(`Unknown unit quantity key: ${key}`);
    if (Number(quantity) > 0) squads.push(buildSquad(unit, Number(quantity), resolvedBonuses));
  }

  const enemySquadCount=resolvedBonuses.arachne?8:4;
  const friendlyFirst=simulateInitiativeCase(squads,true,enemySquadCount);
  const epicFirst=simulateInitiativeCase(squads,false,enemySquadCount);
  const expectedTotalLifetimeDamage = (friendlyFirst.totalDamage + epicFirst.totalDamage) / 2;
  const capacities = { LEADERSHIP:0, DOMINANCE:0, AUTHORITY:0 };
  let rawGoldRevivalCost = 0;
  for (const s of squads) {
    capacities[s.capacityType] += s.capacityUsed;
    rawGoldRevivalCost += s.rawGoldRevivalCost;
  }
  const goldRevivalCost = rawGoldRevivalCost * Number(goldRevivalMultiplier);
  const separations = measuredHealthSeparations(squads);

  const squadResults = squads.map(s => ({
    ...s,
    friendlyFirstAttackOpportunities: friendlyFirst.attackOpportunities[s.id],
    epicFirstAttackOpportunities: epicFirst.attackOpportunities[s.id],
    averageAttackOpportunities: (friendlyFirst.attackOpportunities[s.id] + epicFirst.attackOpportunities[s.id]) / 2,
    expectedLifetimeDamage: (friendlyFirst.lifetimeDamage[s.id] + epicFirst.lifetimeDamage[s.id]) / 2,
    predictedDeathCycle: friendlyFirst.death[s.id]?.cycle ?? null,
    predictedDeathPosition: friendlyFirst.death[s.id]?.position ?? null,
  }));

  const sepValues = separations.map(s => s.separationPct).filter(Number.isFinite);
  const sortedSep = sepValues.slice().sort((a,b)=>a-b);
  const median = sortedSep.length ? (sortedSep.length % 2 ? sortedSep[(sortedSep.length-1)/2] : (sortedSep[sortedSep.length/2-1]+sortedSep[sortedSep.length/2])/2) : null;

  return {
    bonuses: resolvedBonuses,
    squads: squadResults,
    cases: { friendlyFirst, epicFirst },
    capacities,
    rawGoldRevivalCost,
    goldRevivalCost,
    expectedTotalLifetimeDamage,
    expectedDamagePerGold: goldRevivalCost > 0 ? expectedTotalLifetimeDamage / goldRevivalCost : null,
    healthSeparations: separations,
    separationSummary: {
      minPct: sortedSep.length ? sortedSep[0] : null,
      medianPct: median,
      maxPct: sortedSep.length ? sortedSep[sortedSep.length-1] : null,
    },
    predictedDyingOrder: squadResults.slice().sort((a,b)=>a.predictedDeathPosition-b.predictedDeathPosition).map(s=>s.id),
    nominalAttackOrder: squadResults.slice().sort((a,b)=>b.nominalSquadStrength-a.nominalSquadStrength || a.unitId-b.unitId).map(s=>s.id),
  };
}

{ TARGETS, BONUS_FAMILY_BY_SPECIES };


const EPIC_OPTIMIZER_CORE_BUILD = '1.1-search-core';
const CAPACITY_TYPES = Object.freeze(['LEADERSHIP','DOMINANCE','AUTHORITY']);

function finite(v, label) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${label} must be finite.`);
  return n;
}

function positiveInteger(v, label) {
  const n = Math.floor(finite(v, label));
  if (n < 0) throw new Error(`${label} must be >= 0.`);
  return n;
}

function pveSeedScore(unit) {
  const b = unit.bonuses ?? {};
  const core = [b.flying, b.mounted, b.melee, b.ranged].map(Number);
  if (unit.category === 'mercenary') core.push(Number(b.epic ?? 0));
  return Math.max(0, ...core.filter(Number.isFinite));
}

function capacityUsage(units, quantities) {
  const totals = { LEADERSHIP:0, DOMINANCE:0, AUTHORITY:0 };
  for (const u of units) {
    const q = Number(quantities[u.name] ?? quantities[u.id] ?? 0);
    if (q > 0) totals[u.capacityType] += q * Number(u.capacityCost);
  }
  return totals;
}

function normalizedLimits(limits) {
  const out = {};
  for (const type of CAPACITY_TYPES) out[type] = Math.max(0, Math.floor(Number(limits?.[type] ?? 0)));
  return out;
}

/**
 * Generic deterministic seed that intentionally resembles the legacy fixed-health-ladder
 * calculator, but is used only as a starting point for the new optimizer.
 * The optimizer objective remains expected lifetime damage from the discrete simulator.
 */
function createLegacyHealthLadderSeed({ units, selectedIds, selectedNames, bonuses, capacityLimits, separationPct = 0.10 }) {
  const selectedIdSet = new Set(selectedIds ?? []);
  const selectedNameSet = new Set(selectedNames ?? []);
  const selected = units.filter(u => selectedIdSet.size ? selectedIdSet.has(u.id) : selectedNameSet.has(u.name));
  if (!selected.length) return {};
  const resolved = deriveBonusInputs(bonuses);
  const limits = normalizedLimits(capacityLimits);
  const separation = Math.max(0, Number(separationPct)) / 100;
  const q = {};

  for (const capacityType of CAPACITY_TYPES) {
    const group = selected.filter(u => u.capacityType === capacityType);
    const limit = limits[capacityType];
    if (!group.length || limit <= 0) continue;

    const oneUnit = new Map(group.map(u => [u.id, buildSquad(u, 1, resolved)]));
    const maxHealthEach = Math.max(...group.map(u => oneUnit.get(u.id).effectiveHealth));
    const ranked = group.slice().sort((a,b) => pveSeedScore(b) - pveSeedScore(a) || a.displayOrder - b.displayOrder || a.unitId - b.unitId);
    const rows = ranked.map((u, index) => {
      const h = oneUnit.get(u.id).effectiveHealth;
      const C = ((1 + index * separation) * maxHealthEach) / h;
      const D = C * Number(u.capacityCost);
      return { u, D };
    });
    const sumD = rows.reduce((s,r) => s + r.D, 0);
    for (const {u,D} of rows) {
      const raw = (D / sumD) * (limit / Number(u.capacityCost));
      q[u.name] = Math.max(1, Math.round(raw));
    }
  }

  return repairCapacity({ units:selected, quantities:q, capacityLimits:limits, minimumQuantity:1 });
}

function repairCapacity({ units, quantities, capacityLimits, minimumQuantity = 1 }) {
  const limits = normalizedLimits(capacityLimits);
  const q = { ...quantities };
  for (const type of CAPACITY_TYPES) {
    const group = units.filter(u => u.capacityType === type);
    let used = capacityUsage(group, q)[type];
    if (used <= limits[type]) continue;
    // Reduce expensive units first only until the seed is feasible. The real optimizer will
    // subsequently decide where capacity should be reallocated.
    const donors = group.slice().sort((a,b) => b.capacityCost - a.capacityCost || a.unitId - b.unitId);
    while (used > limits[type]) {
      const u = donors.find(d => Number(q[d.name] ?? 0) > minimumQuantity);
      if (!u) throw new Error(`Unable to repair ${type} capacity without dropping a selected squad below ${minimumQuantity}.`);
      q[u.name] = Number(q[u.name] ?? 0) - 1;
      used -= Number(u.capacityCost);
    }
  }
  return q;
}

function candidateFeasible({ result, limits, minimumHealthSeparationPct }) {
  for (const type of CAPACITY_TYPES) if ((result.capacities[type] ?? 0) > limits[type]) return false;
  const minSep = result.separationSummary.minPct;
  if (minSep !== null && minSep + 1e-12 < minimumHealthSeparationPct) return false;
  return true;
}

function compareScore(a, b, epsilon = 1e-3) {
  return a > b + epsilon;
}

/**
 * Deterministic pairwise capacity-transfer optimizer.
 *
 * Search strategy:
 *  - start from a feasible legacy-style health-ladder seed (or caller seed);
 *  - for each capacity family, transfer progressively smaller capacity chunks between
 *    selected squads and also test one-sided reductions / slack-filling increases;
 *  - score every candidate with the full two-initiative discrete battle simulator;
 *  - accept only strictly higher expected lifetime damage and enforce the validated
 *    minimum effective-health separation on every accepted candidate.
 *
 * This is intentionally deterministic so regression results are reproducible.
 */
function optimizeFromSeed({
  units,
  selectedIds,
  selectedNames,
  bonuses,
  capacityLimits,
  initialQuantities = null,
  seedSeparationPct = 0.10,
  minimumHealthSeparationPct = 0.01,
  stageFractions = [0.05,0.02,0.01,0.005,0.002,0.001,0.0005,0.0002,0.0001],
  maxRoundsPerStage = 20,
  minimumQuantity = 1,
  onProgress = null,
}) {
  const selectedIdSet = new Set(selectedIds ?? []);
  const selectedNameSet = new Set(selectedNames ?? []);
  const selected = units.filter(u => selectedIdSet.size ? selectedIdSet.has(u.id) : selectedNameSet.has(u.name));
  if (!selected.length) throw new Error('At least one selected squad is required.');
  const limits = normalizedLimits(capacityLimits);

  let quantities = initialQuantities
    ? repairCapacity({ units:selected, quantities:initialQuantities, capacityLimits:limits, minimumQuantity })
    : createLegacyHealthLadderSeed({ units, selectedIds:selected.map(u=>u.id), bonuses, capacityLimits:limits, separationPct:seedSeparationPct });

  let result = scoreEpicArmy({ units, quantities, bonuses });
  if (!candidateFeasible({ result, limits, minimumHealthSeparationPct })) {
    throw new Error(`Initial optimizer seed is not feasible. min separation=${result.separationSummary.minPct}`);
  }
  const initialResult = result;
  let bestScore = result.expectedTotalLifetimeDamage;
  let evaluations = 1;
  const stages = [];
  if (typeof onProgress === 'function') {
    onProgress({
      phase:'seed',
      stageIndex:-1,
      stageCount:stageFractions.length,
      evaluations,
      expectedLifetimeDamage:result.expectedTotalLifetimeDamage,
      capacities:{...result.capacities},
      minHealthSeparationPct:result.separationSummary.minPct,
    });
  }

  const groups = CAPACITY_TYPES.map(type => ({ type, units:selected.filter(u => u.capacityType===type) })).filter(g => g.units.length && limits[g.type] > 0);

  for (const fraction of stageFractions) {
    let improved = true;
    let rounds = 0;
    let stageAccepted = 0;
    while (improved && rounds < maxRoundsPerStage) {
      improved = false;
      rounds += 1;
      let bestCandidate = null;
      let bestCandidateResult = null;
      let bestCandidateScore = bestScore;

      for (const group of groups) {
        const budgetChunk = Math.max(1, Math.round(limits[group.type] * Number(fraction)));

        // Pairwise transfers preserve most of the category budget while allowing the
        // simulator to discover better death/attack ordering.
        for (const receiver of group.units) {
          for (const donor of group.units) {
            if (receiver.id === donor.id) continue;
            const recvDelta = Math.max(1, Math.floor(budgetChunk / Number(receiver.capacityCost)));
            const donorDelta = Math.ceil((recvDelta * Number(receiver.capacityCost)) / Number(donor.capacityCost));
            const donorQty = Number(quantities[donor.name] ?? 0);
            if (donorQty - donorDelta < minimumQuantity) continue;
            const cand = {
              ...quantities,
              [receiver.name]: Number(quantities[receiver.name] ?? 0) + recvDelta,
              [donor.name]: donorQty - donorDelta,
            };
            const used = capacityUsage(group.units, cand)[group.type];
            if (used > limits[group.type]) continue;
            const candResult = scoreEpicArmy({ units, quantities:cand, bonuses });
            evaluations += 1;
            if (!candidateFeasible({ result:candResult, limits, minimumHealthSeparationPct })) continue;
            const candScore = candResult.expectedTotalLifetimeDamage;
            if (compareScore(candScore, bestCandidateScore)) {
              bestCandidateScore = candScore;
              bestCandidate = cand;
              bestCandidateResult = candResult;
            }
          }
        }

        // Test intentional under-fill and use any available slack. The specification
        // explicitly permits a slightly under-filled capacity when it yields more ELD.
        for (const u of group.units) {
          const delta = Math.max(1, Math.floor(budgetChunk / Number(u.capacityCost)));
          const current = Number(quantities[u.name] ?? 0);
          if (current - delta >= minimumQuantity) {
            const cand = { ...quantities, [u.name]: current - delta };
            const candResult = scoreEpicArmy({ units, quantities:cand, bonuses });
            evaluations += 1;
            if (candidateFeasible({ result:candResult, limits, minimumHealthSeparationPct }) && compareScore(candResult.expectedTotalLifetimeDamage, bestCandidateScore)) {
              bestCandidateScore = candResult.expectedTotalLifetimeDamage;
              bestCandidate = cand;
              bestCandidateResult = candResult;
            }
          }

          const currentUsage = capacityUsage(group.units, quantities)[group.type];
          const slack = limits[group.type] - currentUsage;
          const inc = Math.min(delta, Math.floor(slack / Number(u.capacityCost)));
          if (inc > 0) {
            const cand = { ...quantities, [u.name]: current + inc };
            const candResult = scoreEpicArmy({ units, quantities:cand, bonuses });
            evaluations += 1;
            if (candidateFeasible({ result:candResult, limits, minimumHealthSeparationPct }) && compareScore(candResult.expectedTotalLifetimeDamage, bestCandidateScore)) {
              bestCandidateScore = candResult.expectedTotalLifetimeDamage;
              bestCandidate = cand;
              bestCandidateResult = candResult;
            }
          }
        }
      }

      if (bestCandidate) {
        quantities = bestCandidate;
        result = bestCandidateResult;
        bestScore = bestCandidateScore;
        improved = true;
        stageAccepted += 1;
      }
    }

    stages.push({
      fraction:Number(fraction),
      rounds,
      acceptedMoves:stageAccepted,
      expectedLifetimeDamage:result.expectedTotalLifetimeDamage,
      capacities:{...result.capacities},
      minHealthSeparationPct:result.separationSummary.minPct,
    });
    if (typeof onProgress === 'function') {
      onProgress({
        phase:'stage',
        stageIndex:stages.length-1,
        stageCount:stageFractions.length,
        fraction:Number(fraction),
        rounds,
        acceptedMoves:stageAccepted,
        evaluations,
        expectedLifetimeDamage:result.expectedTotalLifetimeDamage,
        capacities:{...result.capacities},
        minHealthSeparationPct:result.separationSummary.minPct,
      });
    }
  }

  return {
    quantities,
    result,
    initialResult,
    diagnostics: {
      evaluations,
      stages,
      improvementPct: initialResult.expectedTotalLifetimeDamage > 0
        ? (result.expectedTotalLifetimeDamage / initialResult.expectedTotalLifetimeDamage - 1) * 100
        : null,
      minimumHealthSeparationPct,
    },
  };
}



const EPIC_OPTIMIZER_BUILD = '1.2-validation';

const SEED_CAPACITY_TYPES=['LEADERSHIP','DOMINANCE','AUTHORITY'];

function limitsOf(limits){
  return Object.fromEntries(SEED_CAPACITY_TYPES.map(t=>[t,Math.max(0,Math.floor(Number(limits?.[t]??0)))]));
}
function hashOrder(unitId,salt){
  let x=(Number(unitId)^Number(salt))>>>0;
  x=Math.imul(x^(x>>>16),0x45d9f3b);
  x=Math.imul(x^(x>>>16),0x45d9f3b);
  return (x^(x>>>16))>>>0;
}
function selectUnits(units,selectedIds,selectedNames){
  const ids=new Set(selectedIds??[]),names=new Set(selectedNames??[]);
  return units.filter(u=>ids.size?ids.has(u.id):names.has(u.name));
}
function makeEqualHealthSeed({units,selectedIds,selectedNames,bonuses,capacityLimits,salt=0,separationPct=.05,order='hash'}){
  const selected=selectUnits(units,selectedIds,selectedNames);
  const resolved=deriveBonusInputs(bonuses);
  const limits=limitsOf(capacityLimits);
  const q={};

  for(const type of SEED_CAPACITY_TYPES){
    let group=selected.filter(u=>u.capacityType===type);
    if(!group.length||limits[type]<=0)continue;
    group=group.slice().sort((a,b)=>{
      if(order==='forward')return (a.displayOrder??a.unitId)-(b.displayOrder??b.unitId)||a.unitId-b.unitId;
      if(order==='reverse')return (b.displayOrder??b.unitId)-(a.displayOrder??a.unitId)||b.unitId-a.unitId;
      return hashOrder(a.unitId,salt)-hashOrder(b.unitId,salt)||a.unitId-b.unitId;
    });

    const rows=group.map((u,index)=>({
      u,
      oneHealth:buildSquad(u,1,resolved).effectiveHealth,
      factor:1+index*(Number(separationPct)/100)
    }));
    const denom=rows.reduce((sum,r)=>sum+Number(r.u.capacityCost)*r.factor/r.oneHealth,0);
    const targetHealth=denom>0?limits[type]/denom:0;
    for(const r of rows){
      q[r.u.name]=Math.max(1,Math.round(targetHealth*r.factor/r.oneHealth));
    }
  }
  return repairCapacity({units:selected,quantities:q,capacityLimits:limits,minimumQuantity:1});
}
function seedFeasible({units,quantities,bonuses,capacityLimits,minimumHealthSeparationPct}){
  const result=scoreEpicArmy({units,quantities,bonuses});
  const limits=limitsOf(capacityLimits);
  for(const t of CAPACITY_TYPES)if((result.capacities[t]??0)>limits[t])return false;
  const min=result.separationSummary.minPct;
  return min===null||min+1e-12>=minimumHealthSeparationPct;
}

function optimizeEpicQuantities(args){
  const selected=selectUnits(args.units,args.selectedIds,args.selectedNames);
  if(!selected.length)throw new Error('At least one selected squad is required.');
  if(args.initialQuantities){
    return optimizeFromSeed(args);
  }

  // Two deterministic, approximately equal-effective-health starting points.
  // Neither uses PvE rank or a preselected optimal dying order.
  const seedSpecs=[
    {name:'equal-health-canonical',order:'forward',salt:0},
    {name:'equal-health-hash',order:'hash',salt:0x9e3779b9}
  ];
  const separationAttempts=[.03,.04,.05,.06,.08,.12,.16,.20,.30,.40];
  const minSep=Math.max(.01,Number(args.minimumHealthSeparationPct??.01));
  const seeds=[];

  for(const spec of seedSpecs){
    let found=null;
    for(const separationPct of separationAttempts){
      const quantities=makeEqualHealthSeed({...args,...spec,separationPct});
      if(seedFeasible({units:args.units,quantities,bonuses:args.bonuses,capacityLimits:args.capacityLimits,minimumHealthSeparationPct:minSep})){
        found={...spec,separationPct,quantities};
        break;
      }
    }
    if(found)seeds.push(found);
  }
  if(!seeds.length)throw new Error('Unable to construct a feasible equal-health optimizer seed.');

  let best=null;
  const seedDiagnostics=[];
  for(let i=0;i<seeds.length;i++){
    const seed=seeds[i];
    const result=optimizeFromSeed({
      ...args,
      initialQuantities:seed.quantities,
      onProgress:typeof args.onProgress==='function'
        ? p=>args.onProgress({...p,seedIndex:i,seedCount:seeds.length,seedName:seed.name})
        : null
    });
    seedDiagnostics.push({
      name:seed.name,
      separationPct:seed.separationPct,
      initialExpectedLifetimeDamage:result.initialResult.expectedTotalLifetimeDamage,
      finalExpectedLifetimeDamage:result.result.expectedTotalLifetimeDamage,
      evaluations:result.diagnostics.evaluations
    });
    if(!best||result.result.expectedTotalLifetimeDamage>best.result.expectedTotalLifetimeDamage+1e-3)best=result;
  }
  best.diagnostics.optimizerVersion='1.2-validation';
  best.diagnostics.seedStrategy='multi-seed-equal-effective-health';
  best.diagnostics.seeds=seedDiagnostics;
  best.diagnostics.totalEvaluations=seedDiagnostics.reduce((s,x)=>s+x.evaluations,0);
  return best;
}


let armyPromise=null;
async function loadArmy(){
 if(!armyPromise)armyPromise=fetch(new URL('../data/army-v2.json?v=70',self.location.href),{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error(`Unable to load canonical army database (${r.status}).`);return r.json();});
 return armyPromise;
}
self.onmessage=async(event)=>{
 const msg=event.data??{};if(msg.type!=='optimize')return;const requestId=msg.requestId;
 try{
  const army=await loadArmy();
  self.postMessage({type:'progress',requestId,payload:{phase:'loading',progressPct:2}});
  const result=optimizeEpicQuantities({
   units:army,selectedIds:msg.selectedIds,bonuses:msg.bonuses,capacityLimits:msg.capacityLimits,
   minimumHealthSeparationPct:.01,minimumQuantity:1,
   onProgress:(progress)=>{
    const sc=Math.max(1,Number(progress.seedCount??1)),si=Math.max(0,Number(progress.seedIndex??0));
    const st=Math.max(1,Number(progress.stageCount??1));
    const within=progress.phase==='seed'?.04:Math.min(.98,(Number(progress.stageIndex??0)+1)/st);
    const progressPct=Math.min(96,5+Math.round(((si+within)/sc)*91));
    self.postMessage({type:'progress',requestId,payload:{...progress,progressPct}});
   }
  });
  self.postMessage({type:'progress',requestId,payload:{phase:'finalizing',progressPct:98,evaluations:result?.diagnostics?.totalEvaluations??result?.diagnostics?.evaluations}});
  self.postMessage({type:'result',requestId,payload:result,diagnostics:{
   optimizerBuild:EPIC_OPTIMIZER_BUILD,engineBuild:EPIC_COMBAT_ENGINE_BUILD,armyDatabase:'ARMY9-v70',
   armyCount:army.length,seedStrategy:result?.diagnostics?.seedStrategy,totalEvaluations:result?.diagnostics?.totalEvaluations,
   inputPayload:msg.bonuses,capacityLimits:msg.capacityLimits
  }});
 }catch(error){self.postMessage({type:'error',requestId,message:error?.message||String(error),stack:error?.stack||''});}
};
