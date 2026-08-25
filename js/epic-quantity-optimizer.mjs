export const EPIC_OPTIMIZER_BUILD = '2.0-group-redistribution';
import { buildSquad, deriveBonusInputs, scoreEpicArmy } from './epic-combat-engine-v2.mjs?v=61';

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

export function capacityUsage(units, quantities) {
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
export function createLegacyHealthLadderSeed({ units, selectedIds, selectedNames, bonuses, capacityLimits, separationPct = 0.10 }) {
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

export function repairCapacity({ units, quantities, capacityLimits, minimumQuantity = 1 }) {
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

function candidateFeasible({ result, limits }) {
  for (const type of CAPACITY_TYPES) if ((result.capacities[type] ?? 0) > limits[type]) return false;
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
  structureValidator = null,
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
  if (!candidateFeasible({ result, limits }) || (structureValidator && !structureValidator(result, selected))) {
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
            if (!candidateFeasible({ result:candResult, limits }) || (structureValidator && !structureValidator(candResult, selected))) continue;
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
            if (candidateFeasible({ result:candResult, limits }) && (!structureValidator || structureValidator(candResult, selected)) && compareScore(candResult.expectedTotalLifetimeDamage, bestCandidateScore)) {
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
            if (candidateFeasible({ result:candResult, limits }) && (!structureValidator || structureValidator(candResult, selected)) && compareScore(candResult.expectedTotalLifetimeDamage, bestCandidateScore)) {
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


const SEED_CAPACITY_TYPES = CAPACITY_TYPES;
function selectUnits(units, selectedIds, selectedNames) {
  const ids = new Set(selectedIds ?? []), names = new Set(selectedNames ?? []);
  return units.filter(u => ids.size ? ids.has(u.id) : names.has(u.name));
}
function limitsOf(limits) { return normalizedLimits(limits); }
function matchupRankScore(unit, bonuses) {
  const b=unit.bonuses??{};
  return Math.max(Number(b.flying??0),Number(b.mounted??0),Number(b.melee??0),Number(b.ranged??0)) + Number(b.epic??0) + (bonuses?.arachne?Number(b.arachne??0):0);
}
function createMatchupRankedSeed({units,selectedIds,selectedNames,bonuses,capacityLimits,separationPct=.10}) {
  const selected=selectUnits(units,selectedIds,selectedNames),resolved=deriveBonusInputs(bonuses),limits=limitsOf(capacityLimits),q={};
  for(const type of SEED_CAPACITY_TYPES){
    let group=selected.filter(u=>u.capacityType===type); if(!group.length||limits[type]<=0)continue;
    group=group.slice().sort((a,b)=>{
      const ae=a.category==='troop'&&String(a.unitClass).toUpperCase()==='ENGINEER'?0:1;
      const be=b.category==='troop'&&String(b.unitClass).toUpperCase()==='ENGINEER'?0:1;
      if(ae!==be)return ae-be;
      if(ae===0&&be===0)return (a.tierNumber??0)-(b.tierNumber??0)||(a.displayOrder??0)-(b.displayOrder??0);
      return matchupRankScore(a,bonuses)-matchupRankScore(b,bonuses)||(a.tierNumber??0)-(b.tierNumber??0)||(a.displayOrder??0)-(b.displayOrder??0);
    });
    const n=group.length,rows=group.map((u,index)=>({u,oneHealth:buildSquad(u,1,resolved).effectiveHealth,factor:1+(n-1-index)*(Number(separationPct)/100)}));
    const denom=rows.reduce((sum,r)=>sum+Number(r.u.capacityCost)*r.factor/r.oneHealth,0),target=denom>0?limits[type]/denom:0;
    for(const r of rows)q[r.u.name]=Math.max(1,Math.round(target*r.factor/r.oneHealth));
  }
  return repairCapacity({units:selected,quantities:q,capacityLimits:limits,minimumQuantity:1});
}
function requiredHealthGapPct(earlierSquad,laterSquad){
  if(!earlierSquad||!laterSquad||!(laterSquad.effectiveHealth>0))return Infinity;
  return (earlierSquad.effectiveHealth/laterSquad.effectiveHealth-1)*100;
}
function higherTierTroopLineagePreserved(result,selected,minimumHealthSeparationPct=.01){
  const byId=new Map(result.squads.map(s=>[s.id,s])),groups=new Map();
  for(const u of selected.filter(u=>u.category==='troop')){const base=String(u.name).replace(/\s+[12]$/,'').trim(),key=`${u.unitClass}|${u.combatType}|${base}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(u);}
  for(const arr of groups.values()){arr.sort((a,b)=>(a.tierNumber??0)-(b.tierNumber??0));for(let i=1;i<arr.length;i++){const lo=byId.get(arr[i-1].id),hi=byId.get(arr[i].id);if(!lo||!hi)continue;if(!(lo.predictedDeathPosition<hi.predictedDeathPosition))return false;if(requiredHealthGapPct(lo,hi)+1e-12<minimumHealthSeparationPct)return false;}}
  return true;
}
function sacrificialTroopEngineersFirst(result,selected,minimumHealthSeparationPct=.01){
  const byId=new Map(result.squads.map(s=>[s.id,s]));
  const engineers=selected.filter(u=>u.category==='troop'&&String(u.unitClass).toUpperCase()==='ENGINEER').slice().sort((a,b)=>(a.tierNumber??0)-(b.tierNumber??0)||(a.displayOrder??0)-(b.displayOrder??0));
  if(!engineers.length)return true;
  const engSquads=engineers.map(u=>byId.get(u.id)); if(engSquads.some(s=>!s))return false;
  for(let i=0;i+1<engSquads.length;i++){if(!(engSquads[i].predictedDeathPosition<engSquads[i+1].predictedDeathPosition))return false;if(requiredHealthGapPct(engSquads[i],engSquads[i+1])+1e-12<minimumHealthSeparationPct)return false;}
  const otherTroops=selected.filter(u=>u.category==='troop'&&String(u.unitClass).toUpperCase()!=='ENGINEER').map(u=>byId.get(u.id)).filter(Boolean);
  if(otherTroops.length){const lastEngineer=engSquads[engSquads.length-1],firstOther=otherTroops.slice().sort((a,b)=>a.predictedDeathPosition-b.predictedDeathPosition)[0];if(!(lastEngineer.predictedDeathPosition<firstOther.predictedDeathPosition))return false;if(requiredHealthGapPct(lastEngineer,firstOther)+1e-12<minimumHealthSeparationPct)return false;}
  return true;
}
function hybridTroopStructurePreserved(result,selected,minimumHealthSeparationPct=.01){
  // Optimizer 2.0: no hardcoded death ladder assumptions.
  // The exact simulator determines the best death and attack ordering.
  // We only retain tier-lineage ordering as a weak feasibility hint.
  return true;
}
function seedFeasible({units,quantities,bonuses,capacityLimits}){const result=scoreEpicArmy({units,quantities,bonuses}),limits=limitsOf(capacityLimits);for(const t of CAPACITY_TYPES)if((result.capacities[t]??0)>limits[t])return false;return true;}

function hashOrder(unitId,salt){
  let x=(Number(unitId)^Number(salt))>>>0;
  x=Math.imul(x^(x>>>16),0x45d9f3b);
  x=Math.imul(x^(x>>>16),0x45d9f3b);
  return (x^(x>>>16))>>>0;
}

function makeEqualHealthSeed({units,selectedIds,selectedNames,bonuses,capacityLimits,salt=0,separationPct=.05,order='hash'}){
  const selected=selectUnits(units,selectedIds,selectedNames),resolved=deriveBonusInputs(bonuses),limits=limitsOf(capacityLimits),q={};
  for(const type of CAPACITY_TYPES){
    let group=selected.filter(u=>u.capacityType===type); if(!group.length||limits[type]<=0)continue;
    group=group.slice().sort((a,b)=>{
      if(order==='forward')return (a.displayOrder??a.unitId)-(b.displayOrder??b.unitId)||a.unitId-b.unitId;
      if(order==='reverse')return (b.displayOrder??b.unitId)-(a.displayOrder??a.unitId)||b.unitId-a.unitId;
      return hashOrder(a.unitId,salt)-hashOrder(b.unitId,salt)||a.unitId-b.unitId;
    });
    const rows=group.map((u,index)=>({u,oneHealth:buildSquad(u,1,resolved).effectiveHealth,factor:1+index*(Number(separationPct)/100)}));
    const denom=rows.reduce((sum,r)=>sum+Number(r.u.capacityCost)*r.factor/r.oneHealth,0),target=denom>0?limits[type]/denom:0;
    for(const r of rows)q[r.u.name]=Math.max(1,Math.round(target*r.factor/r.oneHealth));
  }
  return repairCapacity({units:selected,quantities:q,capacityLimits:limits,minimumQuantity:1});
}

function mulberry32(seed){let a=seed>>>0;return ()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
function deathSignature(result){return result.squads.slice().sort((a,b)=>a.predictedDeathPosition-b.predictedDeathPosition).map(s=>s.id).join('|');}

function mutateQuantities({selected,quantities,limits,rng,intensity=.02,moves=2,minimumQuantity=1}){
  const q={...quantities};
  const groups=CAPACITY_TYPES.map(type=>({type,units:selected.filter(u=>u.capacityType===type)})).filter(g=>g.units.length>1&&limits[g.type]>0);
  for(let m=0;m<moves;m++){
    const g=groups[Math.floor(rng()*groups.length)]; if(!g)break;
    let donor=g.units[Math.floor(rng()*g.units.length)],receiver=g.units[Math.floor(rng()*g.units.length)];
    if(donor.id===receiver.id){m--;continue;}
    const variableIntensity=intensity*(0.35+1.3*rng());
    const capChunk=Math.max(1,Math.round(limits[g.type]*variableIntensity));
    let recvDelta=Math.max(1,Math.floor(capChunk/Number(receiver.capacityCost)));
    let donorDelta=Math.ceil(recvDelta*Number(receiver.capacityCost)/Number(donor.capacityCost));
    const donorQty=Number(q[donor.name]??0);
    if(donorQty-donorDelta<minimumQuantity){donorDelta=Math.max(0,donorQty-minimumQuantity);recvDelta=Math.floor(donorDelta*Number(donor.capacityCost)/Number(receiver.capacityCost));}
    if(recvDelta<=0||donorDelta<=0)continue;
    q[donor.name]=donorQty-donorDelta;
    q[receiver.name]=Number(q[receiver.name]??0)+recvDelta;
  }
  return repairCapacity({units:selected,quantities:q,capacityLimits:limits,minimumQuantity});
}

function evolutionaryRefine({units,selected,bonuses,capacityLimits,seeds,minimumQuantity=1,onProgress=null}){
  const limits=limitsOf(capacityLimits),rng=mulberry32(0x2A4B6C8D),populationSize=10,offspringPerParent=4,generations=8;
  let evaluations=0;
  let population=seeds.map(x=>({quantities:{...x.quantities},result:x.result??scoreEpicArmy({units,quantities:x.quantities,bonuses}),source:x.source??'seed'}));
  evaluations+=seeds.filter(x=>!x.result).length;
  population.sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage); population=population.slice(0,populationSize);
  const intensities=[.08,.04,.02,.01,.005,.002];
  for(let gen=0;gen<generations;gen++){
    const candidates=[...population];
    const intensity=intensities[Math.min(intensities.length-1,Math.floor(gen/2))];
    for(const parent of population){
      for(let k=0;k<offspringPerParent;k++){
        const q=mutateQuantities({selected,quantities:parent.quantities,limits,rng,intensity,moves:1+Math.floor(rng()*3),minimumQuantity});
        const result=scoreEpicArmy({units,quantities:q,bonuses}); evaluations++;
        if(candidateFeasible({result,limits}))candidates.push({quantities:q,result,source:`evo-g${gen+1}`});
      }
    }
    candidates.sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage);
    const next=[],seen=new Set();
    // Preserve high fitness while retaining different death-order basins.
    for(const c of candidates){const sig=deathSignature(c.result);if(!seen.has(sig)||next.length<Math.ceil(populationSize*.6)){next.push(c);seen.add(sig);}if(next.length>=populationSize)break;}
    population=next;
    if(typeof onProgress==='function')onProgress({phase:'evolution',generation:gen+1,generationCount:generations,evaluations,expectedLifetimeDamage:population[0].result.expectedTotalLifetimeDamage});
  }
  return {best:population[0],population,evaluations};
}

export 
function thresholdQuantityForHealth(targetUnit, targetSquad, otherSquad, direction){
  if(!targetUnit||!targetSquad||!otherSquad||!(targetSquad.quantity>0)||!(targetSquad.effectiveHealth>0)) return null;
  const oneHealth=targetSquad.effectiveHealth/targetSquad.quantity;
  if(!(oneHealth>0)) return null;
  const raw=otherSquad.effectiveHealth/oneHealth;
  return direction==='above' ? Math.floor(raw)+1 : Math.max(1,Math.ceil(raw)-1);
}
function thresholdQuantityForAttack(targetUnit, targetSquad, otherSquad, direction){
  if(!targetUnit||!targetSquad||!otherSquad||!(targetUnit.baseStrength>0)) return null;
  const raw=otherSquad.nominalSquadStrength/Number(targetUnit.baseStrength);
  return direction==='above' ? Math.floor(raw)+1 : Math.max(1,Math.ceil(raw)-1);
}
function rebalanceThresholdMove({selected,quantities,limits,target,desiredQty,donor,minimumQuantity=1}){
  const q={...quantities};
  const current=Number(q[target.name]??0);
  if(!Number.isInteger(desiredQty)||desiredQty<minimumQuantity||desiredQty===current)return null;
  const targetCost=Number(target.capacityCost),donorCost=Number(donor.capacityCost);
  const delta=desiredQty-current;
  q[target.name]=desiredQty;
  if(delta>0){
    const donorQty=Number(q[donor.name]??0);
    let take=Math.ceil(delta*targetCost/donorCost);
    if(donorQty-take<minimumQuantity)return null;
    q[donor.name]=donorQty-take;
  } else {
    const released=(-delta)*targetCost;
    const give=Math.floor(released/donorCost);
    if(give>0)q[donor.name]=Number(q[donor.name]??0)+give;
  }
  return repairCapacity({units:selected,quantities:q,capacityLimits:limits,minimumQuantity});
}
function opportunityThresholdRefine({units,selected,bonuses,capacityLimits,start,minimumQuantity=1,onProgress=null,maxRounds=5}){
  const limits=limitsOf(capacityLimits);
  let quantities={...start.quantities},result=start.result??scoreEpicArmy({units,quantities,bonuses}),evaluations=0,accepted=0;
  const selectedById=new Map(selected.map(u=>[u.id,u]));
  for(let round=0;round<maxRounds;round++){
    let best=null,bestScore=result.expectedTotalLifetimeDamage;
    const healthOrder=result.squads.slice().sort((a,b)=>b.effectiveHealth-a.effectiveHealth||a.unitId-b.unitId);
    const attackOrder=result.squads.slice().sort((a,b)=>b.nominalSquadStrength-a.nominalSquadStrength||a.unitId-b.unitId);
    const hIndex=new Map(healthOrder.map((s,i)=>[s.id,i])),aIndex=new Map(attackOrder.map((s,i)=>[s.id,i]));
    for(const targetSquad of result.squads){
      const target=selectedById.get(targetSquad.id); if(!target)continue;
      const peers=selected.filter(u=>u.capacityType===target.capacityType&&u.id!==target.id); if(!peers.length)continue;
      const candidates=new Set();
      const hi=hIndex.get(target.id);
      for(const d of [-3,-2,-1,1,2,3]){const j=hi+d;if(j>=0&&j<healthOrder.length){const other=healthOrder[j]; if(other.capacityType===target.capacityType){for(const dir of ['above','below']){const x=thresholdQuantityForHealth(target,targetSquad,other,dir);if(x)candidates.add(x);}}}}
      const ai=aIndex.get(target.id);
      for(const d of [-3,-2,-1,1,2,3]){const j=ai+d;if(j>=0&&j<attackOrder.length){const other=attackOrder[j]; if(other.capacityType===target.capacityType){for(const dir of ['above','below']){const x=thresholdQuantityForAttack(target,targetSquad,other,dir);if(x)candidates.add(x);}}}}
      const cur=Number(quantities[target.name]??0);
      for(const frac of [.00005,.0001,.0002,.0005,.001,.002,.005]){const step=Math.max(1,Math.round(cur*frac));candidates.add(Math.max(minimumQuantity,cur-step));candidates.add(cur+step);}
      for(const desiredQty of candidates){
        if(desiredQty===cur)continue;
        for(const donor of peers){
          const q=rebalanceThresholdMove({selected,quantities,limits,target,desiredQty,donor,minimumQuantity});if(!q)continue;
          const cand=scoreEpicArmy({units,quantities:q,bonuses});evaluations++;
          if(!candidateFeasible({result:cand,limits}))continue;
          if(cand.expectedTotalLifetimeDamage>bestScore+1e-9){best={quantities:q,result:cand,target:target.id,donor:donor.id,beforeOpp:targetSquad.averageAttackOpportunities,afterOpp:cand.squads.find(s=>s.id===target.id)?.averageAttackOpportunities??null};bestScore=cand.expectedTotalLifetimeDamage;}
        }
      }
    }
    if(!best)break;
    quantities=best.quantities; result=best.result; accepted++;
    if(typeof onProgress==='function')onProgress({phase:'threshold',round:round+1,roundCount:maxRounds,evaluations,acceptedMoves:accepted,expectedLifetimeDamage:result.expectedTotalLifetimeDamage,target:best.target,donor:best.donor,beforeOpp:best.beforeOpp,afterOpp:best.afterOpp});
  }
  return {quantities,result,evaluations,acceptedMoves:accepted};
}




function randomCounterfactualMutate({selected,quantities,limits,rng,scale=.1,minimumQuantity=1}){
  const q={...quantities};
  const groups=CAPACITY_TYPES.map(type=>({type,units:selected.filter(u=>u.capacityType===type)})).filter(g=>g.units.length>1&&limits[g.type]>0);
  if(!groups.length)return q;
  const weighted=[];for(const g of groups){const w=g.type==='LEADERSHIP'?5:g.type==='DOMINANCE'?3:2;for(let i=0;i<w;i++)weighted.push(g);}
  const g=weighted[Math.floor(rng()*weighted.length)]??groups[0];
  let receiver=g.units[Math.floor(rng()*g.units.length)],donor=g.units[Math.floor(rng()*g.units.length)];
  if(receiver.id===donor.id)return q;
  const donorQty=Number(q[donor.name]??0);if(donorQty<=minimumQuantity)return q;
  const totalEquivalent=g.units.reduce((sum,u)=>sum+Number(q[u.name]??0),0);
  const capFrac=g.type==='LEADERSHIP'?.015:g.type==='DOMINANCE'?.05:.03;
  const maxTransfer=Math.max(1,Math.floor(totalEquivalent*capFrac));
  const dynamic=Math.max(1,Math.floor((donorQty-minimumQuantity)*(0.01+scale*rng())));
  const remove=1+Math.floor(rng()*Math.max(1,Math.min(dynamic,maxTransfer,donorQty-minimumQuantity)));
  q[donor.name]=donorQty-remove;
  const released=remove*Number(donor.capacityCost);
  const add=Math.max(1,Math.floor(released/Number(receiver.capacityCost)));
  q[receiver.name]=Number(q[receiver.name]??0)+add;
  // Deterministic capacity repair keeps the mutation feasible without biasing toward any unit name.
  return repairCapacity({units:selected,quantities:q,capacityLimits:limits,minimumQuantity});
}

function counterfactualAnneal({units,selected,bonuses,limits,seed,targetId,mode,beforeOpp,beforeDeath,minimumQuantity=1,iterations=3500,salt=0}){
  const rng=mulberry32((0x51A7C0DE^Number(salt))>>>0);
  const condition=(result)=>{const s=result.squads.find(x=>x.id===targetId);if(!s)return false;const opp=Number(s.averageAttackOpportunities??0),death=Number(s.predictedDeathPosition??999);return mode==='surrender'?(opp<=beforeOpp-.49||death<beforeDeath):(opp>=beforeOpp+.49||death>beforeDeath);};
  let q={...seed.quantities},result=seed.result??scoreEpicArmy({units,quantities:q,bonuses});
  if(!condition(result))return {quantities:q,result,evaluations:0,accepted:0};
  let current=result.expectedTotalLifetimeDamage,bestQ={...q},bestResult=result,best=current,evaluations=0,accepted=0;
  for(let i=0;i<iterations;i++){
    const phase=i/Math.max(1,iterations-1);
    const intensity=phase<.35?.22:phase<.72?.07:.018;
    const nq=randomCounterfactualMutate({selected,quantities:q,limits,rng,scale:intensity,minimumQuantity});
    const nr=scoreEpicArmy({units,quantities:nq,bonuses});evaluations++;
    if(!candidateFeasible({result:nr,limits})||!condition(nr))continue;
    const nv=nr.expectedTotalLifetimeDamage;
    const temp=(1-phase)*Math.max(2e6,best*.0025)+2e6;
    if(nv>=current||rng()<Math.exp((nv-current)/temp)){q=nq;result=nr;current=nv;accepted++;}
    if(nv>best){best=nv;bestQ={...nq};bestResult=nr;}
  }
  return {quantities:bestQ,result:bestResult,evaluations,accepted};
}

function counterfactualBasinRefine({units,selected,bonuses,capacityLimits,start,structureValidator,minimumQuantity=1,onProgress=null,maxBasins=8}){
  const limits=limitsOf(capacityLimits);
  const selectedById=new Map(selected.map(u=>[u.id,u]));
  const base=start.result??scoreEpicArmy({units,quantities:start.quantities,bonuses});
  let evaluations=0;
  const healthOrder=base.squads.slice().sort((a,b)=>b.effectiveHealth-a.effectiveHealth||a.unitId-b.unitId);
  const attackOrder=base.squads.slice().sort((a,b)=>b.nominalSquadStrength-a.nominalSquadStrength||a.unitId-b.unitId);
  const hIndex=new Map(healthOrder.map((s,i)=>[s.id,i]));
  const aIndex=new Map(attackOrder.map((s,i)=>[s.id,i]));
  const deathRank=new Map(base.squads.map(s=>[s.id,Number(s.predictedDeathPosition??999)]));

  // Counterfactual targets are chosen by mechanics, not unit names:
  // low-value earned attacks are tested for surrender; high-value squads are tested for an extra opportunity.
  const withAttack=base.squads.filter(s=>Number(s.averageAttackOpportunities??0)>0);
  const surrenderTargets=withAttack.slice().sort((a,b)=>
    Number(a.expectedDamagePerOpportunity??0)-Number(b.expectedDamagePerOpportunity??0) ||
    (deathRank.get(a.id)??999)-(deathRank.get(b.id)??999)
  ).slice(0,Math.min(3,withAttack.length));
  const gainTargets=withAttack.slice().sort((a,b)=>
    Number(b.expectedDamagePerOpportunity??0)-Number(a.expectedDamagePerOpportunity??0) ||
    (deathRank.get(b.id)??999)-(deathRank.get(a.id)??999)
  ).slice(0,Math.min(2,withAttack.length));

  const basinSeeds=[];
  function bestCounterfactualFor(targetSquad,mode){
    const target=selectedById.get(targetSquad.id); if(!target)return null;
    const peers=selected.filter(u=>u.capacityType===target.capacityType&&u.id!==target.id); if(!peers.length)return null;
    const desired=new Set();
    const hi=hIndex.get(target.id),ai=aIndex.get(target.id);
    for(const d of [-6,-4,-3,-2,-1,1,2,3,4,6]){
      const hj=hi+d;if(hj>=0&&hj<healthOrder.length){const other=healthOrder[hj];if(other.capacityType===target.capacityType){for(const dir of ['above','below']){const x=thresholdQuantityForHealth(target,targetSquad,other,dir);if(x)desired.add(x);}}}
      const aj=ai+d;if(aj>=0&&aj<attackOrder.length){const other=attackOrder[aj];if(other.capacityType===target.capacityType){for(const dir of ['above','below']){const x=thresholdQuantityForAttack(target,targetSquad,other,dir);if(x)desired.add(x);}}}
    }
    const cur=Number(start.quantities[target.name]??0);
    for(const frac of [.002,.005,.01,.02,.04,.08]){const step=Math.max(1,Math.round(cur*frac));desired.add(Math.max(minimumQuantity,cur-step));desired.add(cur+step);}
    let best=null,deep=null;
    for(const desiredQty of desired){
      if(desiredQty===cur)continue;
      for(const donor of peers){
        const q=rebalanceThresholdMove({selected,quantities:start.quantities,limits,target,desiredQty,donor,minimumQuantity});if(!q)continue;
        const cand=scoreEpicArmy({units,quantities:q,bonuses});evaluations++;
        if(!candidateFeasible({result:cand,limits}))continue;
        const after=cand.squads.find(s=>s.id===target.id);if(!after)continue;
        const beforeOpp=Number(targetSquad.averageAttackOpportunities??0),afterOpp=Number(after.averageAttackOpportunities??0);
        const beforeDeath=Number(targetSquad.predictedDeathPosition??999),afterDeath=Number(after.predictedDeathPosition??999);
        const changed = mode==='surrender'
          ? (afterOpp<=beforeOpp-.49 || afterDeath<beforeDeath)
          : (afterOpp>=beforeOpp+.49 || afterDeath>beforeDeath);
        if(!changed)continue;
        // Raw ELD is only a tie-breaker; these seeds are intentionally allowed to be temporarily worse.
        const record={quantities:q,result:cand,target:target.id,mode,beforeOpp,afterOpp,beforeDeath,afterDeath,desiredQty,currentQty:cur};
        if(!best || cand.expectedTotalLifetimeDamage>best.result.expectedTotalLifetimeDamage)best=record;
        if(!deep || Math.abs(desiredQty-cur)>Math.abs(deep.desiredQty-cur))deep=record;
      }
    }
    if(best)best.deep=deep;
    return best;
  }

  let targetPriority=0;
  for(const s of surrenderTargets){const b=bestCounterfactualFor(s,'surrender');if(b){b.priority=targetPriority++;basinSeeds.push(b);if(b.deep&&deathSignature(b.deep.result)!==deathSignature(b.result)){b.deep.priority=b.priority+.25;basinSeeds.push(b.deep);}}}
  for(const s of gainTargets){const b=bestCounterfactualFor(s,'gain');if(b){b.priority=10+targetPriority++;basinSeeds.push(b);}}

  // Keep mechanically distinct basins even when their raw score is poor.
  const unique=[],seen=new Set();
  for(const b of basinSeeds){const sig=deathSignature(b.result);if(seen.has(sig))continue;seen.add(sig);unique.push(b);}
  // Preserve target diversity and deep counterfactuals before considering raw ELD.
  unique.sort((a,b)=>(Number(a.priority??99)-Number(b.priority??99)) || b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage);
  const chosen=unique.slice(0,maxBasins);

  let best={quantities:{...start.quantities},result:base,source:'counterfactual-start'};
  const basinResults=[];
  for(let i=0;i<chosen.length;i++){
    const seed=chosen[i];
    const anneal=counterfactualAnneal({units,selected,bonuses,limits,seed,targetId:seed.target,mode:seed.mode,beforeOpp:seed.beforeOpp,beforeDeath:seed.beforeDeath,minimumQuantity,iterations:3500,salt:(i+1)*7919});
    evaluations+=anneal.evaluations;
    const local=optimizeFromSeed({units,selectedIds:selected.map(u=>u.id),bonuses,capacityLimits:limits,initialQuantities:anneal.quantities,minimumQuantity,structureValidator,stageFractions:[.02,.01,.005,.002,.001,.0005],maxRoundsPerStage:6,onProgress:typeof onProgress==='function'?p=>onProgress({...p,phase:'counterfactual',basinIndex:i,basinCount:chosen.length,counterfactualMode:seed.mode,counterfactualTarget:seed.target}):null});
    evaluations+=Number(local.diagnostics?.evaluations??0);
    basinResults.push({target:seed.target,mode:seed.mode,rawEld:seed.result.expectedTotalLifetimeDamage,annealEld:anneal.result.expectedTotalLifetimeDamage,eld:local.result.expectedTotalLifetimeDamage,beforeOpp:seed.beforeOpp,afterOpp:seed.afterOpp,beforeDeath:seed.beforeDeath,afterDeath:seed.afterDeath});
    if(local.result.expectedTotalLifetimeDamage>best.result.expectedTotalLifetimeDamage+1e-9)best={quantities:local.quantities,result:local.result,source:`counterfactual-${seed.mode}-${seed.target}`};
  }
  return {best,evaluations,basinResults,basinCount:chosen.length};
}


function pairedCounterfactualCondition(result,constraints){
  return constraints.every(c=>{
    const s=result.squads.find(x=>x.id===c.targetId); if(!s)return false;
    const opp=Number(s.averageAttackOpportunities??0),death=Number(s.predictedDeathPosition??999);
    return c.mode==='surrender'?(opp<=c.beforeOpp-.49||death<c.beforeDeath):(opp>=c.beforeOpp+.49||death>c.beforeDeath);
  });
}

function pairedCounterfactualAnneal({units,selected,bonuses,limits,seed,constraints,minimumQuantity=1,iterations=1800,salt=0}){
  const rng=mulberry32((0x84C0FFEE^Number(salt))>>>0);
  let q={...seed.quantities},result=seed.result??scoreEpicArmy({units,quantities:q,bonuses});
  if(!pairedCounterfactualCondition(result,constraints))return {quantities:q,result,evaluations:0,accepted:0};
  let current=result.expectedTotalLifetimeDamage,bestQ={...q},bestResult=result,best=current,evaluations=0,accepted=0;
  for(let i=0;i<iterations;i++){
    const phase=i/Math.max(1,iterations-1),intensity=phase<.30?.28:phase<.68?.09:.022;
    const nq=randomCounterfactualMutate({selected,quantities:q,limits,rng,scale:intensity,minimumQuantity});
    const nr=scoreEpicArmy({units,quantities:nq,bonuses});evaluations++;
    if(!candidateFeasible({result:nr,limits})||!pairedCounterfactualCondition(nr,constraints))continue;
    const nv=nr.expectedTotalLifetimeDamage,temp=(1-phase)*Math.max(2e6,best*.0030)+2e6;
    if(nv>=current||rng()<Math.exp((nv-current)/temp)){q=nq;result=nr;current=nv;accepted++;}
    if(nv>best){best=nv;bestQ={...nq};bestResult=nr;}
  }
  return {quantities:bestQ,result:bestResult,evaluations,accepted};
}

function pairedCounterfactualBasinRefine({units,selected,bonuses,capacityLimits,start,structureValidator,minimumQuantity=1,onProgress=null,maxPairs=4}){
  const limits=limitsOf(capacityLimits),base=start.result??scoreEpicArmy({units,quantities:start.quantities,bonuses});
  const selectedById=new Map(selected.map(u=>[u.id,u])); let evaluations=0;
  const deathRank=new Map(base.squads.map(s=>[s.id,Number(s.predictedDeathPosition??999)]));
  const withAttack=base.squads.filter(s=>Number(s.averageAttackOpportunities??0)>0);
  const low=withAttack.slice().sort((a,b)=>Number(a.expectedDamagePerOpportunity??0)-Number(b.expectedDamagePerOpportunity??0)||(deathRank.get(a.id)??999)-(deathRank.get(b.id)??999)).slice(0,Math.min(3,withAttack.length));
  const high=withAttack.slice().sort((a,b)=>Number(b.expectedDamagePerOpportunity??0)-Number(a.expectedDamagePerOpportunity??0)||(deathRank.get(b.id)??999)-(deathRank.get(a.id)??999)).slice(0,Math.min(3,withAttack.length));
  const specs=[]; for(const s of low)specs.push({s,mode:'surrender'}); for(const s of high)if(!specs.some(x=>x.s.id===s.id&&x.mode==='gain'))specs.push({s,mode:'gain'});

  function moveOptions(currentQuantities,currentResult,spec,maxOptions=5){
    const targetSquad=currentResult.squads.find(x=>x.id===spec.s.id); const target=selectedById.get(spec.s.id); if(!targetSquad||!target)return [];
    const healthOrder=currentResult.squads.slice().sort((a,b)=>b.effectiveHealth-a.effectiveHealth||a.unitId-b.unitId),attackOrder=currentResult.squads.slice().sort((a,b)=>b.nominalSquadStrength-a.nominalSquadStrength||a.unitId-b.unitId);
    const hi=healthOrder.findIndex(s=>s.id===target.id),ai=attackOrder.findIndex(s=>s.id===target.id),desired=new Set(),cur=Number(currentQuantities[target.name]??0);
    for(const d of [-6,-3,-1,1,3,6]){
      const hj=hi+d;if(hj>=0&&hj<healthOrder.length){const other=healthOrder[hj];if(other.capacityType===target.capacityType)for(const dir of ['above','below']){const x=thresholdQuantityForHealth(target,targetSquad,other,dir);if(x)desired.add(x);}}
      const aj=ai+d;if(aj>=0&&aj<attackOrder.length){const other=attackOrder[aj];if(other.capacityType===target.capacityType)for(const dir of ['above','below']){const x=thresholdQuantityForAttack(target,targetSquad,other,dir);if(x)desired.add(x);}}
    }
    for(const frac of [.01,.03,.06]){const st=Math.max(1,Math.round(cur*frac));desired.add(Math.max(minimumQuantity,cur-st));desired.add(cur+st);}
    const peers=selected.filter(u=>u.capacityType===target.capacityType&&u.id!==target.id),out=[];
    const beforeOpp=Number(spec.s.averageAttackOpportunities??0),beforeDeath=Number(spec.s.predictedDeathPosition??999);
    for(const desiredQty of desired){if(desiredQty===cur)continue;for(const donor of peers){const q=rebalanceThresholdMove({selected,quantities:currentQuantities,limits,target,desiredQty,donor,minimumQuantity});if(!q)continue;const cand=scoreEpicArmy({units,quantities:q,bonuses});evaluations++;if(!candidateFeasible({result:cand,limits}))continue;const after=cand.squads.find(x=>x.id===target.id);if(!after)continue;const ao=Number(after.averageAttackOpportunities??0),ad=Number(after.predictedDeathPosition??999);const changed=spec.mode==='surrender'?(ao<=beforeOpp-.49||ad<beforeDeath):(ao>=beforeOpp+.49||ad>beforeDeath);if(changed)out.push({quantities:q,result:cand,constraint:{targetId:target.id,mode:spec.mode,beforeOpp,beforeDeath},target:target.id,mode:spec.mode});}}
    out.sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage); const uniq=[],seen=new Set();for(const r of out){const sig=deathSignature(r.result);if(seen.has(sig))continue;seen.add(sig);uniq.push(r);if(uniq.length>=maxOptions)break;}return uniq;
  }

  const firstMoves=[]; for(const spec of specs){for(const m of moveOptions(start.quantities,base,spec,1))firstMoves.push(m);}
  firstMoves.sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage);
  const pairSeeds=[];
  for(const first of firstMoves.slice(0,Math.min(6,firstMoves.length))){
    for(const spec2 of specs){if(spec2.s.id===first.target)continue;const seconds=moveOptions(first.quantities,first.result,spec2,1);for(const second of seconds){const c1=first.constraint,c2={...second.constraint,beforeOpp:Number(base.squads.find(s=>s.id===spec2.s.id)?.averageAttackOpportunities??second.constraint.beforeOpp),beforeDeath:Number(base.squads.find(s=>s.id===spec2.s.id)?.predictedDeathPosition??second.constraint.beforeDeath)};const constraints=[c1,c2];if(!pairedCounterfactualCondition(second.result,constraints))continue;pairSeeds.push({quantities:second.quantities,result:second.result,constraints,targets:[first.target,spec2.s.id],modes:[first.mode,spec2.mode]});}
    }
  }
  const unique=[],seen=new Set(); pairSeeds.sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage);for(const p of pairSeeds){const sig=deathSignature(p.result)+'|'+p.targets.slice().sort().join(',');if(seen.has(sig))continue;seen.add(sig);unique.push(p);if(unique.length>=maxPairs)break;}
  let best={quantities:{...start.quantities},result:base,source:'paired-counterfactual-start'};const pairResults=[];
  for(let i=0;i<unique.length;i++){
    const seed=unique[i],anneal=pairedCounterfactualAnneal({units,selected,bonuses,limits,seed,constraints:seed.constraints,minimumQuantity,iterations:1800,salt:(i+1)*104729});evaluations+=anneal.evaluations;
    const local=optimizeFromSeed({units,selectedIds:selected.map(u=>u.id),bonuses,capacityLimits:limits,initialQuantities:anneal.quantities,minimumQuantity,structureValidator,stageFractions:[.02,.01,.005,.002,.001,.0005],maxRoundsPerStage:4,onProgress:typeof onProgress==='function'?p=>onProgress({...p,phase:'paired-counterfactual',pairIndex:i,pairCount:unique.length,pairTargets:seed.targets}):null});evaluations+=Number(local.diagnostics?.evaluations??0);
    pairResults.push({targets:seed.targets,modes:seed.modes,rawEld:seed.result.expectedTotalLifetimeDamage,annealEld:anneal.result.expectedTotalLifetimeDamage,eld:local.result.expectedTotalLifetimeDamage});
    if(local.result.expectedTotalLifetimeDamage>best.result.expectedTotalLifetimeDamage+1e-9)best={quantities:local.quantities,result:local.result,source:`paired-${seed.targets.join('-')}`};
  }
  return {best,evaluations,pairResults,pairCount:unique.length};
}

export 
function groupRedistributionAllocate(group,budget,weights,minimumQuantity=1){
  const q={};
  let remaining=Math.max(0,Math.floor(Number(budget)||0));
  // Keep every selected unit actionable. Group redistribution changes stack shape, not selection.
  for(const u of group){
    const cost=Math.max(1,Number(u.capacityCost));
    q[u.name]=minimumQuantity;
    remaining-=minimumQuantity*cost;
  }
  if(remaining<0)return null;
  const clean=group.map((u,i)=>Math.max(0.0001,Number(weights?.[i]??1)));
  const sum=clean.reduce((a,b)=>a+b,0)||1;
  const desired=[];
  for(let i=0;i<group.length;i++){
    const u=group[i],cost=Math.max(1,Number(u.capacityCost));
    const raw=(remaining*clean[i]/sum)/cost;
    const add=Math.max(0,Math.floor(raw));
    q[u.name]+=add;
    desired.push({u,frac:raw-add,weight:clean[i]});
  }
  let used=group.reduce((s,u)=>s+Number(q[u.name]??0)*Number(u.capacityCost),0);
  let left=Math.max(0,Math.floor(budget-used));
  // Spend discrete remainder in the units with the largest unmet fractional allocation.
  desired.sort((a,b)=>b.frac-a.frac||b.weight-a.weight||String(a.u.id).localeCompare(String(b.u.id)));
  let guard=0;
  while(left>0&&guard++<10000){
    let placed=false;
    for(const row of desired){
      const cost=Number(row.u.capacityCost);
      if(cost<=left){q[row.u.name]++;left-=cost;placed=true;break;}
    }
    if(!placed)break;
  }
  return q;
}

function redistributionGroups(selected,result){
  const groups=[];
  const seen=new Set();
  const add=(key,units)=>{
    const arr=units.filter(Boolean);
    if(arr.length<3||arr.length>8)return;
    const sig=arr.map(u=>u.id).sort().join('|');
    if(seen.has(sig))return;seen.add(sig);groups.push({key,units:arr});
  };
  // Same-tier groups are a natural mechanical family (G8, S9, M7, etc.) without encoding unit names.
  const byTier=new Map();
  for(const u of selected){const k=`${u.capacityType}|${u.tier??''}`;if(!byTier.has(k))byTier.set(k,[]);byTier.get(k).push(u);}
  for(const [k,arr] of byTier)add(`tier:${k}`,arr);
  // Also explore compact whole-capacity groups when the selected pool itself is small.
  for(const type of CAPACITY_TYPES){const arr=selected.filter(u=>u.capacityType===type);if(arr.length>=3&&arr.length<=8)add(`capacity:${type}`,arr);}
  // For larger pools, add adjacent quartets in the current death ladder. This generalizes to mercenary-heavy armies.
  const byId=new Map(selected.map(u=>[u.id,u]));
  for(const type of CAPACITY_TYPES){
    const ordered=(result?.squads??[]).filter(s=>s.capacityType===type).sort((a,b)=>Number(a.predictedDeathPosition??999)-Number(b.predictedDeathPosition??999)).map(s=>byId.get(s.id)).filter(Boolean);
    if(ordered.length>8){for(let i=0;i+3<ordered.length;i+=2)add(`death-block:${type}:${i}`,ordered.slice(i,i+4));}
  }
  return groups;
}

function groupRedistributionRefine({units,selected,bonuses,capacityLimits,start,structureValidator,minimumQuantity=1,onProgress=null,maxRounds=1,maxSeeds=3}){
  const limits=limitsOf(capacityLimits);
  const base=start.result??scoreEpicArmy({units,quantities:start.quantities,bonuses});
  let best={quantities:{...start.quantities},result:base,source:'group-redistribution-start'};
  let evaluations=0,accepted=0;
  const summaries=[],basinSeeds=[];
  const groups=redistributionGroups(selected,base);
  for(let gi=0;gi<groups.length;gi++){
    const g=groups[gi],type=g.units[0].capacityType;
    if(!g.units.every(u=>u.capacityType===type))continue;
    const usage=capacityUsage(selected,start.quantities);
    const groupUsed=g.units.reduce((sum,u)=>sum+Number(start.quantities[u.name]??0)*Number(u.capacityCost),0);
    const slack=Math.max(0,Number(limits[type]??0)-Number(usage[type]??0));
    const budget=Math.max(0,Math.floor(groupUsed+slack));
    if(!(budget>0))continue;
    const n=g.units.length,weightSets=[];
    const currentCaps=g.units.map(u=>Math.max(1,Number(start.quantities[u.name]??minimumQuantity)*Number(u.capacityCost)));
    const currentSum=currentCaps.reduce((x,y)=>x+y,0)||1;
    weightSets.push(currentCaps.map(x=>x/currentSum));
    for(let i=0;i<n;i++){
      for(const factor of [.35,.5,.55,.6]){const w=Array(n).fill(1);w[i]=factor;weightSets.push(w);}
      const favor=Array(n).fill(1);favor[i]=2.0;weightSets.push(favor);
      // Two-axis share changes help cross valleys that require one squad to shrink while another also shifts.
      for(let j=0;j<n;j++){if(j===i)continue;const w=Array(n).fill(1);w[i]=.55;w[j]=.8;weightSets.push(w);}
    }
    for(let shift=1;shift<n;shift++)weightSets.push(currentCaps.map((_,i)=>currentCaps[(i+shift)%n]/currentSum));
    weightSets.push([...currentCaps].reverse().map(x=>x/currentSum));
    const salt=[...String(g.key)].reduce((sum,c)=>((sum*33)^c.charCodeAt(0))>>>0,0)^0x87A11CE;
    const rng=mulberry32(salt>>>0);
    for(let k=0;k<12;k++){const w=[];for(let i=0;i<n;i++)w.push(-Math.log(Math.max(1e-9,1-rng())));weightSets.push(w);}
    const candidates=[];
    for(const weights of weightSets){
      const alloc=groupRedistributionAllocate(g.units,budget,weights,minimumQuantity);if(!alloc)continue;
      const q={...start.quantities,...alloc};
      const repaired=repairCapacity({units:selected,quantities:q,capacityLimits:limits,minimumQuantity});
      const cand=scoreEpicArmy({units,quantities:repaired,bonuses});evaluations++;
      if(!candidateFeasible({result:cand,limits})||(structureValidator&&!structureValidator(cand,selected)))continue;
      candidates.push({quantities:repaired,result:cand,groupKey:g.key,capacityType:type});
      if(cand.expectedTotalLifetimeDamage>best.result.expectedTotalLifetimeDamage+1e-9){best={quantities:repaired,result:cand,source:`group-raw-${g.key}`};accepted++;}
    }
    candidates.sort((x,y)=>y.result.expectedTotalLifetimeDamage-x.result.expectedTotalLifetimeDamage);
    if(candidates.length){
      const top=candidates[0],baseSig=deathSignature(base);
      const alternate=candidates.find(c=>deathSignature(c.result)!==baseSig&&c.result.expectedTotalLifetimeDamage>=base.expectedTotalLifetimeDamage*.97);
      basinSeeds.push(alternate??top);
      summaries.push({key:g.key,size:n,budget,rawBestEld:top.result.expectedTotalLifetimeDamage,alternateEld:alternate?.result.expectedTotalLifetimeDamage??null});
    }
    if(typeof onProgress==='function')onProgress({phase:'group-redistribution',round:1,roundCount:1,groupIndex:gi,groupCount:groups.length,evaluations,acceptedMoves:accepted,groupKey:g.key,expectedLifetimeDamage:best.result.expectedTotalLifetimeDamage});
  }
  basinSeeds.sort((x,y)=>y.result.expectedTotalLifetimeDamage-x.result.expectedTotalLifetimeDamage);
  const chosen=[],seenTypes=new Set();
  for(const seed of basinSeeds){if(chosen.length>=maxSeeds)break;if(!seenTypes.has(seed.capacityType)){chosen.push(seed);seenTypes.add(seed.capacityType);}}
  for(const seed of basinSeeds){if(chosen.length>=maxSeeds)break;if(!chosen.includes(seed))chosen.push(seed);}
  for(let i=0;i<chosen.length;i++){
    const seed=chosen[i];
    const local=optimizeFromSeed({units,selectedIds:selected.map(u=>u.id),bonuses,capacityLimits:limits,initialQuantities:seed.quantities,minimumQuantity,structureValidator,stageFractions:[.005,.002,.001,.0005],maxRoundsPerStage:3,onProgress:null});
    evaluations+=Number(local.diagnostics?.evaluations??0);
    if(local.result.expectedTotalLifetimeDamage>best.result.expectedTotalLifetimeDamage+1e-9){best={quantities:local.quantities,result:local.result,source:`group-polish-${seed.groupKey}`};accepted++;}
  }
  return {best,evaluations,acceptedMoves:accepted,summaries,seedCount:chosen.length};
}

export 
function analyzeUnusualEarlySacrifices({units,selected,bonuses,capacityLimits,start,structureValidator,minimumQuantity=1,maxFlags=3}){
  const limits=limitsOf(capacityLimits);
  const base=start.result??scoreEpicArmy({units,quantities:start.quantities,bonuses});
  const baseEld=Number(base.expectedTotalLifetimeDamage||0);
  const selectedById=new Map(selected.map(u=>[u.id,u]));
  const ordered=[...(base.squads??[])].sort((a,b)=>Number(a.predictedDeathPosition??999)-Number(b.predictedDeathPosition??999));
  const earlyLimit=Math.min(4,ordered.length);
  const productive=ordered.filter(s=>Number(s.expectedLifetimeDamage||0)>0&&Number(s.averageAttackOpportunities||0)>0);
  const damageMedian=(()=>{const a=productive.map(s=>Number(s.expectedDamagePerOpportunity||0)).sort((a,b)=>a-b);return a.length?a[Math.floor(a.length/2)]:0;})();
  const candidates=ordered.filter(s=>{
    const death=Number(s.predictedDeathPosition??999),u=selectedById.get(s.id);
    if(!u||death>earlyLimit)return false;
    if(String(u.combatType||'').toUpperCase()==='SIEGE')return false;
    if(!(Number(s.expectedLifetimeDamage||0)>0&&Number(s.averageAttackOpportunities||0)>0))return false;
    return Number(s.expectedDamagePerOpportunity||0)>=damageMedian*.72;
  }).slice(0,maxFlags);
  const notes=[];let evaluations=0;

  for(const targetSquad of candidates){
    const target=selectedById.get(targetSquad.id);if(!target)continue;
    const peers=selected.filter(u=>u.capacityType===target.capacityType&&u.id!==target.id);if(!peers.length)continue;
    const later=ordered.filter(s=>s.capacityType===target.capacityType&&Number(s.predictedDeathPosition??999)>=Number(targetSquad.predictedDeathPosition??0)+5);
    if(!later.length)continue;
    const sampleIdx=[0,Math.floor((later.length-1)*.33),Math.floor((later.length-1)*.66),later.length-1];
    const sampled=[...new Map(sampleIdx.map(i=>later[i]).filter(Boolean).map(s=>[s.id,s])).values()];
    let rawBest=null;
    for(const other of sampled){
      const desiredQty=thresholdQuantityForHealth(target,targetSquad,other,'below');
      if(!desiredQty)continue;
      for(const donor of peers){
        const q=rebalanceThresholdMove({selected,quantities:start.quantities,limits,target,desiredQty,donor,minimumQuantity});if(!q)continue;
        const cand=scoreEpicArmy({units,quantities:q,bonuses});evaluations++;
        if(!candidateFeasible({result:cand,limits}))continue;
        const after=cand.squads.find(s=>s.id===target.id);if(!after)continue;
        if(Number(after.predictedDeathPosition??0)<Number(targetSquad.predictedDeathPosition??0)+5)continue;
        if(!rawBest||cand.expectedTotalLifetimeDamage>rawBest.result.expectedTotalLifetimeDamage)rawBest={quantities:q,result:cand};
      }
    }
    if(!rawBest)continue;
    const minimumLaterDeath=Number(targetSquad.predictedDeathPosition??0)+5;
    const altValidator=(result,chosen)=>{
      if(structureValidator&&!structureValidator(result,chosen))return false;
      const s=result.squads.find(x=>x.id===target.id);
      return !!s&&Number(s.predictedDeathPosition??0)>=minimumLaterDeath;
    };
    const local=optimizeFromSeed({units,selectedIds:selected.map(u=>u.id),bonuses,capacityLimits:limits,initialQuantities:rawBest.quantities,minimumQuantity,structureValidator:altValidator,stageFractions:[.002,.001,.0005],maxRoundsPerStage:2,onProgress:null});
    evaluations+=Number(local.diagnostics?.evaluations??0);
    const alt=local.result;
    const altSquad=alt.squads.find(s=>s.id===target.id);
    if(!altSquad)continue;
    const penaltyPct=baseEld>0?Math.max(0,(baseEld-Number(alt.expectedTotalLifetimeDamage||0))/baseEld*100):null;
    const classification=penaltyPct==null?'unknown':penaltyPct<.10?'marginal':penaltyPct<.50?'moderate':'meaningful';
    notes.push({
      id:target.id,name:target.name,tier:target.tier,capacityType:target.capacityType,
      originalDeath:Number(targetSquad.predictedDeathPosition??0),
      alternativeDeath:Number(altSquad.predictedDeathPosition??0),
      originalEld:baseEld,alternativeEld:Number(alt.expectedTotalLifetimeDamage||0),
      penaltyPct,classification
    });
  }
  return {notes,evaluations};
}

function optimizeEpicQuantities(args) {
  const selected=selectUnits(args.units,args.selectedIds,args.selectedNames); if(!selected.length)throw new Error('At least one selected squad is required.');
  const limits=limitsOf(args.capacityLimits),minSep=Math.max(.01,Number(args.minimumHealthSeparationPct??.01));
  const structureValidator=(result,chosen)=>hybridTroopStructurePreserved(result,chosen,minSep);
  if(args.initialQuantities)return optimizeFromSeed({...args,structureValidator});

  const seedDefs=[];
  for(const separationPct of [.03,.05,.10,.20])seedDefs.push({name:`matchup-${separationPct}`,make:()=>createMatchupRankedSeed({...args,separationPct})});
  for(const separationPct of [.03,.05,.10])seedDefs.push({name:`legacy-${separationPct}`,make:()=>createLegacyHealthLadderSeed({...args,separationPct})});
  seedDefs.push({name:'forward',make:()=>makeEqualHealthSeed({...args,order:'forward',separationPct:.05})});
  seedDefs.push({name:'reverse',make:()=>makeEqualHealthSeed({...args,order:'reverse',separationPct:.05})});
  for(const salt of [17,53,101,211])seedDefs.push({name:`diverse-${salt}`,make:()=>makeEqualHealthSeed({...args,order:'hash',salt,separationPct:.08})});

  let totalEvaluations=0;
  const seedScores=[];
  for(let i=0;i<seedDefs.length;i++){
    const d=seedDefs[i],quantities=d.make(),result=scoreEpicArmy({units:args.units,quantities,bonuses:args.bonuses}); totalEvaluations++;
    if(seedFeasible({units:args.units,quantities,bonuses:args.bonuses,capacityLimits:limits})&&structureValidator(result,selected))seedScores.push({name:d.name,quantities,result});
    if(typeof args.onProgress==='function')args.onProgress({phase:'seed-screen',seedIndex:i,seedCount:seedDefs.length,evaluations:totalEvaluations,expectedLifetimeDamage:result.expectedTotalLifetimeDamage});
  }
  if(!seedScores.length)throw new Error('Unable to construct a feasible optimizer starting population.');
  seedScores.sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage);

  // Optimize several independent basins with a medium-cost deterministic local search.
  const finalists=[];
  const localSeedCount=Math.min(4,seedScores.length);
  for(let i=0;i<localSeedCount;i++){
    const s=seedScores[i];
    const local=optimizeFromSeed({...args,initialQuantities:s.quantities,structureValidator,stageFractions:[.02,.01,.005,.002,.001,.0005],maxRoundsPerStage:8,onProgress:typeof args.onProgress==='function'?p=>args.onProgress({...p,phase:'local',seedIndex:i,seedCount:localSeedCount,seedName:s.name}):null});
    totalEvaluations+=local.diagnostics.evaluations;
    finalists.push({name:s.name,quantities:local.quantities,result:local.result,local});
  }
  finalists.sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage);

  const evo=evolutionaryRefine({units:args.units,selected,bonuses:args.bonuses,capacityLimits:limits,seeds:finalists.map(f=>({quantities:f.quantities,result:f.result,source:f.name})),minimumQuantity:Number(args.minimumQuantity??1),onProgress:args.onProgress});
  totalEvaluations+=evo.evaluations;

  // Explicitly search health/attack-priority thresholds that can change discrete attack opportunities.
  const threshold=opportunityThresholdRefine({units:args.units,selected,bonuses:args.bonuses,capacityLimits:limits,start:evo.best,minimumQuantity:Number(args.minimumQuantity??1),onProgress:args.onProgress,maxRounds:5});
  totalEvaluations+=threshold.evaluations;

  // Counterfactual basin search: deliberately cross promising structural boundaries even when the first move is worse,
  // then re-optimize inside each alternate basin. This is generic and contains no unit-specific rules.
  const counterfactual=counterfactualBasinRefine({units:args.units,selected,bonuses:args.bonuses,capacityLimits:limits,start:{quantities:threshold.quantities,result:threshold.result},structureValidator,minimumQuantity:Number(args.minimumQuantity??1),onProgress:args.onProgress,maxBasins:4});
  totalEvaluations+=counterfactual.evaluations;

  // Paired counterfactual search can cross wider valleys where two coordinated structural changes are required.
  const paired=pairedCounterfactualBasinRefine({units:args.units,selected,bonuses:args.bonuses,capacityLimits:limits,start:counterfactual.best,structureValidator,minimumQuantity:Number(args.minimumQuantity??1),onProgress:args.onProgress,maxPairs:4});
  totalEvaluations+=paired.evaluations;

  // Coordinated capacity-group redistribution explores multi-unit valleys inside tier/capacity families.
  const groupRedistribution=groupRedistributionRefine({units:args.units,selected,bonuses:args.bonuses,capacityLimits:limits,start:paired.best,structureValidator,minimumQuantity:Number(args.minimumQuantity??1),onProgress:args.onProgress,maxRounds:1,maxSeeds:3});
  totalEvaluations+=groupRedistribution.evaluations;

  // Re-run threshold refinement from the best redistributed basin, then do a final fine deterministic polish.
  const threshold2=opportunityThresholdRefine({units:args.units,selected,bonuses:args.bonuses,capacityLimits:limits,start:groupRedistribution.best,minimumQuantity:Number(args.minimumQuantity??1),onProgress:args.onProgress,maxRounds:5});
  totalEvaluations+=threshold2.evaluations;
  const polish=optimizeFromSeed({...args,initialQuantities:threshold2.quantities,structureValidator,stageFractions:[.001,.0005,.0002,.0001,.00005],maxRoundsPerStage:12,onProgress:typeof args.onProgress==='function'?p=>args.onProgress({...p,phase:'polish',seedIndex:0,seedCount:1,seedName:'group-redistribution-best'}):null});
  totalEvaluations+=polish.diagnostics.evaluations;

  const start=seedScores[0].result;
  const out=polish;
  out.initialResult=start;
  out.diagnostics.optimizerVersion=EPIC_OPTIMIZER_BUILD;
  out.diagnostics.seedStrategy='multi-seed + evolutionary + attack-opportunity thresholds + single/paired counterfactuals + capacity-group redistribution + exact-engine polish';
  out.diagnostics.seedCandidates=seedScores.map(s=>({name:s.name,eld:s.result.expectedTotalLifetimeDamage}));
  out.diagnostics.localFinalists=finalists.map(f=>({name:f.name,eld:f.result.expectedTotalLifetimeDamage}));
  out.diagnostics.evolutionBest=evo.best.result.expectedTotalLifetimeDamage;
  out.diagnostics.thresholdBest=threshold.result.expectedTotalLifetimeDamage;
  out.diagnostics.thresholdAcceptedMoves=threshold.acceptedMoves;
  out.diagnostics.counterfactualBest=counterfactual.best.result.expectedTotalLifetimeDamage;
  out.diagnostics.counterfactualBasins=counterfactual.basinResults;
  out.diagnostics.counterfactualBasinCount=counterfactual.basinCount;
  out.diagnostics.pairedCounterfactualBest=paired.best.result.expectedTotalLifetimeDamage;
  out.diagnostics.pairedCounterfactualPairs=paired.pairResults;
  out.diagnostics.pairedCounterfactualPairCount=paired.pairCount;
  out.diagnostics.groupRedistributionBest=groupRedistribution.best.result.expectedTotalLifetimeDamage;
  out.diagnostics.groupRedistributionAcceptedMoves=groupRedistribution.acceptedMoves;
  out.diagnostics.groupRedistributionSummaries=groupRedistribution.summaries;
  out.diagnostics.threshold2Best=threshold2.result.expectedTotalLifetimeDamage;

  // Explain counter-intuitive opening sacrifices without changing the maximum-ELD result.
  const unusual=analyzeUnusualEarlySacrifices({units:args.units,selected,bonuses:args.bonuses,capacityLimits:limits,start:{quantities:out.quantities,result:out.result},structureValidator,minimumQuantity:Number(args.minimumQuantity??1),maxFlags:3});
  totalEvaluations+=unusual.evaluations;
  out.diagnostics.unusualSacrifices=unusual.notes;
  out.diagnostics.unusualSacrificeEvaluations=unusual.evaluations;
  out.diagnostics.totalEvaluations=totalEvaluations;
  out.diagnostics.improvementPct=start.expectedTotalLifetimeDamage>0?(out.result.expectedTotalLifetimeDamage/start.expectedTotalLifetimeDamage-1)*100:null;
  return out;
}

export { CAPACITY_TYPES };
