import fs from 'node:fs';
import {calculateEpicStack} from '../js/epic-engine.mjs';
import {createLegacyHealthLadderSeed,optimizeEpicQuantities} from '../js/epic-quantity-optimizer.mjs';
import {scoreEpicArmy} from '../js/epic-combat-engine-v2.mjs';
import {adaptiveTierLatticeSearch,analyzeTierCompleteness,choosePracticalComposition,compositionSignature,createCompositionNeighborhood,createReviewTierStructures,inferReviewAvailability} from '../js/epic-composition-search.mjs';

const canonical=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const legacy=canonical.map(unit=>{
  const capacityField=unit.category==='troop'?'leadershipEach':unit.category==='monster'?'dominanceEach':'authorityEach';
  return{id:unit.id,unitId:unit.unitId,category:unit.category,displayOrder:unit.displayOrder,class:unit.unitClass,type:unit.combatType,name:unit.name,level:unit.tier,strengthEach:unit.baseStrength,healthEach:unit.baseHealth,[capacityField]:unit.capacityCost,species:unit.species,selectionKey:`${unit.tier}|${unit.combatType}`,icon:unit.icon,bonuses:{...(unit.bonuses||{})},goldRevivalCost:Number(unit.goldRevivalCost||0),silverRevivalCost:Number(unit.silverRevivalCost||0)};
});
const categories={troop:legacy.filter(unit=>unit.category==='troop'),monster:legacy.filter(unit=>unit.category==='monster'),mercenary:legacy.filter(unit=>unit.category==='mercenary')};
const byId=new Map(canonical.map(unit=>[unit.id,unit]));
const originalIds=canonical.filter(unit=>(unit.category==='troop'&&['G9','G8','G7','S9','S8','S7','E9','E8','E7'].includes(unit.tier))||(unit.category==='monster'&&['M9','M8','M7'].includes(unit.tier))).map(unit=>unit.id);

const cases=[
  {name:'Doomsday',bonuses:{monsterHealthPct:1637.5,monsterStrengthPct:2032,strengthAgainstEpicPct:3877,monsterDDPct:12,monsterSTPct:18,arachne:false,enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED'],includeMercenariesInOptimization:false,useCustomFamilyBonuses:false},capacityLimits:{LEADERSHIP:407_082,DOMINANCE:76_212,AUTHORITY:0}},
  {name:'Arachne',bonuses:{monsterHealthPct:2438.5,monsterStrengthPct:5300.5,strengthAgainstEpicPct:6181,monsterDDPct:32,monsterSTPct:30,arachne:true,enemySquadTypes:['FLYING','FLYING','MOUNTED','MOUNTED','MELEE','MELEE','RANGED','RANGED'],includeMercenariesInOptimization:false,useCustomFamilyBonuses:false},capacityLimits:{LEADERSHIP:1_326_786,DOMINANCE:270_245,AUTHORITY:0}}
];

function engineInputs(testCase){
  const b=testCase.bonuses,c=testCase.capacityLimits;
  return{leadership:c.LEADERSHIP,leadershipFill:1,authority:0,authorityFill:0,dominance:c.DOMINANCE,dominanceFill:1,arachne:b.arachne,enemySquadTypes:b.enemySquadTypes,healthInputs:{MONSTER:b.monsterHealthPct,HUMAN:b.monsterHealthPct-100,EPIC_HUNTER:b.monsterHealthPct-741},monsterStrengthPct:b.monsterStrengthPct,strengthAgainstEpicPct:b.strengthAgainstEpicPct,humanStrengthPct:b.monsterStrengthPct-100,epicHunterStrengthPct:b.monsterStrengthPct-741,monsterDDPct:b.monsterDDPct,humanDDPct:b.monsterDDPct,epicHunterDDPct:b.monsterDDPct,monsterSTPct:b.monsterSTPct,humanSTPct:Math.max(0,b.monsterSTPct-5),epicHunterSTPct:Math.max(0,b.monsterSTPct-5),minimumSeparation:true,rankSeparation:.0005,layerSeparation:.0005};
}
function selectedByCategory(ids){return{troop:ids.filter(id=>byId.get(id)?.category==='troop'),monster:ids.filter(id=>byId.get(id)?.category==='monster'),mercenary:ids.filter(id=>byId.get(id)?.category==='mercenary')};}
function standardEvaluate(ids,testCase){
  const selectedIds=selectedByCategory(ids);
  const stack=calculateEpicStack({troops:categories.troop,monsters:categories.monster,mercenaries:categories.mercenary,selectedIds,inputs:engineInputs(testCase)});
  const quantities={};
  for(const category of Object.values(stack.categories))for(const row of category.results)quantities[row.id]=row.qty;
  return{selectedIds:ids,quantities,result:scoreEpicArmy({units:canonical,quantities,bonuses:testCase.bonuses})};
}
function optimizeReviewEvaluate(ids,testCase){
  const quantities=createLegacyHealthLadderSeed({units:canonical,selectedIds:ids,bonuses:testCase.bonuses,capacityLimits:testCase.capacityLimits,separationPct:.05});
  return{selectedIds:ids,quantities,result:scoreEpicArmy({units:canonical,quantities,bonuses:testCase.bonuses})};
}
function optimizeIntermediate(candidate,testCase){
  const optimized=optimizeEpicQuantities({units:canonical,selectedIds:candidate.selectedIds,bonuses:testCase.bonuses,capacityLimits:testCase.capacityLimits,initialQuantities:candidate.quantities,minimumHealthSeparationPct:.01,minimumQuantity:1,stageFractions:[.02,.005,.001],maxRoundsPerStage:3});
  return{selectedIds:candidate.selectedIds,quantities:optimized.quantities,result:optimized.result};
}
function optimizeStrongerIntermediate(candidate,testCase){
  const optimized=optimizeEpicQuantities({units:canonical,selectedIds:candidate.selectedIds,bonuses:testCase.bonuses,capacityLimits:testCase.capacityLimits,initialQuantities:candidate.quantities,minimumHealthSeparationPct:.01,minimumQuantity:1,stageFractions:[.05,.02,.01,.005,.002,.001,.0005],maxRoundsPerStage:8});
  return{selectedIds:candidate.selectedIds,quantities:optimized.quantities,result:optimized.result};
}
function tierSummary(ids){return[...new Set(ids.map(id=>byId.get(id)?.tier).filter(Boolean))].sort();}
function differences(from,to){const a=new Set(from),b=new Set(to);return{added:to.filter(id=>!a.has(id)),removed:from.filter(id=>!b.has(id))};}
function retainBest(map,row,limit){
  const signature=compositionSignature(row.selectedIds),previous=map.get(signature);
  if(!previous||row.result.expectedTotalLifetimeDamage>previous.result.expectedTotalLifetimeDamage)map.set(signature,row);
  if(map.size<=limit)return;
  const keep=[...map.values()].sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage).slice(0,limit);
  map.clear();for(const candidate of keep)map.set(compositionSignature(candidate.selectedIds),candidate);
}
async function tierScreen(testCase,evaluate){
  return adaptiveTierLatticeSearch({structures,currentIds:originalIds,beamWidth:16,maxEvaluations:250,evaluateSelection:async ids=>evaluate(ids,testCase)});
}
function neighborhoodScreen(testCase,parents,evaluate,limit=64){
  const retained=new Map();
  for(const parent of parents.slice(0,8)){
    retainBest(retained,parent,limit);
    for(const ids of createCompositionNeighborhood({selectedIds:parent.selectedIds,candidateIds:availability.availableIds}))retainBest(retained,evaluate(ids,testCase),limit);
  }
  return[...retained.values()].sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage);
}

const availability=inferReviewAvailability({units:canonical,selectedIds:originalIds});
const structures=createReviewTierStructures({units:canonical,availableIds:availability.availableIds});
const report=[];
for(const testCase of cases){
  console.error(`[review] ${testCase.name}: Standard tier screen (${structures.length})`);
  const standardSearch=await tierScreen(testCase,standardEvaluate);
  const standardTier=standardSearch.results;
  const standardNeighborhood=neighborhoodScreen(testCase,standardTier,standardEvaluate);
  const standardCurrent=standardEvaluate(originalIds,testCase);
  const standardCandidates=[standardCurrent,...standardNeighborhood].map(row=>({...row,selectionChanges:differences(originalIds,row.selectedIds).added.length+differences(originalIds,row.selectedIds).removed.length}));
  const standardDecision=choosePracticalComposition(standardCandidates,{units:canonical,availableIds:availability.availableIds});

  console.error(`[review] ${testCase.name}: Optimize quick tier screen (${structures.length})`);
  const optimizeSearch=await tierScreen(testCase,optimizeReviewEvaluate);
  const optimizeTier=optimizeSearch.results;
  const optimizeNeighborhood=neighborhoodScreen(testCase,optimizeTier,optimizeReviewEvaluate);
  const optimizePromotion=[...new Map([...optimizeNeighborhood.slice(0,8),...optimizeTier.slice(0,4)].map(row=>[compositionSignature(row.selectedIds),row])).values()];
  const optimizeShortlist=[];
  for(const [index,candidate] of optimizePromotion.entries()){
    if(index%8===0)console.error(`[review] ${testCase.name}: Optimize intermediate ${index+1}/${optimizePromotion.length}`);
    optimizeShortlist.push(optimizeIntermediate(candidate,testCase));
  }
  optimizeShortlist.sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage);
  const completeCandidates=optimizeShortlist.filter(candidate=>analyzeTierCompleteness({selectedIds:candidate.selectedIds,availableIds:availability.availableIds,units:canonical}).partialTierGroups===0);
  const optimizeSurvivors=[...new Map([...optimizeShortlist.slice(0,4),...completeCandidates.slice(0,2)].map(row=>[compositionSignature(row.selectedIds),row])).values()].slice(0,6);
  const optimizeIntermediateCandidates=optimizeSurvivors.map(candidate=>optimizeStrongerIntermediate(candidate,testCase));
  const optimizeCurrent=optimizeIntermediate(optimizeReviewEvaluate(originalIds,testCase),testCase);
  const optimizeCandidates=[optimizeCurrent,...optimizeIntermediateCandidates].map(row=>({...row,selectionChanges:differences(originalIds,row.selectedIds).added.length+differences(originalIds,row.selectedIds).removed.length}));
  const optimizeDecision=choosePracticalComposition(optimizeCandidates,{units:canonical,availableIds:availability.availableIds});

  const summarize=(decision,current)=>({currentEld:current.result.expectedTotalLifetimeDamage,recommendedEld:decision.chosen.eld,estimatedImprovementPct:(decision.chosen.eld/current.result.expectedTotalLifetimeDamage-1)*100,tiers:tierSummary(decision.chosen.selectedIds),selectedUnits:decision.chosen.selectedIds.length,partialTierGroups:decision.chosen.partialTierGroups,selectionChanges:decision.chosen.selectionChanges,differences:differences(originalIds,decision.chosen.selectedIds)});
  const standard=summarize(standardDecision,standardCurrent);
  const optimize=summarize(optimizeDecision,optimizeCurrent);
  report.push({encounter:testCase.name,availability:{originalUnits:originalIds.length,inferredUnits:availability.availableIds.length,totalTierStructures:structures.length},search:{standardTierEvaluations:standardSearch.evaluations,standardTierRounds:standardSearch.rounds,optimizeTierEvaluations:optimizeSearch.evaluations,optimizeTierRounds:optimizeSearch.rounds,optimizeShortCandidates:optimizePromotion.length,optimizeStrongerCandidates:optimizeSurvivors.length},methods:{standard,customOrderDefault:{...standard,matchesStandard:true},optimizeQuickReview:optimize}});
}

if(report.some(row=>!row.methods.customOrderDefault.matchesStandard))throw new Error('Untouched Custom Order review must match Standard.');
for(const row of report){
  if(row.availability.inferredUnits!==93)throw new Error(`${row.encounter} must infer the complete 93-unit troop and monster availability pool.`);
  if(row.methods.optimizeQuickReview.selectedUnits!==30||row.methods.optimizeQuickReview.partialTierGroups!==0)throw new Error(`${row.encounter} Optimize review must recommend the complete 30-unit G8-G9/S8-S9/E8-E9/M7-M9 structure.`);
  if(!row.methods.optimizeQuickReview.tiers.includes('E8'))throw new Error(`${row.encounter} Optimize review must retain E8 after intermediate refinement.`);
}
console.log(JSON.stringify({generatedAt:new Date().toISOString(),purpose:'Offline Review Selection method comparison. Optimize uses broad deterministic screening plus bounded intermediate refinement, not a full quantity optimization.',cases:report},null,2));
