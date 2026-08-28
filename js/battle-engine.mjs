import { speciesAdjustment, mroundPositive } from './epic-engine.mjs?v=112';

const CATEGORY_CONFIG=Object.freeze({
  troop:{capacityInput:'leadership',fillInput:'leadershipFill',capacityEach:'leadershipEach'},
  monster:{capacityInput:'dominance',fillInput:'dominanceFill',capacityEach:'dominanceEach'},
  mercenary:{capacityInput:'authority',fillInput:'authorityFill',capacityEach:'authorityEach'}
});

const FAMILY_SPECIES=new Set(['BEAST','DRAGON','ELEMENTAL','GIANT']);

function selectedUnits(units,ids){
  const s=new Set(ids??[]);
  return units.filter(u=>s.has(u.id));
}
function specialist(u){
  return String(u.class||'').toUpperCase()==='SPECIALIST';
}
function familyKey(u){
  const s=String(u.species||'').toUpperCase();
  if(s==='EPIC HUNTER')return'epicHunter';
  if(FAMILY_SPECIES.has(s))return'monster';
  return'human';
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
  return Number(u.healthEach||0)*(1+familyHealthPct(u,i)/100);
}
function familyDdPct(u,i){
  const k=familyKey(u);
  return Number(i[`${k}DDPct`]??0);
}
function familyStPct(u,i){
  const k=familyKey(u);
  return Number(i[`${k}STPct`]??0);
}
function clamp01(x){return Math.max(0,Math.min(1,Number(x)||0));}
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
  const pDD=clamp01(familyDdPct(u,i)/100+intrinsicDd);
  const pST=clamp01(familyStPct(u,i)/100);
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
    archetypes:buildUnknownPvpArchetypes(source)
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
  const goldA=Math.max(0,Number(a.fullGold||0));
  const goldB=Math.max(0,Number(b.fullGold||0));
  const low=Math.min(goldA,goldB);
  const relativeGap=low>0?Math.abs(goldA-goldB)/low:Math.abs(goldA-goldB);

  // Material cost difference: cheaper squad dies first.
  if(relativeGap>COST_EQUIVALENCE_BAND){
    return goldA-goldB ||
      Number(a.expectedDamage||0)-Number(b.expectedDamage||0) ||
      Number(a.u.displayOrder||0)-Number(b.u.displayOrder||0);
  }

  // Economically equivalent: preserve the stronger PvP squad.
  // Expected damage already includes matchup bonuses, Specialist 2×, DD and ST.
  return Number(a.expectedDamage||0)-Number(b.expectedDamage||0) ||
    goldA-goldB ||
    Number(a.u.displayOrder||0)-Number(b.u.displayOrder||0);
}

function buildGlobalOrderFromMetrics(rows){
  // CP Basic is cost-first, but it should not sacrifice a much stronger tier
  // merely to save a trivial amount of Gold. Tier groups whose average
  // full-squad revival cost is within 5% are treated as economically
  // equivalent; the lower expected PvP damage group dies first.
  const groups=new Map();
  for(const row of rows){
    const tierKey=economicTierKey(row.u);
    if(!groups.has(tierKey))groups.set(tierKey,[]);
    groups.get(tierKey).push(row);
  }
  const orderedGroups=[...groups.entries()].map(([level,items])=>({
    level,items,
    avgGold:mean(items.map(x=>x.fullGold)),
    avgDamage:mean(items.map(x=>x.expectedDamage)),
    minDisplay:Math.min(...items.map(x=>Number(x.u.displayOrder||0)))
  })).sort((a,b)=>{
    const low=Math.min(a.avgGold,b.avgGold);
    const relativeGap=low>0?Math.abs(a.avgGold-b.avgGold)/low:Math.abs(a.avgGold-b.avgGold);
    if(relativeGap<=COST_EQUIVALENCE_BAND){
      return a.avgDamage-b.avgDamage || a.avgGold-b.avgGold || a.minDisplay-b.minDisplay;
    }
    return a.avgGold-b.avgGold || a.minDisplay-b.minDisplay;
  });

  const result=[];
  for(const group of orderedGroups){
    const items=group.items.slice().sort(comparePvpInternalRows);
    result.push(...items.map(x=>x.u));
  }
  return result;
}


function refreshRowAfterQtyChange(row,newQty){
  const oldQty=Math.max(0,Number(row.qty||0));
  const ratio=oldQty>0?newQty/oldQty:0;
  row.qty=newQty;
  row.squadHealth*=ratio;
  row.squadStrength*=ratio;
  row.expectedPvpDamage*=ratio;
  row.deterministicPvpDamage*=ratio;
  row.fullSquadGoldRevival*=ratio;
  row.totalCapacity*=ratio;
}

function enforceCapacityLimit(categoryResult,limit){
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
    refreshRowAfterQtyChange(best,Math.max(0,oldQty-1));
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
    const sep=Number(inputs.rankSeparation||0);

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
      const p=pvpDamageProfile(r.u,inputs,enemy);
      const fullGold=qty*Math.max(0,Number(r.u.goldRevivalCost||0));
      return{
        u:r.u,id:r.u.id,category,displayOrder:r.u.displayOrder,selectionKey:r.u.selectionKey,
        level:r.u.level,type:r.u.type,name:r.u.name,icon:r.u.icon,
        qty,rawQty,roundTo:1,rank:r.deathIndex+1,deathIndex:r.deathIndex,
        plannedDeathIndex:r.deathIndex,
        speciesAdjustment:0,modifier:r.modifier,
        effectiveHealthEach:r.effectiveHealthEach,
        squadHealth:qty*r.effectiveHealthEach,
        squadStrength:Number(r.u.strengthEach||0)*qty,
        expectedPvpDamage:p.expectedEach*qty,
        deterministicPvpDamage:p.deterministicEach*qty,
        pvpMatchupBonus:p.matchup,
        specialistPvpMultiplier:p.specialistMultiplier,
        pDD:p.pDD,pST:p.pST,
        fullSquadGoldRevival:fullGold,
        goldRevivalCostEach:Number(r.u.goldRevivalCost||0),
        capacityEach:r.capEach,
        totalCapacity:r.capEach*qty
      };
    });
    const totalCapacity=results.reduce((s,r)=>s+r.totalCapacity,0);
    categories[category]={
      category,selectedCount:selected.length,maxHealthEach,capacityLimit:limit,requestedFill:fill,
      totalCapacity,capacityPercent:limit?totalCapacity/limit:0,
      results:results.slice().sort((a,b)=>a.displayOrder-b.displayOrder)
    };
    enforceCapacityLimit(categories[category],limit);
  }
  return categories;
}

export function calculatePvpCpStack({troops,monsters,mercenaries,selectedIds,inputs,enemy,battleType='pvp_single_cp'}){
  const allSelected=[
    ...categorySelectedMap(troops,selectedIds.troop),
    ...categorySelectedMap(monsters,selectedIds.monster),
    ...categorySelectedMap(mercenaries,selectedIds.mercenary)
  ];
  if(!allSelected.length){
    return{inputs:structuredClone(inputs),battleType,enemy,categories:{
      troop:categoryEmpty('troop'),monster:categoryEmpty('monster'),mercenary:categoryEmpty('mercenary')
    },totals:{leadership:0,dominance:0,authority:0},pvpCp:true};
  }

  const counts={
    troop:allSelected.filter(u=>u.category==='troop').length,
    monster:allSelected.filter(u=>u.category==='monster').length,
    mercenary:allSelected.filter(u=>u.category==='mercenary').length
  };

  // Initial order uses estimated full-squad revival cost before any death-ladder
  // spacing has been applied.
  let metrics=allSelected.map(u=>{
    const qty=initialEstimatedQuantity(u,counts[u.category],inputs);
    const p=pvpDamageProfile(u,inputs,enemy);
    return{u,fullGold:qty*Number(u.goldRevivalCost||0),expectedDamage:qty*p.expectedEach};
  });
  let order=buildGlobalOrderFromMetrics(metrics);
  const seen=new Set();

  // Recalculate quantities and revival costs until the tier/order stabilizes.
  // This resolves the circular dependency: death order changes quantity, while
  // quantity changes the total cost of losing the squad.
  for(let iteration=0;iteration<16;iteration++){
    const key=orderKey(order);
    if(seen.has(key))break;
    seen.add(key);

    const categories=calculateFromGlobalOrder({allSelected,order,inputs,enemy});
    const resultRows=[
      ...categories.troop.results,
      ...categories.monster.results,
      ...categories.mercenary.results
    ];
    const rowById=new Map(resultRows.map(r=>[r.id,r]));
    metrics=order.map(u=>{
      const r=rowById.get(u.id);
      return{u,fullGold:r?.fullSquadGoldRevival??0,expectedDamage:r?.expectedPvpDamage??0};
    });
    const next=buildGlobalOrderFromMetrics(metrics);
    if(orderKey(next)===key){order=next;break;}
    order=next;
  }

  const categories=calculateFromGlobalOrder({allSelected,order,inputs,enemy});
  const allRows=[...categories.troop.results,...categories.monster.results,...categories.mercenary.results];
  // Actual predicted death sequence follows calculated effective squad health:
  // the game's enemy target selects the healthiest surviving squad first.
  const actual=allRows.slice().sort((a,b)=>b.squadHealth-a.squadHealth||a.plannedDeathIndex-b.plannedDeathIndex);
  actual.forEach((r,k)=>{
    r.predictedDeathIndex=k;
    r.averageAttackOpportunities=(k+1)-0.5;
    r.projectedLifetimeDamage=r.expectedPvpDamage*r.averageAttackOpportunities;
  });
  const projectedLifetimeDamage=actual.reduce((s,r)=>s+Number(r.projectedLifetimeDamage||0),0);
  const fullAttritionGold=actual.reduce((s,r)=>s+Number(r.fullSquadGoldRevival||0),0);

  return{
    inputs:structuredClone(inputs),battleType,enemy,pvpCp:true,pvpUnknown:battleType==='pvp_unknown',
    plannedOrder:order.map(u=>u.id),
    projectedLifetimeDamage,fullAttritionGold,
    costEquivalenceBand:COST_EQUIVALENCE_BAND,
    categories,
    totals:{
      leadership:categories.troop.totalCapacity,
      dominance:categories.monster.totalCapacity,
      authority:categories.mercenary.totalCapacity
    }
  };
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

  for(const unit of selected){
    const key=unitOrderKey(unit);
    if(!orderMap.has(key))throw new Error(`Add ${mercenaryLevel(unit.level)} to the ${category} die order.`);
  }

  const count=selected.length;
  const maxHealthEach=Math.max(...selected.map(u=>pvpEffectiveHealthEach(u,inputs)));
  const limit=Number(inputs[cfg.capacityInput]||0);
  const fill=Number(inputs[cfg.fillInput]||0);
  const sep=Number(inputs.rankSeparation||0);

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
      const p=pvpDamageProfile(r.u,inputs,enemy);
      return{
        id:r.u.id,category,displayOrder:r.u.displayOrder,selectionKey:r.u.selectionKey,
        level:r.u.level,type:r.u.type,name:r.u.name,icon:r.u.icon,qty,rawQty,roundTo:1,
        rank:r.idx+1,deathIndex:r.idx,plannedDeathIndex:r.idx,
        speciesAdjustment:0,modifier:r.modifier,
        effectiveHealthEach:r.effectiveHealthEach,
        squadHealth:qty*r.effectiveHealthEach,
        squadStrength:Number(r.u.strengthEach||0)*qty,
        expectedPvpDamage:p.expectedEach*qty,
        deterministicPvpDamage:p.deterministicEach*qty,
        pvpMatchupBonus:p.matchup,specialistPvpMultiplier:p.specialistMultiplier,pDD:p.pDD,pST:p.pST,
        fullSquadGoldRevival:qty*Number(r.u.goldRevivalCost||0),
        goldRevivalCostEach:Number(r.u.goldRevivalCost||0),
        capacityEach:r.capEach,totalCapacity:r.capEach*qty
      };
    });

    const totalCapacity=results.reduce((s,r)=>s+r.totalCapacity,0);
    const categoryResult={
      category,selectedCount:selected.length,maxHealthEach,capacityLimit:limit,requestedFill:fill,
      totalCapacity,capacityPercent:limit?totalCapacity/limit:0,
      results:results.slice().sort((a,b)=>a.displayOrder-b.displayOrder)
    };
    enforceCapacityLimit(categoryResult,limit);
    return categoryResult;
  };

  // User fixes the tier order. The calculator iterates only the units *within*
  // each tier using the exact same revival-cost / expected-damage comparator
  // used by Basic.
  const explicitRank=new Map((unitOrder||[]).map((id,index)=>[id,index]));
  let ordered=selected.slice().sort((a,b)=>orderMap.get(unitOrderKey(a))-orderMap.get(unitOrderKey(b)) || (explicitRank.has(a.id)&&explicitRank.has(b.id)?explicitRank.get(a.id)-explicitRank.get(b.id):Number(a.displayOrder||0)-Number(b.displayOrder||0)));
  if(explicitRank.size)return calculateForOrder(ordered);
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
        {u:a,fullGold:ra?.fullSquadGoldRevival??0,expectedDamage:ra?.expectedPvpDamage??0},
        {u:b,fullGold:rb?.fullSquadGoldRevival??0,expectedDamage:rb?.expectedPvpDamage??0}
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

export function calculatePvpCustomStack({troops,monsters,mercenaries,selectedIds,orders,unitOrders=null,inputs,enemy,battleType='pvp_single_cp'}){
  const troop=calculatePvpCustomCategory({category:'troop',units:troops,selectedIds:selectedIds.troop,inputs,order:orders.troop,unitOrder:(orders.troop||[]).flatMap(l=>unitOrders?.troop?.[l]||[]),enemy});
  const monster=calculatePvpCustomCategory({category:'monster',units:monsters,selectedIds:selectedIds.monster,inputs,order:orders.monster,unitOrder:(orders.monster||[]).flatMap(l=>unitOrders?.monster?.[l]||[]),enemy});
  const mercenary=calculatePvpCustomCategory({category:'mercenary',units:mercenaries,selectedIds:selectedIds.mercenary,inputs,order:orders.mercenary,unitOrder:(orders.mercenary||[]).flatMap(l=>unitOrders?.mercenary?.[l]||[]),enemy});
  const all=[...troop.results,...monster.results,...mercenary.results].sort((a,b)=>b.squadHealth-a.squadHealth||a.displayOrder-b.displayOrder);
  all.forEach((r,k)=>{
    r.predictedDeathIndex=k;
    r.averageAttackOpportunities=(k+1)-0.5;
    r.projectedLifetimeDamage=r.expectedPvpDamage*r.averageAttackOpportunities;
  });
  const projectedLifetimeDamage=all.reduce((s,r)=>s+Number(r.projectedLifetimeDamage||0),0);
  const fullAttritionGold=all.reduce((s,r)=>s+Number(r.fullSquadGoldRevival||0),0);
  return{inputs:structuredClone(inputs),battleType,enemy,pvpCp:true,pvpUnknown:battleType==='pvp_unknown',
    projectedLifetimeDamage,fullAttritionGold,costEquivalenceBand:COST_EQUIVALENCE_BAND,
    categories:{troop,monster,mercenary},
    totals:{leadership:troop.totalCapacity,dominance:monster.totalCapacity,authority:mercenary.totalCapacity}};
}

export function calculatePvpUnknownStack({troops,monsters,mercenaries,selectedIds,inputs}){
  const enemy=unknownPvpEnemyModel({troops,monsters,mercenaries});
  return calculatePvpCpStack({
    troops,monsters,mercenaries,selectedIds,inputs,enemy,battleType:'pvp_unknown'
  });
}

export function calculatePvpUnknownCustomStack({troops,monsters,mercenaries,selectedIds,orders,unitOrders=null,inputs}){
  const enemy=unknownPvpEnemyModel({troops,monsters,mercenaries});
  return calculatePvpCustomStack({
    troops,monsters,mercenaries,selectedIds,orders,unitOrders,inputs,enemy,battleType:'pvp_unknown'
  });
}

export function calculateBattleCategory({category,units,selectedIds,inputs,battleType='pvp_unknown'}){
  const cfg=CATEGORY_CONFIG[category],selected=selectedUnits(units,selectedIds);
  if(!selected.length)return categoryEmpty(category);
  const maxHealthEach=Math.max(...selected.map(u=>pvpEffectiveHealthEach(u,inputs))),limit=Number(inputs[cfg.capacityInput]||0),
    fill=Number(inputs[cfg.fillInput]||0),sep=Number(inputs.rankSeparation||0);
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
