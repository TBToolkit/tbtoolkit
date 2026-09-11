import {
  EPIC_MECHANICS_BUILD,
  BONUS_FAMILY_BY_SPECIES,
  assertLegalQuantity,
  bonusFamilyForSpecies,
  bonusProfileForUnit,
  clampProbability,
  deriveBonusInputs,
} from './epic-mechanics.mjs';
import { simulateInitiativeCase, simulateTwoInitiativeAverage, simulateOpeningCoinTossAverage } from './battle-simulator.mjs';

export {EPIC_COMBAT_ENGINE_BUILD} from './build-info.mjs';
export { EPIC_MECHANICS_BUILD, deriveBonusInputs, bonusFamilyForSpecies, bonusProfileForUnit };
export { simulateInitiativeCase, simulateTwoInitiativeAverage, simulateOpeningCoinTossAverage };
const TARGET_TYPES=Object.freeze(['FLYING','MOUNTED','MELEE','RANGED']);
const TARGETS=TARGET_TYPES; // backward-compatible export alias
const MATCHUP_KEY = Object.freeze({
  FLYING: 'flying', MOUNTED: 'mounted', MELEE: 'melee', RANGED: 'ranged',
});
function enemySquadsForBattle(bonusInputs){
 const counts={},squads=[];
 for(const type of bonusInputs.enemySquadTypes){
  counts[type]=(counts[type]||0)+1;
  squads.push({id:`${type}-${counts[type]}`,type,copy:counts[type]});
 }
 return squads;
}

/**
 * Prepare immutable data shared by repeated scores of the same army database
 * and bonus payload. Optimizer candidates change quantities, not this context.
 */
export function prepareEpicScoringContext({units,bonuses}){
  const resolvedBonuses=deriveBonusInputs(bonuses);
  const enemySquads=enemySquadsForBattle(resolvedBonuses);
  return{
    units,
    bonuses,
    resolvedBonuses,
    byId:new Map(units.map(unit=>[unit.id,unit])),
    byUnitId:new Map(units.map(unit=>[unit.unitId,unit])),
    byName:new Map(units.map(unit=>[unit.name,unit])),
    enemySquads,
    squadTemplates:new Map(units.map(unit=>[unit.id,prepareSquadTemplate(unit,resolvedBonuses,enemySquads)]))
  };
}

export function validateArmyDatabase(units) {
  if (!Array.isArray(units)) throw new Error('Army database must be an array.');
  const ids = new Set();
  const numericIds = new Set();
  const names = new Set();
  const errors = [];
  for (const u of units) {
    if (!u.id || ids.has(u.id)) errors.push(`Duplicate/missing stable id: ${u.id}`); else ids.add(u.id);
    if (!Number.isInteger(u.unitId) || numericIds.has(u.unitId)) errors.push(`Duplicate/invalid UNIT ID: ${u.unitId}`); else numericIds.add(u.unitId);
    if (!u.name || names.has(u.name)) errors.push(`Duplicate/missing unit name: ${u.name}`); else names.add(u.name);
    if (!['troop','monster','mercenary'].includes(u.category)) errors.push(`${u.id}: invalid category ${u.category}`);
    if (!['LEADERSHIP','DOMINANCE','AUTHORITY'].includes(u.capacityType)) errors.push(`${u.id}: invalid capacity type ${u.capacityType}`);
    for (const [k,v] of [['capacityCost',u.capacityCost],['baseStrength',u.baseStrength],['baseHealth',u.baseHealth],['goldRevivalCost',u.goldRevivalCost]]) {
      if (!(Number(v) >= 0)) errors.push(`${u.id}: invalid ${k}`);
    }
    try { bonusProfileForUnit(u); } catch (e) { errors.push(`${u.id}: ${e.message}`); }
  }
  return { valid: errors.length === 0, errors, count: units.length, stableIds: ids.size, unitIds: numericIds.size };
}

function prepareSquadTemplate(unit,bonusInputs,preparedEnemySquads=null){
  const familyName = bonusProfileForUnit(unit);
  const family = bonusInputs.profile[familyName];
  const intrinsicDD = Number(unit.bonuses?.doubleDamage ?? 0);
  const pDD = clampProbability(family.dd + intrinsicDD);
  const pST = clampProbability(family.st);

  const commonBonus = 1 + family.strength + bonusInputs.strengthAgainstEpic + Number(unit.bonuses?.epic ?? 0) + (bonusInputs.arachne ? Number(unit.bonuses?.arachne ?? 0) : 0);
  const targetDamages=(preparedEnemySquads??enemySquadsForBattle(bonusInputs)).map((enemy,targetOrder)=>{
    const matchup=Number(unit.bonuses?.[MATCHUP_KEY[enemy.type]]??0);
    return {target:enemy.type,targetId:enemy.id,targetCopy:enemy.copy,targetOrder,matchup,
      deterministicDamage:Number(unit.baseStrength)*(commonBonus+matchup)};
  }).sort((a,b)=>b.deterministicDamage-a.deterministicDamage||a.targetOrder-b.targetOrder);
  const first=targetDamages[0];
  const second=targetDamages.find(x=>x.targetId!==first.targetId);
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
    baseStrength: Number(unit.baseStrength),
    baseHealth: Number(unit.baseHealth),
    capacityCost: Number(unit.capacityCost),
    effectiveHealthEach:Number(unit.baseHealth)*(1+family.health),
    goldRevivalCostEach:Number(unit.goldRevivalCost),
    pDD,
    pST,
    firstStrikePerUnit:first,
    secondStrikePerUnit:second??null
  };
}

function buildSquadFromTemplate(template,quantity){
  const q=assertLegalQuantity(quantity,`${template.name} quantity`),first=template.firstStrikePerUnit,second=template.secondStrikePerUnit;
  const firstDamage=q*first.deterministicDamage,secondDamage=second?q*second.deterministicDamage:0;
  return{id:template.id,unitId:template.unitId,displayOrder:template.displayOrder,category:template.category,capacityType:template.capacityType,combatType:template.combatType,unitClass:template.unitClass,species:template.species,bonusFamily:template.bonusFamily,name:template.name,tier:template.tier,icon:template.icon,quantity:q,baseStrength:template.baseStrength,baseHealth:template.baseHealth,capacityCost:template.capacityCost,effectiveHealth:q*template.effectiveHealthEach,nominalSquadStrength:q*template.baseStrength,capacityUsed:q*template.capacityCost,rawGoldRevivalCost:q*template.goldRevivalCostEach,pDD:template.pDD,pST:template.pST,firstStrike:{target:first.target,targetId:first.targetId,deterministicDamage:firstDamage,matchup:first.matchup},secondStrike:second?{target:second.target,targetId:second.targetId,deterministicDamage:secondDamage,matchup:second.matchup}:null,expectedDamagePerOpportunity:(1+template.pDD)*(firstDamage+template.pST*secondDamage)};
}

export function buildSquad(unit, quantity, bonusInputs, preparedEnemySquads=null) {
  return buildSquadFromTemplate(prepareSquadTemplate(unit,bonusInputs,preparedEnemySquads),quantity);
}


function enforceDistinctSquadHealth(squads,byId,resolvedBonuses,preparedEnemySquads=null,preparedTemplates=null){
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
        squads[i]=preparedTemplates?.has(unit.id)?buildSquadFromTemplate(preparedTemplates.get(unit.id),nextQty):buildSquad(unit,nextQty,resolvedBonuses,preparedEnemySquads);
        adjustments++;changed=true;
      }else unresolved++;
    }
    if(!changed)break;
  }
  squads.sort((a,b)=>a.displayOrder-b.displayOrder);
  return{adjustments,unresolved};
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

export function scoreEpicArmy({ units, quantities, bonuses, goldRevivalMultiplier = 1, scoringContext = null, recordEvents = true }) {
  const prepared=scoringContext?.units===units&&scoringContext?.bonuses===bonuses?scoringContext:null;
  const resolvedBonuses = prepared?.resolvedBonuses??deriveBonusInputs(bonuses);
  const byId = prepared?.byId??new Map(units.map(u => [u.id,u]));
  const byUnitId = prepared?.byUnitId??new Map(units.map(u => [u.unitId,u]));
  const byName = prepared?.byName??new Map(units.map(u => [u.name,u]));
  const preparedEnemySquads=prepared?.enemySquads??enemySquadsForBattle(resolvedBonuses);
  const squads = [];

  for (const [key, quantity] of Object.entries(quantities)) {
    let unit = byId.get(key);
    if (!unit && /^\d+$/.test(key)) unit = byUnitId.get(Number(key));
    if (!unit) unit = byName.get(key);
    if (!unit) throw new Error(`Unknown unit quantity key: ${key}`);
    if (Number(quantity) > 0) squads.push(prepared?.squadTemplates?.has(unit.id)?buildSquadFromTemplate(prepared.squadTemplates.get(unit.id),Number(quantity)):buildSquad(unit, Number(quantity), resolvedBonuses,preparedEnemySquads));
  }

  const strictHealth=enforceDistinctSquadHealth(squads,byId,resolvedBonuses,preparedEnemySquads,prepared?.squadTemplates);
  const enemySquadCount=resolvedBonuses.enemySquadTypes.length;
  // Epic battles toss initiative for cycle 1, then the epic starts every later cycle.
  // Keep the old alternating model available only as an explicit offline control.
  const openingCoinToss=bonuses?.initiativeModel!=='alternating';
  const initiativeOptions={enemyStartsAfterOpening:openingCoinToss,recordEvents};
  const friendlyFirst=simulateInitiativeCase(squads,true,enemySquadCount,initiativeOptions);
  const epicFirst=simulateInitiativeCase(squads,false,enemySquadCount,initiativeOptions);
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
    initiativeModel:openingCoinToss?'opening-coin-toss':'alternating',
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
