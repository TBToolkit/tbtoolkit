import fs from 'node:fs';
import {boundedCompositionSearch,compositionSignature} from '../js/epic-composition-search.mjs';
import {createLegacyHealthLadderSeed,optimizeEpicQuantities} from '../js/epic-quantity-optimizer.mjs';
import {scoreEpicArmy} from '../js/epic-combat-engine-v2.mjs';

const units=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const byId=new Map(units.map(unit=>[unit.id,unit]));
const coreIds=units.filter(unit=>(unit.category==='troop'&&['G9','G8','S9','S8','E9','E8'].includes(unit.tier))||(unit.category==='monster'&&['M9','M8','M7'].includes(unit.tier))).map(unit=>unit.id);
const mercenaryIds=units.filter(unit=>unit.category==='mercenary'&&unit.tierNumber===2).map(unit=>unit.id);
const selectedIds=[...coreIds,...mercenaryIds];
const bonuses={monsterHealthPct:1637.5,monsterStrengthPct:2032,strengthAgainstEpicPct:3877,monsterDDPct:12,monsterSTPct:18,arachne:false,enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED'],includeMercenariesInOptimization:true,useCustomFamilyBonuses:false};
const capacityLimits={LEADERSHIP:407_082,DOMINANCE:76_212,AUTHORITY:62_628};

function quickEvaluate(ids){
  const quantities=createLegacyHealthLadderSeed({units,selectedIds:ids,bonuses,capacityLimits,separationPct:.05});
  return{selectedIds:ids,quantities,result:scoreEpicArmy({units,quantities,bonuses})};
}
function refine(candidate,{strong=false}={}){
  const optimized=optimizeEpicQuantities({
    units,selectedIds:candidate.selectedIds,bonuses,capacityLimits,initialQuantities:candidate.quantities,
    minimumHealthSeparationPct:.01,minimumQuantity:1,
    stageFractions:strong?[.05,.02,.01,.005,.002,.001,.0005]:[.02,.005,.001],
    maxRoundsPerStage:strong?8:3
  });
  return{selectedIds:candidate.selectedIds,quantities:optimized.quantities,result:optimized.result};
}
function mercenaryGroups(){
  const groups=new Map();
  for(const id of mercenaryIds){
    const tier=byId.get(id).tier;
    if(!groups.has(tier))groups.set(tier,[]);
    groups.get(tier).push(id);
  }
  return groups;
}
function names(ids){return ids.map(id=>byId.get(id).name);}

if(coreIds.length!==30)throw new Error(`Expected the validated 30-unit troop/monster base; found ${coreIds.length}.`);
if(mercenaryIds.length!==19)throw new Error(`Expected all 19 Tier II mercenaries; found ${mercenaryIds.length}.`);

const initialSelections=[coreIds];
for(const group of mercenaryGroups().values())initialSelections.push(selectedIds.filter(id=>!group.includes(id)));
console.error(`[merc-review] Broad removal search across ${mercenaryIds.length} explicitly available mercenaries.`);
const search=await boundedCompositionSearch({candidateIds:selectedIds,mandatoryIds:coreIds,initialSelections,evaluateSelection:async ids=>quickEvaluate(ids),beamWidth:16,maxEvaluations:350});
const rough=[...search.results].sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage);
const promotion=[...new Map([...rough.slice(0,12),quickEvaluate(selectedIds)].map(row=>[compositionSignature(row.selectedIds),row])).values()];
const intermediate=[];
for(const [index,candidate] of promotion.entries()){
  console.error(`[merc-review] Intermediate refinement ${index+1}/${promotion.length}.`);
  intermediate.push(refine(candidate));
}
intermediate.sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage);
const finalists=intermediate.slice(0,4).map(candidate=>refine(candidate,{strong:true})).sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage);
const allSelected=refine(refine(quickEvaluate(selectedIds)),{strong:true});
const winner=finalists[0];
const chosenMercenaries=winner.selectedIds.filter(id=>byId.get(id).category==='mercenary');
const removedMercenaries=mercenaryIds.filter(id=>!chosenMercenaries.includes(id));

if(!winner.selectedIds.every(id=>selectedIds.includes(id)))throw new Error('Review Selection added a mercenary that the user did not select.');
if(!coreIds.every(id=>winner.selectedIds.includes(id)))throw new Error('Mercenary screening removed a mandatory troop or monster.');
if(Object.keys(allSelected.quantities).filter(name=>mercenaryIds.includes(units.find(unit=>unit.name===name)?.id)).length!==19)throw new Error('Included mercenary optimization failed to retain quantities for the selected Tier II pool.');

console.log(JSON.stringify({
  generatedAt:new Date().toISOString(),
  purpose:'Offline Doomsday Review Selection benchmark with mercenary optimization enabled.',
  inputs:{capacityLimits,bonuses,availableMercenaries:names(mercenaryIds)},
  search:{evaluations:search.evaluations,depths:search.depths,intermediateCandidates:promotion.length,strongFinalists:finalists.length},
  allSelected:{squads:selectedIds.length,eld:allSelected.result.expectedTotalLifetimeDamage,mercenaries:names(mercenaryIds)},
  recommendation:{squads:winner.selectedIds.length,eld:winner.result.expectedTotalLifetimeDamage,improvementVsAllSelectedPct:(winner.result.expectedTotalLifetimeDamage/allSelected.result.expectedTotalLifetimeDamage-1)*100,mercenaries:names(chosenMercenaries),removedMercenaries:names(removedMercenaries)}
},null,2));
