import {
  COMBAT_MECHANICS_BUILD,
  mroundPositive,
  finiteNumber,
  clampProbability,
  bonusFamilyForSpecies,
  squadRevivalCosts,
} from './combat-mechanics.mjs?v=191';
import { BATTLE_SIMULATOR_BUILD, simulateTwoInitiativeAverage } from './battle-simulator.mjs?v=191';

export const PVP_ENGINE_BUILD='191';
export { COMBAT_MECHANICS_BUILD, BATTLE_SIMULATOR_BUILD };

const CATEGORY_CONFIG=Object.freeze({
  troop:{capacityInput:'leadership',fillInput:'leadershipFill',capacityEach:'leadershipEach'},
  monster:{capacityInput:'dominance',fillInput:'dominanceFill',capacityEach:'dominanceEach'},
  mercenary:{capacityInput:'authority',fillInput:'authorityFill',capacityEach:'authorityEach'}
});

function selectedUnits(units,ids){
  const s=new Set(ids??[]);
  return units.filter(u=>s.has(u.id));
}
function specialist(u){
  return String(u.class||'').toUpperCase()==='SPECIALIST';
}
function familyKey(u){
  const family=bonusFamilyForSpecies(u.species);
  return family==='EPIC_HUNTER'?'epicHunter':family.toLowerCase();
}
function familyStrengthPct(u,i){
  const k=familyKey(u);
  return Number(i[`${k}StrengthPct`]??0);
}
function familyHealthPct(u,i){
  const k=familyKey(u);
  if(k==='monster')return Number(i.healthInputs?.MONSTER??0);
  if(k==='human')return Number(i.healthInputs?.HUMAN??0);
  return Number(i.healthInputs?.EPIC_HUNTER??0);
}
function pvpEffectiveHealthEach(u,i){
  return finiteNumber(u.healthEach,`${u.name||u.id} base health`)*(1+finiteNumber(familyHealthPct(u,i),`${u.name||u.id} health bonus`)/100);
}
function familyDdPct(u,i){
  const k=familyKey(u);
  return Number(i[`${k}DDPct`]??0);
}
function familyStPct(u,i){
  const k=familyKey(u);
  return Number(i[`${k}STPct`]??0);
}
function bonusValue(u,key){
  return Number(u.bonuses?.[String(key||'').toLowerCase()]??0);
}
function pvpMatchupBonus(u,enemy){
  if(!enemy)return 0;
  // PvP bonuses stack just like Epic bonuses. A Human Flying target, for
  // example, receives both VS HUMAN and VS FLYING when the attacker has them.
  const combat=bonusValue(u,enemy.type);
  const species=bonusValue(u,enemy.species);
  return combat+species;
}
function singlePvpDamageProfile(u,i,enemy){
  const strengthBonus=familyStrengthPct(u,i)/100;
  const matchup=pvpMatchupBonus(u,enemy);
  const specialistMultiplier=specialist(u)?2:1;
  const intrinsicDd=Number(u.bonuses?.doubleDamage??0);
  const pDD=clampProbability(familyDdPct(u,i)/100+intrinsicDd);
  const pST=clampProbability(familyStPct(u,i)/100);
  const deterministicEach=Number(u.strengthEach||0)*(1+strengthBonus+matchup)*specialistMultiplier;
  const expectedEach=deterministicEach*(1+pDD)*(1+pST);
  return{strengthBonus,matchup,specialistMultiplier,pDD,pST,deterministicEach,expectedEach};
}
export function pvpDamageProfile(u,i,enemy){
  const archetypes=Array.isArray(enemy?.archetypes)?enemy.archetypes.filter(Boolean):[];
  if(!archetypes.length)return singlePvpDamageProfile(u,i,enemy);
  const profiles=archetypes.map(target=>singlePvpDamageProfile(u,i,target));
  const base=profiles[0]??singlePvpDamageProfile(u,i,null);
  return{
    ...base,
    matchup:mean(profiles.map(p=>p.matchup)),
    deterministicEach:mean(profiles.map(p=>p.deterministicEach)),
    expectedEach:mean(profiles.map(p=>p.expectedEach)),
    unknownArchetypeCount:profiles.length
  };
}
export function pvpEffectiveStrengthEach(u,i,enemy=null){
  return pvpDamageProfile(u,i,enemy).expectedEach;
}

function categoryEmpty(category){
  return{category,selectedCount:0,totalCapacity:0,capacityPercent:0,results:[]};
}
function categorySelectedMap(all,selectedIds){
  return selectedUnits(all,selectedIds);
}
function initialEstimatedQuantity(u,categoryCount,inputs){
  const cfg=CATEGORY_CONFIG[u.category],limit=Number(inputs[cfg.capacityInput]||0),fill=Number(inputs[cfg.fillInput]||0);
  const cap=Math.max(1,Number(u[cfg.capacityEach]||1));
  return categoryCount>0?(limit*fill/categoryCount)/cap:0;
}
function mean(values){
  return values.length?values.reduce((s,v)=>s+v,0)/values.length:0;
}
function orderKey(order){return order.map(u=>u.id).join('|');}

const COST_EQUIVALENCE_BAND=0.05;

const UNKNOWN_PVP_COMBAT_TYPES=new Set(['FLYING','MOUNTED','MELEE','RANGED']);
const UNKNOWN_PVP_SPECIES=new Set(['HUMAN','BEAST','DRAGON','GIANT','ELEMENTAL']);

function buildUnknownPvpArchetypes({troops=[],monsters=[],mercenaries=[]}={}){
  const unique=new Map();
  for(const unit of [...troops,...monsters,...mercenaries]){
    const type=String(unit?.type||'').toUpperCase();
    const species=String(unit?.species||'').toUpperCase();
    if(!UNKNOWN_PVP_COMBAT_TYPES.has(type)||!UNKNOWN_PVP_SPECIES.has(species))continue;
    const key=`${type}|${species}`;
    if(!unique.has(key))unique.set(key,{type,species});
  }
  return [...unique.values()].sort((a,b)=>
    a.type.localeCompare(b.type)||a.species.localeCompare(b.species)
  );
}

function unknownPvpEnemyModel(source){
  return{
    unknown:true,
    name:'Unknown enemy squads',
    level:'PvP',
    type:'Mixed',
    species:'Mixed',
    archetypes:buildUnknownPvpArchetypes(source),
    archetypeWeighting:'equal-supported-archetype',
    supportedCombatTypes:[...UNKNOWN_PVP_COMBAT_TYPES],
    supportedSpecies:[...UNKNOWN_PVP_SPECIES],
  };
}

function mercenaryLevel(level){
  const raw=String(level||'').toUpperCase();
  const first=raw.split('-')[0];
  return first;
}
function economicTierKey(u){
  // Normal troops/monsters already use G9/S9/E9/M9-style tiers.
  // Mercenary canonical levels include a subtype (2-SPCL, 2-GRD, etc.).
  // CP ordering should compare all mercenaries of the same Roman level
  // together rather than treating each subtype as a separate economic tier.
  return u.category==='mercenary'?`MERC-${mercenaryLevel(u.level)}`:String(u.level||'');
}

function comparePvpInternalRows(a,b){
  const goldA=Math.max(0,Number(a.goldCost??a.fullGold??0));
  const goldB=Math.max(0,Number(b.goldCost??b.fullGold??0));
  const silverA=Math.max(0,Number(a.silverCost||0));
  const silverB=Math.max(0,Number(b.silverCost||0));
  const low=Math.min(goldA,goldB);
  const relativeGap=low>0?Math.abs(goldA-goldB)/low:Math.abs(goldA-goldB);

  // Material cost difference: cheaper squad dies first.
  if(relativeGap>COST_EQUIVALENCE_BAND){
    return goldA-goldB ||
      silverA-silverB ||
      Number(a.expectedDamage||0)-Number(b.expectedDamage||0) ||
      Number(a.u.displayOrder||0)-Number(b.u.displayOrder||0);
  }

  // Economically equivalent: preserve the stronger PvP squad.
  // Expected damage already includes matchup bonuses, Specialist 2×, DD and ST.
  return Number(a.expectedDamage||0)-Number(b.expectedDamage||0) ||
    silverA-silverB ||
    goldA-goldB ||
    Number(a.u.displayOrder||0)-Number(b.u.displayOrder||0);
}

function buildGlobalOrderFromMetrics(rows){
  // CP Basic is cost-first, but it should not sacrifice a much stronger tier
  // merely to save a trivial amount of Gold. Tier groups whose average
  // actual attacking Gold revival cost is within 5% are treated as economically
  // equivalent; the lower expected PvP damage group dies first.
  const groups=new Map();
  for(const row of rows){
    const tierKey=economicTierKey(row.u);
    if(!groups.has(tierKey))groups.set(tierKey,[]);
    groups.get(tierKey).push(row);
  }
  const orderedGroups=[...groups.entries()].map(([level,items])=>({
    level,items,
    avgGold:mean(items.map(x=>Number(x.goldCost??x.fullGold??0))),
    avgSilver:mean(items.map(x=>Number(x.silverCost||0))),
    avgDamage:mean(items.map(x=>x.expectedDamage)),
    minDisplay:Math.min(...items.map(x=>Number(x.u.displayOrder||0)))
  })).sort((a,b)=>{
    const low=Math.min(a.avgGold,b.avgGold);
    const relativeGap=low>0?Math.abs(a.avgGold-b.avgGold)/low:Math.abs(a.avgGold-b.avgGold);
    if(relativeGap<=COST_EQUIVALENCE_BAND){
      return a.avgDamage-b.avgDamage || a.avgSilver-b.avgSilver || a.avgGold-b.avgGold || a.minDisplay-b.minDisplay;
    }
    return a.avgGold-b.avgGold || a.avgSilver-b.avgSilver || a.minDisplay-b.minDisplay;
  });

  const result=[];
  for(const group of orderedGroups){
    const items=group.items.slice().sort(comparePvpInternalRows);
    result.push(...items.map(x=>x.u));
  }
  return result;
}


function pvpRevivalForQuantity(unit,quantity,inputs){
  return squadRevivalCosts({quantity,goldEach:Number(unit.goldRevivalCost||0),silverEach:Number(unit.silverRevivalCost||0),templeDivisor:Number(inputs.templeRevivalDivisor||1)});
}

function refreshRowAfterQtyChange(row,newQty,inputs,enemy){
  const qty=Math.max(0,Math.floor(Number(newQty)||0)),unit=row.u;
  if(!unit)throw new Error(`Missing source unit for ${row.name||row.id}.`);
  const profile=pvpDamageProfile(unit,inputs,enemy),revival=pvpRevivalForQuantity(unit,qty,inputs);
  row.qty=qty;
  row.squadHealth=qty*Number(row.effectiveHealthEach||0);
  row.squadStrength=qty*Number(unit.strengthEach||0);
  row.expectedPvpDamage=qty*profile.expectedEach;
  row.deterministicPvpDamage=qty*profile.deterministicEach;
  row.pvpMatchupBonus=profile.matchup;row.specialistPvpMultiplier=profile.specialistMultiplier;row.pDD=profile.pDD;row.pST=profile.pST;
  row.fullSquadGoldRevival=revival.fullGold;row.fullSquadSilverRevival=revival.fullSilver;
  row.revivableQuantity=revival.revivableQuantity;
  row.revivableGoldCostRaw=revival.revivableGoldRaw;row.revivableSilverCostRaw=revival.revivableSilverRaw;
  row.actualGoldRevivalCost=revival.actualGold;row.actualSilverRevivalCost=revival.actualSilver;
  row.totalCapacity=qty*Number(row.capacityEach||0);
  return row;
}


function enforceStrictPvpHealthOrder(rows,orderedIds,inputs,enemy,minimumQuantity=1){
  const byId=new Map(rows.map(r=>[r.id,r]));
  let prev=null,adjustments=0,unresolved=0;
  for(const id of orderedIds||[]){
    const row=byId.get(id);if(!row||!(Number(row.qty)>0))continue;
    const each=Number(row.effectiveHealthEach||0);
    const strictThreshold=prev?Number(prev.squadHealth)-Math.max(1e-6,Math.abs(Number(prev.squadHealth))*1e-10):null;
    if(prev&&each>0&&Number(row.squadHealth)>=strictThreshold){
      const minQty=Math.max(1,Number(minimumQuantity||1));
      let maxQty=Math.floor(strictThreshold/each);
      while(maxQty>=minQty&&maxQty*each>=strictThreshold)maxQty--;
      const nextQty=Math.max(minQty,Math.min(Number(row.qty),maxQty));
      if(nextQty<Number(row.qty)){
        refreshRowAfterQtyChange(row,nextQty,inputs,enemy);
        adjustments++;
      }
      if(Number(row.squadHealth)>=strictThreshold)unresolved++;
    }
    prev=row;
  }
  return{adjustments,unresolved};
}

function enforceCapacityLimit(categoryResult,limit,inputs,enemy){
  const safeLimit=Math.max(0,Number(limit||0));
  let total=categoryResult.results.reduce((s,r)=>s+Number(r.totalCapacity||0),0);
  if(total<=safeLimit+1e-9){
    categoryResult.totalCapacity=total;
    categoryResult.capacityPercent=safeLimit?total/safeLimit:0;
    return;
  }

  // Integer rounding can put the final stack a few capacity points over the
  // requested maximum. Remove the minimum practical number of units, starting
  // with squads planned to die latest so early sacrificial spacing is not
  // weakened. Recompute all quantity-dependent metrics proportionally.
  const rows=categoryResult.results.slice().sort((a,b)=>
    Number(b.deathIndex??0)-Number(a.deathIndex??0) ||
    Number(b.displayOrder||0)-Number(a.displayOrder||0)
  );

  let guard=0;
  while(total>safeLimit+1e-9&&guard<100000){
    guard++;
    const over=total-safeLimit;
    const candidates=rows.filter(r=>Number(r.qty||0)>0&&Number(r.totalCapacity||0)>0);
    if(!candidates.length)break;

    // Prefer one decrement that removes the smallest amount of excess
    // capacity; use later death position as the tie-breaker.
    let best=candidates[0],bestCap=Number(best.totalCapacity||0)/Number(best.qty||1);
    let bestPenalty=bestCap>=over?bestCap-over:over-bestCap+1e6;
    for(const r of candidates.slice(1)){
      const cap=Number(r.totalCapacity||0)/Number(r.qty||1);
      const penalty=cap>=over?cap-over:over-cap+1e6;
      if(penalty<bestPenalty-1e-9||
         (Math.abs(penalty-bestPenalty)<1e-9&&Number(r.deathIndex??0)>Number(best.deathIndex??0))){
        best=r;bestCap=cap;bestPenalty=penalty;
      }
    }
    const oldQty=Number(best.qty||0);
    refreshRowAfterQtyChange(best,Math.max(0,oldQty-1),inputs,enemy);
    total-=bestCap;
  }

  categoryResult.totalCapacity=categoryResult.results.reduce((s,r)=>s+Number(r.totalCapacity||0),0);
  categoryResult.capacityPercent=safeLimit?categoryResult.totalCapacity/safeLimit:0;
}

function calculateFromGlobalOrder({allSelected,order,inputs,enemy}){
  const globalIndex=new Map(order.map((u,k)=>[u.id,k]));
  const count=order.length;
  const byCategory={troop:[],monster:[],mercenary:[]};
  for(const u of allSelected)byCategory[u.category].push(u);

  const categories={};
  for(const category of ['troop','monster','mercenary']){
    const selected=byCategory[category];
    if(!selected.length){categories[category]=categoryEmpty(category);continue;}
    const cfg=CATEGORY_CONFIG[category];
    const maxHealthEach=Math.max(...selected.map(u=>pvpEffectiveHealthEach(u,inputs)));
    const limit=Number(inputs[cfg.capacityInput]||0);
    const fill=Number(inputs[cfg.fillInput]||0);
    const sep=inputs.minimumSeparation?0:Number(inputs.rankSeparation||0);

    const interim=selected.map(u=>{
      const deathIndex=globalIndex.get(u.id)??0;
      const effectiveHealthEach=pvpEffectiveHealthEach(u,inputs);
      const squadModifier=1+(count-1-deathIndex)*sep;
      const modifier=squadModifier;
      const capEach=Number(u[cfg.capacityEach]||0);
      // Quantity is inversely proportional to actual effective health per unit,
      // so the completed squads follow the requested health ladder directly.
      const C=modifier*maxHealthEach/Math.max(effectiveHealthEach,1e-12);
      const D=C*capEach;
      return{u,deathIndex,effectiveHealthEach,squadModifier,modifier,capEach,C,D};
    });
    const sumD=interim.reduce((s,r)=>s+r.D,0);

    const results=interim.map(r=>{
      const rawQty=sumD>0?(r.D/sumD)*(limit/r.capEach)*fill:0;
      const qty=mroundPositive(Math.max(0,rawQty),1);
      const row={
        u:r.u,id:r.u.id,unitId:Number(r.u.unitId??r.u.displayOrder),category,displayOrder:r.u.displayOrder,selectionKey:r.u.selectionKey,
        level:r.u.level,type:r.u.type,name:r.u.name,icon:r.u.icon,
        qty,rawQty,roundTo:1,rank:r.deathIndex+1,deathIndex:r.deathIndex,
        plannedDeathIndex:r.deathIndex,
        speciesAdjustment:0,modifier:r.modifier,
        effectiveHealthEach:r.effectiveHealthEach,
        goldRevivalCostEach:Number(r.u.goldRevivalCost||0),
        silverRevivalCostEach:Number(r.u.silverRevivalCost||0),
        capacityEach:r.capEach,
        totalCapacity:0
      };
      return refreshRowAfterQtyChange(row,qty,inputs,enemy);
    });
    if(inputs.minimumSeparation){const byId=new Map(results.map(r=>[r.id,r]));let prev=null;for(const u of order){const row=byId.get(u.id);if(!row)continue;const each=Number(row.effectiveHealthEach||0);if(prev&&each>0&&row.squadHealth>=prev.squadHealth){const q=Math.max(1,Math.ceil(prev.squadHealth/each)-1);if(q<row.qty)refreshRowAfterQtyChange(row,q,inputs,enemy);}prev=row;}}
  const totalCapacity=results.reduce((s,r)=>s+r.totalCapacity,0);
    categories[category]={
      category,selectedCount:selected.length,maxHealthEach,capacityLimit:limit,requestedFill:fill,
      totalCapacity,capacityPercent:limit?totalCapacity/limit:0,
      results:results.slice().sort((a,b)=>a.displayOrder-b.displayOrder)
    };
    if(!inputs._skipHardCapacity)enforceCapacityLimit(categories[category],limit*Math.max(0,Math.min(1,Number(fill)||0)),inputs,enemy);
    const plannedIds=order.filter(u=>u.category===category).map(u=>u.id);
    const strict=enforceStrictPvpHealthOrder(categories[category].results,plannedIds,inputs,enemy);
    categories[category].strictHealthAdjustments=strict.adjustments;
    categories[category].strictHealthUnresolved=strict.unresolved;
    categories[category].totalCapacity=categories[category].results.reduce((s,r)=>s+Number(r.totalCapacity||0),0);
    categories[category].capacityPercent=limit?categories[category].totalCapacity/limit:0;
  }
  return categories;
}

function finalizePvpStack({categories,inputs,enemy,battleType,plannedOrder,strictHealth,diagnostics={}}){
  const allRows=[...categories.troop.results,...categories.monster.results,...categories.mercenary.results];
  let projectedLifetimeDamage=0,initiativeCases=null,projectionModel='unknown-archetype-comparison-v1';
  if(battleType==='pvp_single_cp'){
    const squads=allRows.map(row=>({
      id:row.id,unitId:Number(row.unitId??row.displayOrder),name:row.name,quantity:row.qty,
      effectiveHealth:row.squadHealth,
      nominalSquadStrength:Number(row.u?.strengthEach||0)*row.qty,
      expectedDamagePerOpportunity:row.expectedPvpDamage,
    }));
    const simulation=simulateTwoInitiativeAverage(squads,1);
    initiativeCases={friendlyFirst:simulation.friendlyFirst,enemyFirst:simulation.enemyFirst};
    projectedLifetimeDamage=simulation.expectedTotalLifetimeDamage;
    projectionModel='two-initiative-event-v1';
    for(const row of allRows){
      row.friendlyFirstAttackOpportunities=simulation.friendlyFirst.attackOpportunities[row.id];
      row.enemyFirstAttackOpportunities=simulation.enemyFirst.attackOpportunities[row.id];
      row.averageAttackOpportunities=(row.friendlyFirstAttackOpportunities+row.enemyFirstAttackOpportunities)/2;
      row.projectedLifetimeDamage=(simulation.friendlyFirst.lifetimeDamage[row.id]+simulation.enemyFirst.lifetimeDamage[row.id])/2;
      row.predictedDeathCycle=simulation.friendlyFirst.death[row.id]?.cycle??null;
      row.predictedDeathIndex=(simulation.friendlyFirst.death[row.id]?.position??0)-1;
    }
  }else{
    const actual=allRows.slice().sort((a,b)=>b.squadHealth-a.squadHealth||Number(a.unitId??a.displayOrder)-Number(b.unitId??b.displayOrder));
    actual.forEach((row,index)=>{
      row.predictedDeathIndex=index;
      row.averageAttackOpportunities=index+.5;
      row.projectedLifetimeDamage=row.expectedPvpDamage*row.averageAttackOpportunities;
    });
    projectedLifetimeDamage=actual.reduce((sum,row)=>sum+Number(row.projectedLifetimeDamage||0),0);
  }
  const fullAttritionGold=allRows.reduce((sum,row)=>sum+Number(row.fullSquadGoldRevival||0),0);
  const fullAttritionSilver=allRows.reduce((sum,row)=>sum+Number(row.fullSquadSilverRevival||0),0);
  const actualAttritionGold=allRows.reduce((sum,row)=>sum+Number(row.actualGoldRevivalCost||0),0);
  const actualAttritionSilver=allRows.reduce((sum,row)=>sum+Number(row.actualSilverRevivalCost||0),0);
  return{
    inputs:structuredClone(inputs),battleType,enemy,pvpCp:true,pvpUnknown:battleType==='pvp_unknown',
    plannedOrder:[...(plannedOrder||[])],projectionModel,initiativeCases,
    strictHealthAdjustments:Number(strictHealth?.adjustments||0),strictHealthUnresolved:Number(strictHealth?.unresolved||0),
    projectedLifetimeDamage,fullAttritionGold,fullAttritionSilver,actualAttritionGold,actualAttritionSilver,
    costEquivalenceBand:COST_EQUIVALENCE_BAND,diagnostics:{...diagnostics,projectionModel},categories,
    totals:{leadership:categories.troop.totalCapacity,dominance:categories.monster.totalCapacity,authority:categories.mercenary.totalCapacity},
  };
}

function resolvePvpOrderCycle({cycleOrders,allSelected,inputs,enemy,battleType}){
  const candidates=cycleOrders.map(order=>{
    const categories=calculateFromGlobalOrder({allSelected,order,inputs,enemy});
    const allRows=[...categories.troop.results,...categories.monster.results,...categories.mercenary.results];
    const strictHealth=enforceStrictPvpHealthOrder(allRows,order.map(unit=>unit.id),inputs,enemy);
    const result=finalizePvpStack({categories,inputs,enemy,battleType,plannedOrder:order.map(unit=>unit.id),strictHealth});
    return{order,key:orderKey(order),gold:result.actualAttritionGold,silver:result.actualAttritionSilver,damage:result.projectedLifetimeDamage};
  });
  candidates.sort((a,b)=>{
    const low=Math.min(a.gold,b.gold);
    const relativeGap=low>0?Math.abs(a.gold-b.gold)/low:Math.abs(a.gold-b.gold);
    if(relativeGap>COST_EQUIVALENCE_BAND)return a.gold-b.gold||a.silver-b.silver||b.damage-a.damage||a.key.localeCompare(b.key);
    return b.damage-a.damage||a.silver-b.silver||a.gold-b.gold||a.key.localeCompare(b.key);
  });
  return{order:candidates[0]?.order||cycleOrders[0],candidateCount:candidates.length};
}

function solvePvpStandardCategory({category,units,selectedIds,inputs,enemy,battleType}){
  const selected=categorySelectedMap(units,selectedIds);
  if(!selected.length)return{categoryResult:categoryEmpty(category),order:[],diagnostics:{orderIterations:0,orderConverged:true,orderCycleDetected:false,orderCycleLength:0,orderCycleResolution:null}};

  let metrics=selected.map(u=>{
    const qty=initialEstimatedQuantity(u,selected.length,inputs);
    const p=pvpDamageProfile(u,inputs,enemy);
    const legalQty=Math.max(0,Math.round(qty)),revival=pvpRevivalForQuantity(u,legalQty,inputs);
    return{u,goldCost:revival.actualGold,silverCost:revival.actualSilver,expectedDamage:legalQty*p.expectedEach};
  });
  let order=buildGlobalOrderFromMetrics(metrics);
  const seen=new Map(),orderHistory=[];
  let orderIterations=0,orderConverged=false,orderCycleDetected=false,orderCycleLength=0,orderCycleResolution=null;

  for(let iteration=0;iteration<16;iteration++){
    orderIterations=iteration+1;
    const key=orderKey(order);
    if(seen.has(key)){
      orderCycleDetected=true;
      const cycleStart=seen.get(key),cycleOrders=orderHistory.slice(cycleStart);
      orderCycleLength=cycleOrders.length;
      const resolution=resolvePvpOrderCycle({cycleOrders,allSelected:selected,inputs,enemy,battleType});
      order=resolution.order;
      orderCycleResolution='gold-band-damage-silver';
      break;
    }
    seen.set(key,orderHistory.length);orderHistory.push(order.slice());
    const calculated=calculateFromGlobalOrder({allSelected:selected,order,inputs,enemy});
    const rowById=new Map(calculated[category].results.map(row=>[row.id,row]));
    metrics=order.map(u=>{
      const row=rowById.get(u.id);
      return{u,goldCost:row?.actualGoldRevivalCost??0,silverCost:row?.actualSilverRevivalCost??0,expectedDamage:row?.expectedPvpDamage??0};
    });
    const next=buildGlobalOrderFromMetrics(metrics);
    if(orderKey(next)===key){order=next;orderConverged=true;break;}
    order=next;
  }

  const categoryResult=calculateFromGlobalOrder({allSelected:selected,order,inputs,enemy})[category];
  return{categoryResult,order,diagnostics:{orderIterations,orderConverged,orderCycleDetected,orderCycleLength,orderCycleResolution}};
}

export function calculatePvpCpStack({troops,monsters,mercenaries,selectedIds,inputs,enemy,battleType='pvp_single_cp'}){
  const source={troop:troops,monster:monsters,mercenary:mercenaries};
  const solutions=Object.fromEntries(['troop','monster','mercenary'].map(category=>[category,solvePvpStandardCategory({category,units:source[category],selectedIds:selectedIds[category],inputs,enemy,battleType})]));
  const categories=Object.fromEntries(['troop','monster','mercenary'].map(category=>[category,solutions[category].categoryResult]));
  const plannedOrderByCategory=Object.fromEntries(['troop','monster','mercenary'].map(category=>[category,solutions[category].order.map(unit=>unit.id)]));
  const strictHealth={
    adjustments:Object.values(categories).reduce((sum,result)=>sum+Number(result.strictHealthAdjustments||0),0),
    unresolved:Object.values(categories).reduce((sum,result)=>sum+Number(result.strictHealthUnresolved||0),0),
  };
  const result=finalizePvpStack({categories,inputs,enemy,battleType,plannedOrder:[],strictHealth,
    diagnostics:{capacityPools:'independent',categoryOrderDiagnostics:Object.fromEntries(['troop','monster','mercenary'].map(category=>[category,solutions[category].diagnostics])),economicPolicy:'gold-primary-5pct-damage-then-silver'}});
  const allRows=[...categories.troop.results,...categories.monster.results,...categories.mercenary.results];
  result.plannedOrderByCategory=plannedOrderByCategory;
  result.plannedOrder=allRows.slice().sort((a,b)=>Number(a.predictedDeathIndex??999)-Number(b.predictedDeathIndex??999)||Number(a.unitId)-Number(b.unitId)).map(row=>row.id);
  return result;
}

export function calculatePvpCustomCategory({category,units,selectedIds,inputs,order,unitOrder=null,enemy}){
  const cfg=CATEGORY_CONFIG[category],selected=selectedUnits(units,selectedIds);
  if(!selected.length)return categoryEmpty(category);

  const normalizeOrderLevel=level=>{
    const raw=String(level||'').toUpperCase();
    if(category!=='mercenary')return raw;
    return `MERC-${mercenaryLevel(raw)}`;
  };
  const orderMap=new Map((order||[]).map((level,index)=>[normalizeOrderLevel(level),index]));
  const unitOrderKey=unit=>category==='mercenary'?economicTierKey(unit):String(unit.level||'').toUpperCase();
  const explicitRank=new Map((unitOrder||[]).map((id,index)=>[id,index]));
  const explicitComplete=selected.every(unit=>explicitRank.has(unit.id));

  if(!explicitComplete)for(const unit of selected){
    const key=unitOrderKey(unit);
    if(!orderMap.has(key))throw new Error(`Add ${mercenaryLevel(unit.level)} to the ${category} die order.`);
  }

  const count=selected.length;
  const maxHealthEach=Math.max(...selected.map(u=>pvpEffectiveHealthEach(u,inputs)));
  const limit=Number(inputs[cfg.capacityInput]||0);
  const fill=Number(inputs[cfg.fillInput]||0);
  const sep=inputs.minimumSeparation?0:Number(inputs.rankSeparation||0);

  const calculateForOrder=ordered=>{
    const deathIndex=new Map(ordered.map((u,k)=>[u.id,k]));
    const interim=selected.map(u=>{
      const idx=deathIndex.get(u.id)??0;
      const effectiveHealthEach=pvpEffectiveHealthEach(u,inputs);
      const modifier=1+(count-1-idx)*sep;
      const capEach=Number(u[cfg.capacityEach]||0);
      const D=(modifier*maxHealthEach/Math.max(effectiveHealthEach,1e-12))*capEach;
      return{u,idx,effectiveHealthEach,modifier,capEach,D};
    });
    const sumD=interim.reduce((s,r)=>s+r.D,0);

    const results=interim.map(r=>{
      const rawQty=sumD>0?(r.D/sumD)*(limit/r.capEach)*fill:0;
      const qty=mroundPositive(Math.max(0,rawQty),1);
      const row={
        u:r.u,id:r.u.id,unitId:Number(r.u.unitId??r.u.displayOrder),category,displayOrder:r.u.displayOrder,selectionKey:r.u.selectionKey,
        level:r.u.level,type:r.u.type,name:r.u.name,icon:r.u.icon,qty,rawQty,roundTo:1,
        rank:r.idx+1,deathIndex:r.idx,plannedDeathIndex:r.idx,
        speciesAdjustment:0,modifier:r.modifier,
        effectiveHealthEach:r.effectiveHealthEach,
        goldRevivalCostEach:Number(r.u.goldRevivalCost||0),
        silverRevivalCostEach:Number(r.u.silverRevivalCost||0),
        capacityEach:r.capEach,totalCapacity:0
      };
      return refreshRowAfterQtyChange(row,qty,inputs,enemy);
    });

    if(inputs.minimumSeparation){const byId=new Map(results.map(r=>[r.id,r]));let prev=null;for(const u of ordered){const row=byId.get(u.id);if(!row)continue;const each=Number(row.effectiveHealthEach||0);if(prev&&each>0&&row.squadHealth>=prev.squadHealth){const q=Math.max(1,Math.ceil(prev.squadHealth/each)-1);if(q<row.qty)refreshRowAfterQtyChange(row,q,inputs,enemy);}prev=row;}}
    const totalCapacity=results.reduce((s,r)=>s+r.totalCapacity,0);
    const categoryResult={
      category,selectedCount:selected.length,maxHealthEach,capacityLimit:limit,requestedFill:fill,
      totalCapacity,capacityPercent:limit?totalCapacity/limit:0,
      results:results.slice().sort((a,b)=>a.displayOrder-b.displayOrder)
    };
    if(!inputs._skipHardCapacity)enforceCapacityLimit(categoryResult,limit*Math.max(0,Math.min(1,Number(fill)||0)),inputs,enemy);
    const strict=enforceStrictPvpHealthOrder(categoryResult.results,ordered.map(u=>u.id),inputs,enemy);
    categoryResult.strictHealthAdjustments=strict.adjustments;
    categoryResult.strictHealthUnresolved=strict.unresolved;
    categoryResult.totalCapacity=categoryResult.results.reduce((s,r)=>s+Number(r.totalCapacity||0),0);
    categoryResult.capacityPercent=limit?categoryResult.totalCapacity/limit:0;
    return categoryResult;
  };

  // User fixes the tier order. The calculator iterates only the units *within*
  // each tier using the exact same revival-cost / expected-damage comparator
  // used by Basic.
  let ordered=selected.slice().sort((a,b)=>explicitComplete?(explicitRank.get(a.id)-explicitRank.get(b.id)||Number(a.displayOrder||0)-Number(b.displayOrder||0)):(orderMap.get(unitOrderKey(a))-orderMap.get(unitOrderKey(b)) || (explicitRank.has(a.id)&&explicitRank.has(b.id)?explicitRank.get(a.id)-explicitRank.get(b.id):Number(a.displayOrder||0)-Number(b.displayOrder||0))));
  if(explicitComplete)return calculateForOrder(ordered);
  const seen=new Set();

  for(let iteration=0;iteration<16;iteration++){
    const key=ordered.map(u=>u.id).join('|');
    if(seen.has(key))break;
    seen.add(key);

    const calculated=calculateForOrder(ordered);
    const rowById=new Map(calculated.results.map(r=>[r.id,r]));

    const next=ordered.slice().sort((a,b)=>{
      const groupDelta=orderMap.get(unitOrderKey(a))-orderMap.get(unitOrderKey(b));
      if(groupDelta)return groupDelta;

      const ra=rowById.get(a.id),rb=rowById.get(b.id);
      return comparePvpInternalRows(
        {u:a,goldCost:ra?.actualGoldRevivalCost??0,silverCost:ra?.actualSilverRevivalCost??0,expectedDamage:ra?.expectedPvpDamage??0},
        {u:b,goldCost:rb?.actualGoldRevivalCost??0,silverCost:rb?.actualSilverRevivalCost??0,expectedDamage:rb?.expectedPvpDamage??0}
      );
    });

    const nextKey=next.map(u=>u.id).join('|');
    ordered=next;
    if(nextKey===key)break;
  }

  return calculateForOrder(ordered);
}

export function defaultPvpInternalOrder({category,units,selectedIds,inputs,order,enemy}){
  const result=calculatePvpCustomCategory({category,units,selectedIds,inputs,order,unitOrder:null,enemy});
  return result.results.slice().sort((a,b)=>Number(a.plannedDeathIndex??a.deathIndex??0)-Number(b.plannedDeathIndex??b.deathIndex??0)).map(r=>r.id);
}

export function calculatePvpCustomStack({troops,monsters,mercenaries,selectedIds,orders,unitOrders=null,squadOrders=null,inputs,enemy,battleType='pvp_single_cp'}){
  const flat=c=>squadOrders?.[c]?.length?squadOrders[c]:(orders[c]||[]).flatMap(l=>unitOrders?.[c]?.[l]||[]);
  const allSelected=[...categorySelectedMap(troops,selectedIds.troop),...categorySelectedMap(monsters,selectedIds.monster),...categorySelectedMap(mercenaries,selectedIds.mercenary)];
  if(!allSelected.length)return calculatePvpCpStack({troops,monsters,mercenaries,selectedIds,inputs,enemy,battleType});

  const categories={
    troop:calculatePvpCustomCategory({category:'troop',units:troops,selectedIds:selectedIds.troop,inputs,order:orders.troop,unitOrder:flat('troop'),enemy}),
    monster:calculatePvpCustomCategory({category:'monster',units:monsters,selectedIds:selectedIds.monster,inputs,order:orders.monster,unitOrder:flat('monster'),enemy}),
    mercenary:calculatePvpCustomCategory({category:'mercenary',units:mercenaries,selectedIds:selectedIds.mercenary,inputs,order:orders.mercenary,unitOrder:flat('mercenary'),enemy}),
  };
  const plannedOrderByCategory=Object.fromEntries(['troop','monster','mercenary'].map(category=>[category,categories[category].results.slice().sort((a,b)=>Number(a.plannedDeathIndex)-Number(b.plannedDeathIndex)).map(row=>row.id)]));
  const strictHealth={
    adjustments:Object.values(categories).reduce((sum,result)=>sum+Number(result.strictHealthAdjustments||0),0),
    unresolved:Object.values(categories).reduce((sum,result)=>sum+Number(result.strictHealthUnresolved||0),0),
  };
  const result=finalizePvpStack({categories,inputs,enemy,battleType,plannedOrder:[],strictHealth,
    diagnostics:{capacityPools:'independent',customOrder:'within-capacity-pool',economicPolicy:'gold-primary-5pct-damage-then-silver'}});
  const allRows=[...categories.troop.results,...categories.monster.results,...categories.mercenary.results];
  result.plannedOrderByCategory=plannedOrderByCategory;
  result.plannedOrder=allRows.slice().sort((a,b)=>Number(a.predictedDeathIndex??999)-Number(b.predictedDeathIndex??999)||Number(a.unitId)-Number(b.unitId)).map(row=>row.id);
  return result;
}

export function calculatePvpUnknownStack({troops,monsters,mercenaries,selectedIds,inputs}){
  const enemy=unknownPvpEnemyModel({troops,monsters,mercenaries});
  return calculatePvpCpStack({
    troops,monsters,mercenaries,selectedIds,inputs,enemy,battleType:'pvp_unknown'
  });
}

export function calculatePvpUnknownCustomStack({troops,monsters,mercenaries,selectedIds,orders,unitOrders=null,squadOrders=null,inputs}){
  const enemy=unknownPvpEnemyModel({troops,monsters,mercenaries});
  return calculatePvpCustomStack({
    troops,monsters,mercenaries,selectedIds,orders,unitOrders,squadOrders,inputs,enemy,battleType:'pvp_unknown'
  });
}

export function calculateBattleCategory({category,units,selectedIds,inputs,battleType='pvp_unknown'}){
  const cfg=CATEGORY_CONFIG[category],selected=selectedUnits(units,selectedIds);
  if(!selected.length)return categoryEmpty(category);
  const maxHealthEach=Math.max(...selected.map(u=>pvpEffectiveHealthEach(u,inputs))),limit=Number(inputs[cfg.capacityInput]||0),
    fill=Number(inputs[cfg.fillInput]||0),sep=inputs.minimumSeparation?0:Number(inputs.rankSeparation||0);
  // General unknown-enemy PvP remains deterministic. Specialist 2x is included,
  // but no target-specific matchup can be assumed.
  const ordered=selected.slice().sort((a,b)=>
    pvpEffectiveStrengthEach(a,inputs)-pvpEffectiveStrengthEach(b,inputs) ||
    Number(a.displayOrder||0)-Number(b.displayOrder||0)
  );
  const death=new Map(ordered.map((u,k)=>[u.id,k])),count=ordered.length;
  const interim=selected.map(u=>{
    const idx=death.get(u.id)??0,effectiveHealthEach=pvpEffectiveHealthEach(u,inputs),
      modifier=1+(count-1-idx)*sep,cap=Number(u[cfg.capacityEach]||0),
      D=(modifier*maxHealthEach/Math.max(effectiveHealthEach,1e-12))*cap;
    return{u,idx,effectiveHealthEach,modifier,cap,D};
  });
  const sumD=interim.reduce((s,r)=>s+r.D,0);
  const results=interim.map(r=>{
    const raw=sumD>0?(r.D/sumD)*(limit/r.cap)*fill:0,qty=mroundPositive(Math.max(0,raw),1);
    return{id:r.u.id,category,displayOrder:r.u.displayOrder,selectionKey:r.u.selectionKey,level:r.u.level,type:r.u.type,name:r.u.name,icon:r.u.icon,
      qty,rawQty:raw,roundTo:1,rank:r.idx+1,deathIndex:r.idx,effectiveHealthEach:r.effectiveHealthEach,squadHealth:qty*r.effectiveHealthEach,
      squadStrength:pvpEffectiveStrengthEach(r.u,inputs)*qty,pvpStrengthEach:pvpEffectiveStrengthEach(r.u,inputs),
      specialistPvpMultiplier:specialist(r.u)?2:1,totalCapacity:r.cap*qty};
  });
  const totalCapacity=results.reduce((s,r)=>s+r.totalCapacity,0);
  return{category,selectedCount:selected.length,maxHealthEach,capacityLimit:limit,requestedFill:fill,totalCapacity,
    capacityPercent:limit?totalCapacity/limit:0,results:results.slice().sort((a,b)=>a.displayOrder-b.displayOrder)};
}

export function calculateBattleStack({troops,monsters,mercenaries,selectedIds,inputs,battleType}){
  const troop=calculateBattleCategory({category:'troop',units:troops,selectedIds:selectedIds.troop,inputs,battleType});
  const monster=calculateBattleCategory({category:'monster',units:monsters,selectedIds:selectedIds.monster,inputs,battleType});
  const mercenary=calculateBattleCategory({category:'mercenary',units:mercenaries,selectedIds:selectedIds.mercenary,inputs,battleType});
  return{inputs:structuredClone(inputs),battleType,categories:{troop,monster,mercenary},
    totals:{leadership:troop.totalCapacity,dominance:monster.totalCapacity,authority:mercenary.totalCapacity}};
}
