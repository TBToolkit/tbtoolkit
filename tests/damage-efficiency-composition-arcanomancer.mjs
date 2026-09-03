import fs from 'node:fs';
import {inferReviewAvailability,createReviewTierStructures,createCompositionNeighborhood} from '../js/epic-composition-search.mjs';
import {createLegacyHealthLadderSeed,optimizeEpicQuantities} from '../js/epic-quantity-optimizer.mjs';
import {scoreEpicArmy} from '../js/epic-combat-engine-v2.mjs';

const units=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const byId=new Map(units.map(unit=>[unit.id,unit]));
const currentTiers=new Set(['G9','G8','S9','S8','E9','E8','M9','M8','M7']);
const currentIds=units.filter(unit=>currentTiers.has(unit.tier)).map(unit=>unit.id);
const bonuses={monsterHealthPct:2447.5,monsterStrengthPct:5312,strengthAgainstEpicPct:6189,monsterDDPct:32,monsterSTPct:30,arachne:false,enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED'],includeMercenariesInOptimization:false,useCustomFamilyBonuses:false};
const capacityLimits={LEADERSHIP:1_330_049,DOMINANCE:270_910,AUTHORITY:0};
const templeDivisor=5.91,revivableShare=.90;

function adjustedGold(quantities){
  return units.reduce((sum,unit)=>sum+Math.floor(Number(quantities[unit.name]??quantities[unit.id]??0)*revivableShare)*Number(unit.goldRevivalCost||0),0)/templeDivisor;
}
function evaluate(ids,quantities){
  const result=scoreEpicArmy({units,quantities,bonuses}),gold=adjustedGold(quantities);
  return{selectedIds:ids,quantities,result,eld:Number(result.expectedTotalLifetimeDamage||0),gold,efficiency:gold>0?Number(result.expectedTotalLifetimeDamage||0)/gold*1000:0};
}
function tiersOf(ids){return [...new Set(ids.map(id=>byId.get(id)?.tier).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));}
function signature(ids){return [...ids].sort().join('|');}
function chooseFrontier(candidates,maximumEld){
  return[99.5,99,98,97.5,95].map(floorPct=>{
    const eligible=candidates.filter(candidate=>candidate.eld>=maximumEld*floorPct/100);
    const best=[...eligible].sort((a,b)=>b.efficiency-a.efficiency||b.eld-a.eld)[0];
    return{floorPct,eligible:eligible.length,best};
  });
}
function summary(candidate,maximumEld){
  if(!candidate)return null;
  const candidateSet=new Set(candidate.selectedIds),currentSet=new Set(currentIds);
  return{tiers:tiersOf(candidate.selectedIds),squads:candidate.selectedIds.length,added:candidate.selectedIds.filter(id=>!currentSet.has(id)).map(id=>byId.get(id)?.name),removed:currentIds.filter(id=>!candidateSet.has(id)).map(id=>byId.get(id)?.name),eld:candidate.eld,eldPctOfMaximum:candidate.eld/maximumEld*100,gold:candidate.gold,efficiency:candidate.efficiency};
}

const availability=inferReviewAvailability({units,selectedIds:currentIds});
const structures=createReviewTierStructures({units,availableIds:availability.availableIds,mandatoryIds:availability.mandatoryIds});
const screened=[];
for(let index=0;index<structures.length;index++){
  const structure=structures[index];
  const quantities=createLegacyHealthLadderSeed({units,selectedIds:structure.selectedIds,bonuses,capacityLimits,separationPct:.05});
  const candidate=evaluate(structure.selectedIds,quantities);
  screened.push({...candidate,floors:structure.floors});
  if((index+1)%1000===0)console.error(`[efficiency-composition] screened ${index+1}/${structures.length}`);
}
const screenMaximum=Math.max(...screened.map(candidate=>candidate.eld));
const screenFrontier=chooseFrontier(screened,screenMaximum);
const promotion=new Map();
for(const candidate of [...screened].sort((a,b)=>b.eld-a.eld).slice(0,6))promotion.set(signature(candidate.selectedIds),candidate);
for(const row of screenFrontier){
  const eligible=screened.filter(candidate=>candidate.eld>=screenMaximum*row.floorPct/100).sort((a,b)=>b.efficiency-a.efficiency||b.eld-a.eld).slice(0,4);
  for(const candidate of eligible)promotion.set(signature(candidate.selectedIds),candidate);
}

const refined=[];
let refinedIndex=0;
for(const candidate of promotion.values()){
  refinedIndex++;
  console.error(`[efficiency-composition] refining ${refinedIndex}/${promotion.size} ${tiersOf(candidate.selectedIds).join(',')}`);
  try{
    const optimized=optimizeEpicQuantities({units,selectedIds:candidate.selectedIds,bonuses,capacityLimits,initialQuantities:candidate.quantities,minimumHealthSeparationPct:.01,minimumQuantity:1,stageFractions:[.02,.005,.001],maxRoundsPerStage:3});
    refined.push(evaluate(candidate.selectedIds,optimized.quantities));
  }catch(error){console.error(`[efficiency-composition] skipped candidate: ${error.message}`);}
}
const refinedMaximum=Math.max(...refined.map(candidate=>candidate.eld));
const refinedFrontier=chooseFrontier(refined,refinedMaximum);
const currentSeed=createLegacyHealthLadderSeed({units,selectedIds:currentIds,bonuses,capacityLimits,separationPct:.05});
const currentRefined=optimizeEpicQuantities({units,selectedIds:currentIds,bonuses,capacityLimits,initialQuantities:currentSeed,minimumHealthSeparationPct:.01,minimumQuantity:1,stageFractions:[.02,.005,.001],maxRoundsPerStage:3});
const currentCandidate=evaluate(currentIds,currentRefined.quantities);

const neighborhoodIds=createCompositionNeighborhood({selectedIds:currentIds,candidateIds:availability.availableIds,mandatoryIds:availability.mandatoryIds,allowAdd:true,allowRemove:true,allowSwap:true});
const neighborhood=[];
for(let index=0;index<neighborhoodIds.length;index++){
  const ids=neighborhoodIds[index],quantities=createLegacyHealthLadderSeed({units,selectedIds:ids,bonuses,capacityLimits,separationPct:.05});
  neighborhood.push(evaluate(ids,quantities));
  if((index+1)%500===0)console.error(`[efficiency-composition] neighborhood ${index+1}/${neighborhoodIds.length}`);
}
const currentScreen=evaluate(currentIds,currentSeed);
neighborhood.push(currentScreen);
const neighborhoodMaximum=Math.max(...neighborhood.map(candidate=>candidate.eld));
const neighborhoodFrontier=chooseFrontier(neighborhood,neighborhoodMaximum);
const neighborhoodPromotion=new Map();
for(const candidate of [...neighborhood].sort((a,b)=>b.eld-a.eld).slice(0,5))neighborhoodPromotion.set(signature(candidate.selectedIds),candidate);
for(const row of neighborhoodFrontier){
  const eligible=neighborhood.filter(candidate=>candidate.eld>=neighborhoodMaximum*row.floorPct/100).sort((a,b)=>b.efficiency-a.efficiency||b.eld-a.eld).slice(0,3);
  for(const candidate of eligible)neighborhoodPromotion.set(signature(candidate.selectedIds),candidate);
}
const neighborhoodRefined=[];
let neighborhoodRefinedIndex=0;
for(const candidate of neighborhoodPromotion.values()){
  neighborhoodRefinedIndex++;
  console.error(`[efficiency-composition] neighborhood refine ${neighborhoodRefinedIndex}/${neighborhoodPromotion.size} (${candidate.selectedIds.length} squads)`);
  try{
    const optimized=optimizeEpicQuantities({units,selectedIds:candidate.selectedIds,bonuses,capacityLimits,initialQuantities:candidate.quantities,minimumHealthSeparationPct:.01,minimumQuantity:1,stageFractions:[.02,.005,.001],maxRoundsPerStage:3});
    neighborhoodRefined.push(evaluate(candidate.selectedIds,optimized.quantities));
  }catch(error){console.error(`[efficiency-composition] skipped neighborhood candidate: ${error.message}`);}
}
const neighborhoodRefinedMaximum=Math.max(...neighborhoodRefined.map(candidate=>candidate.eld));
const neighborhoodRefinedFrontier=chooseFrontier(neighborhoodRefined,neighborhoodRefinedMaximum);

console.log(JSON.stringify({
  generatedAt:new Date().toISOString(),purpose:'Screen alternate available tier structures for near-maximum ELD and improved damage per Gold.',
  inputs:{encounter:'Arcanomancer',currentSquads:currentIds.length,availableUnits:availability.availableIds.length,tierStructures:structures.length,capacityLimits,bonuses,templeDivisor,revivableShare},
  screen:{maximumEld:screenMaximum,frontier:screenFrontier.map(row=>({floorPct:row.floorPct,eligible:row.eligible,best:summary(row.best,screenMaximum)}))},
  refinement:{promoted:promotion.size,completed:refined.length,maximumEld:refinedMaximum,currentSelection:summary(currentCandidate,refinedMaximum),frontier:refinedFrontier.map(row=>({floorPct:row.floorPct,eligible:row.eligible,best:summary(row.best,refinedMaximum)}))},
  unitNeighborhood:{screened:neighborhood.length,screenMaximumEld:neighborhoodMaximum,screenFrontier:neighborhoodFrontier.map(row=>({floorPct:row.floorPct,eligible:row.eligible,best:summary(row.best,neighborhoodMaximum)})),promoted:neighborhoodPromotion.size,refined:neighborhoodRefined.length,refinedMaximumEld:neighborhoodRefinedMaximum,refinedFrontier:neighborhoodRefinedFrontier.map(row=>({floorPct:row.floorPct,eligible:row.eligible,best:summary(row.best,neighborhoodRefinedMaximum)}))}
},null,2));
