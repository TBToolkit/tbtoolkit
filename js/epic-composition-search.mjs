const DEFAULT_POLICY=Object.freeze({
  practicalTiePct:.05,
  minimumProposalImprovementPct:.05,
  microCapacitySharePct:.05,
  microDamageSharePct:.05,
  preferCompleteTiers:true
});

function finite(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function sortedUnique(values){return [...new Set(values??[])].sort();}
function pctChange(from,to){return from>0?(to/from-1)*100:(to>0?Infinity:0);}

export function compositionSignature(ids){return sortedUnique(ids).join('|');}

function reviewGroupKey(unit){
  if(unit?.category==='monster')return`monster|${unit.tier}`;
  if(unit?.category==='troop')return`troop|${String(unit.unitClass??'').toUpperCase()}|${unit.tier}`;
  return null;
}

export function inferReviewAvailability({units,selectedIds}){
  const rows=units??[],byId=new Map(rows.map(unit=>[unit.id,unit]));
  const selected=sortedUnique(selectedIds).filter(id=>byId.has(id)),selectedSet=new Set(selected);
  const available=new Set(selected);
  const unlockFamilies=['GUARDSMAN','SPECIALIST','ENGINEER'];
  for(const unitClass of unlockFamilies){
    const selectedFamily=selected.map(id=>byId.get(id)).filter(unit=>unit?.category==='troop'&&String(unit.unitClass).toUpperCase()===unitClass);
    if(!selectedFamily.length)continue;
    const highestTier=Math.max(...selectedFamily.map(unit=>finite(unit.tierNumber)));
    for(const unit of rows){
      if(unit.category!=='troop'||String(unit.unitClass).toUpperCase()!==unitClass)continue;
      const tier=finite(unit.tierNumber);
      if(tier<highestTier||(tier===highestTier&&(unitClass==='ENGINEER'||selectedSet.has(unit.id))))available.add(unit.id);
    }
  }
  const selectedMonsters=selected.map(id=>byId.get(id)).filter(unit=>unit?.category==='monster');
  if(selectedMonsters.length){
    const highestTier=Math.max(...selectedMonsters.map(unit=>finite(unit.tierNumber)));
    for(const unit of rows)if(unit.category==='monster'&&finite(unit.tierNumber)<=highestTier)available.add(unit.id);
  }
  // Mercenary ownership cannot be inferred. Only explicitly selected mercenaries
  // enter the available pool (already added above).
  return{selectedIds:selected,availableIds:sortedUnique([...available])};
}

export function analyzeTierCompleteness({selectedIds,availableIds,units}){
  const selected=new Set(selectedIds??[]),available=new Set(availableIds??[]),groups=new Map();
  for(const unit of units??[]){
    if(!available.has(unit.id))continue;
    const key=reviewGroupKey(unit);if(!key)continue;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(unit.id);
  }
  let completeTierGroups=0,partialTierGroups=0,incompleteUnits=0;
  const tierGroups=[];
  for(const [key,ids] of groups){
    const selectedCount=ids.filter(id=>selected.has(id)).length;
    if(!selectedCount)continue;
    const complete=selectedCount===ids.length;
    if(complete)completeTierGroups++;else{partialTierGroups++;incompleteUnits+=ids.length-selectedCount;}
    tierGroups.push({key,availableUnits:ids.length,selectedUnits:selectedCount,complete});
  }
  return{completeTierGroups,partialTierGroups,incompleteUnits,tierGroups};
}

export function analyzeCompositionCandidate(candidate,policy={}){
  const resolved={...DEFAULT_POLICY,...policy};
  const result=candidate?.result??{};
  const rows=(result.squads??[]).filter(row=>finite(row.quantity)>0);
  const totalDamage=Math.max(0,finite(result.expectedTotalLifetimeDamage));
  const capacities=result.capacities??{};
  let microSquads=0;
  const squadMetrics=rows.map(row=>{
    const capacityTotal=Math.max(0,finite(capacities[row.capacityType]));
    const capacitySharePct=capacityTotal>0?finite(row.capacityUsed)/capacityTotal*100:0;
    const damageSharePct=totalDamage>0?finite(row.expectedLifetimeDamage)/totalDamage*100:0;
    const micro=capacitySharePct<resolved.microCapacitySharePct&&damageSharePct<resolved.microDamageSharePct;
    if(micro)microSquads++;
    return{id:row.id,name:row.name,quantity:finite(row.quantity),capacitySharePct,damageSharePct,micro};
  });
  const tierCompleteness=resolved.preferCompleteTiers&&resolved.units&&resolved.availableIds
    ?analyzeTierCompleteness({selectedIds:candidate?.selectedIds??rows.map(row=>row.id),availableIds:resolved.availableIds,units:resolved.units})
    :{completeTierGroups:0,partialTierGroups:0,incompleteUnits:0,tierGroups:[]};
  return{
    ...candidate,
    eld:totalDamage,
    selectedIds:sortedUnique(candidate?.selectedIds??rows.map(row=>row.id)),
    squadCount:rows.length,
    microSquads,
    squadMetrics,
    ...tierCompleteness
  };
}

export function choosePracticalComposition(candidates,policy={}){
  const resolved={...DEFAULT_POLICY,...policy};
  const analyzed=(candidates??[]).map(candidate=>analyzeCompositionCandidate(candidate,resolved)).filter(candidate=>candidate.eld>0);
  if(!analyzed.length)return null;
  const maximum=analyzed.reduce((best,candidate)=>candidate.eld>best.eld?candidate:best,analyzed[0]);
  const eligible=analyzed.filter(candidate=>(maximum.eld-candidate.eld)/maximum.eld*100<=resolved.practicalTiePct+1e-9);
  eligible.sort((a,b)=>
    a.microSquads-b.microSquads||
    a.partialTierGroups-b.partialTierGroups||
    a.incompleteUnits-b.incompleteUnits||
    finite(a.selectionChanges)-finite(b.selectionChanges)||
    a.squadCount-b.squadCount||
    b.eld-a.eld||
    compositionSignature(a.selectedIds).localeCompare(compositionSignature(b.selectedIds))
  );
  const chosen=eligible[0];
  return{
    chosen,
    mathematicalMaximum:maximum,
    eligibleCount:eligible.length,
    eldLossPct:(maximum.eld-chosen.eld)/maximum.eld*100,
    policy:resolved
  };
}

export function evaluateSelectionProposal({currentCandidate,proposedCandidate,policy={}}){
  const resolved={...DEFAULT_POLICY,...policy};
  const current=analyzeCompositionCandidate(currentCandidate,resolved);
  const proposed=analyzeCompositionCandidate(proposedCandidate,resolved);
  const improvementPct=pctChange(current.eld,proposed.eld);
  const currentIds=new Set(current.selectedIds),proposedIds=new Set(proposed.selectedIds);
  const excluded=current.selectedIds.filter(id=>!proposedIds.has(id));
  const added=proposed.selectedIds.filter(id=>!currentIds.has(id));
  return{
    shouldPrompt:Number.isFinite(improvementPct)&&improvementPct+1e-9>=resolved.minimumProposalImprovementPct&&(excluded.length>0||added.length>0),
    improvementPct,
    excluded,
    added,
    current,
    proposed,
    policy:resolved
  };
}

export async function exhaustiveCompositionSearch({candidateIds,mandatoryIds=[],evaluateSelection}){
  const candidates=sortedUnique(candidateIds),mandatory=new Set(mandatoryIds),optional=candidates.filter(id=>!mandatory.has(id));
  if(optional.length>20)throw new Error('Exhaustive composition search is limited to 20 optional units.');
  const results=[];
  const combinations=2**optional.length;
  for(let mask=0;mask<combinations;mask++){
    const selected=[...mandatory];
    for(let index=0;index<optional.length;index++)if(mask&(2**index))selected.push(optional[index]);
    if(!selected.length)continue;
    const result=await evaluateSelection(sortedUnique(selected));
    results.push({...result,selectedIds:sortedUnique(selected)});
  }
  return{results,evaluations:results.length};
}

export async function exhaustiveGroupCompositionSearch({groups,mandatoryIds=[],evaluateSelection}){
  const normalized=(groups??[]).map((group,index)=>({
    id:String(group?.id??index),
    unitIds:sortedUnique(group?.unitIds??[])
  })).filter(group=>group.unitIds.length);
  if(normalized.length>16)throw new Error('Exhaustive group composition search is limited to 16 optional groups.');
  const mandatory=sortedUnique(mandatoryIds),results=[];
  const combinations=2**normalized.length;
  for(let mask=1;mask<combinations;mask++){
    const selected=[...mandatory],selectedGroupIds=[];
    for(let index=0;index<normalized.length;index++){
      if(!(mask&(2**index)))continue;
      selectedGroupIds.push(normalized[index].id);
      selected.push(...normalized[index].unitIds);
    }
    const selectedIds=sortedUnique(selected);
    if(!selectedIds.length)continue;
    const evaluated=await evaluateSelection(selectedIds);
    results.push({...evaluated,selectedIds,selectedGroupIds:sortedUnique(selectedGroupIds)});
  }
  return{results,evaluations:results.length,groups:normalized.length};
}

export function createCompositionNeighborhood({selectedIds,candidateIds,mandatoryIds=[],allowAdd=true,allowRemove=true,allowSwap=true}){
  const selected=sortedUnique(selectedIds),candidates=sortedUnique(candidateIds),mandatory=new Set(mandatoryIds);
  const selectedSet=new Set(selected),available=candidates.filter(id=>!selectedSet.has(id));
  const neighbors=new Map();
  const add=ids=>{
    const normalized=sortedUnique(ids);
    if(normalized.length)neighbors.set(compositionSignature(normalized),normalized);
  };
  if(allowAdd)for(const added of available)add([...selected,added]);
  if(allowRemove)for(const removed of selected)if(!mandatory.has(removed))add(selected.filter(id=>id!==removed));
  if(allowSwap)for(const removed of selected){
    if(mandatory.has(removed))continue;
    for(const added of available)add([...selected.filter(id=>id!==removed),added]);
  }
  neighbors.delete(compositionSignature(selected));
  return[...neighbors.values()];
}

export async function boundedCompositionSearch({
  candidateIds,mandatoryIds=[],initialSelections=[],evaluateSelection,beamWidth=12,maxEvaluations=250
}){
  const candidates=sortedUnique(candidateIds),mandatory=new Set(mandatoryIds);
  const cache=new Map(),results=[];
  const evaluate=async ids=>{
    const selected=sortedUnique(ids),signature=compositionSignature(selected);
    if(cache.has(signature))return cache.get(signature);
    if(cache.size>=maxEvaluations)return null;
    const evaluated={...(await evaluateSelection(selected)),selectedIds:selected};
    cache.set(signature,evaluated);results.push(evaluated);return evaluated;
  };
  const full=await evaluate(candidates);
  if(!full)return{results,evaluations:0,depths:0};
  const seeded=[full];
  for(const ids of initialSelections){
    const valid=sortedUnique(ids).filter(id=>candidates.includes(id)||mandatory.has(id));
    for(const id of mandatory)if(!valid.includes(id))valid.push(id);
    if(!valid.length)continue;
    const seed=await evaluate(valid);
    if(seed)seeded.push(seed);
  }
  seeded.sort((a,b)=>finite(b?.result?.expectedTotalLifetimeDamage)-finite(a?.result?.expectedTotalLifetimeDamage)||compositionSignature(a.selectedIds).localeCompare(compositionSignature(b.selectedIds)));
  let frontier=[...new Map(seeded.map(candidate=>[compositionSignature(candidate.selectedIds),candidate])).values()].slice(0,Math.max(1,Math.floor(beamWidth))),depths=0;
  while(frontier.length&&cache.size<maxEvaluations){
    const next=[];
    for(const parent of frontier){
      for(const id of parent.selectedIds){
        if(mandatory.has(id))continue;
        const childIds=parent.selectedIds.filter(candidateId=>candidateId!==id);
        if(!childIds.length)continue;
        const child=await evaluate(childIds);
        if(child)next.push(child);
        if(cache.size>=maxEvaluations)break;
      }
      if(cache.size>=maxEvaluations)break;
    }
    if(!next.length)break;
    const unique=[...new Map(next.map(candidate=>[compositionSignature(candidate.selectedIds),candidate])).values()];
    unique.sort((a,b)=>finite(b?.result?.expectedTotalLifetimeDamage)-finite(a?.result?.expectedTotalLifetimeDamage)||compositionSignature(a.selectedIds).localeCompare(compositionSignature(b.selectedIds)));
    frontier=unique.slice(0,Math.max(1,Math.floor(beamWidth)));
    depths++;
  }
  return{results,evaluations:cache.size,depths};
}

export {DEFAULT_POLICY};
