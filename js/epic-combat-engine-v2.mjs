import {
  EPIC_MECHANICS_BUILD,
  BONUS_FAMILY_BY_SPECIES,
  assertLegalQuantity,
  bonusFamilyForSpecies,
  clampProbability,
  deriveBonusInputs,
} from './epic-mechanics.mjs?v=189-dev1';

export const EPIC_COMBAT_ENGINE_BUILD = '2.1-arachne8';
export { EPIC_MECHANICS_BUILD, deriveBonusInputs, bonusFamilyForSpecies };
const TARGET_TYPES=Object.freeze(['FLYING','MOUNTED','MELEE','RANGED']);
const TARGETS=TARGET_TYPES; // backward-compatible export alias
const MATCHUP_KEY = Object.freeze({
  FLYING: 'flying', MOUNTED: 'mounted', MELEE: 'melee', RANGED: 'ranged',
});
function enemySquadsForBattle(arachne){
 const copies=arachne?2:1,squads=[];
 for(const type of TARGET_TYPES)for(let copy=1;copy<=copies;copy++)squads.push({id:`${type}-${copy}`,type,copy});
 return squads;
}

export function validateArmyDatabase(units) {
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

export function buildSquad(unit, quantity, bonusInputs) {
  const q = assertLegalQuantity(quantity, `${unit.name} quantity`);
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


function enforceDistinctSquadHealth(squads,byId,resolvedBonuses){
  let adjustments=0,unresolved=0;
  for(let pass=0;pass<Math.max(2,squads.length);pass++){
    squads.sort((a,b)=>b.effectiveHealth-a.effectiveHealth||a.unitId-b.unitId);
    let changed=false;
    for(let i=1;i<squads.length;i++){
      const prev=squads[i-1],row=squads[i];
      if(row.quantity<=0)continue;
      // Treat numerically indistinguishable health as a tie so the optimizer
      // never relies on an implementation-specific tie-break.
      const strictThreshold=prev.effectiveHealth-Math.max(1e-6,Math.abs(prev.effectiveHealth)*1e-10);
      if(row.effectiveHealth<strictThreshold)continue;
      const unit=byId.get(row.id);
      if(!unit)continue;
      const perUnit=row.effectiveHealth/Math.max(1,row.quantity);
      let maxQty=Math.floor(strictThreshold/perUnit);
      while(maxQty>=1&&maxQty*perUnit>=strictThreshold)maxQty--;
      const nextQty=Math.max(1,Math.min(row.quantity,maxQty));
      if(nextQty<row.quantity){
        squads[i]=buildSquad(unit,nextQty,resolvedBonuses);
        adjustments++;changed=true;
      }else unresolved++;
    }
    if(!changed)break;
  }
  squads.sort((a,b)=>a.displayOrder-b.displayOrder);
  return{adjustments,unresolved};
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

export function simulateInitiativeCase(squads, friendlyStarts, enemySquadCount = 4) {
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

export function measuredHealthSeparations(squads) {
  const ordered = squads.filter(s => s.quantity > 0).slice().sort((a,b) => b.effectiveHealth - a.effectiveHealth || a.unitId - b.unitId);
  const rows = [];
  for (let i=0; i<ordered.length-1; i++) {
    const higher = ordered[i], lower = ordered[i+1];
    const separationPct = lower.effectiveHealth > 0 ? (higher.effectiveHealth / lower.effectiveHealth - 1) * 100 : Infinity;
    rows.push({ higherId: higher.id, higherName: higher.name, lowerId: lower.id, lowerName: lower.name, separationPct });
  }
  return rows;
}

export function scoreEpicArmy({ units, quantities, bonuses, goldRevivalMultiplier = 1 }) {
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

  const strictHealth=enforceDistinctSquadHealth(squads,byId,resolvedBonuses);
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
    strictHealthAdjustments:strictHealth.adjustments,
    strictHealthUnresolved:strictHealth.unresolved,
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

export { TARGETS, BONUS_FAMILY_BY_SPECIES };
