import fs from 'node:fs';
import {boundedCompositionSearch,inferReviewAvailability} from '../js/epic-composition-search.mjs';
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
function names(ids){return ids.map(id=>byId.get(id).name);}

if(coreIds.length!==30)throw new Error(`Expected the validated 30-unit troop/monster base; found ${coreIds.length}.`);
if(mercenaryIds.length!==19)throw new Error(`Expected all 19 Tier II mercenaries; found ${mercenaryIds.length}.`);
const availability=inferReviewAvailability({units,selectedIds});
if(availability.mandatoryIds.length!==19)throw new Error('Every selected mercenary must be mandatory during Review Selection.');

console.error('[merc-review] Verifying that composition screening can change troops and monsters but never selected mercenaries.');
const search=await boundedCompositionSearch({candidateIds:selectedIds,mandatoryIds:availability.mandatoryIds,evaluateSelection:async ids=>quickEvaluate(ids),beamWidth:8,maxEvaluations:80});
if(!search.results.every(row=>mercenaryIds.every(id=>row.selectedIds.includes(id))))throw new Error('Review Selection removed a user-selected mercenary.');

const seed=quickEvaluate(selectedIds);
const optimized=optimizeEpicQuantities({units,selectedIds,bonuses,capacityLimits,initialQuantities:seed.quantities,minimumHealthSeparationPct:.01,minimumQuantity:1,stageFractions:[.02,.005,.001],maxRoundsPerStage:3});
const optimizedMercenaries=mercenaryIds.filter(id=>Number(optimized.quantities[byId.get(id).name]??optimized.quantities[id]??0)>0);
if(optimizedMercenaries.length!==19)throw new Error('Quantity optimization removed a user-selected mercenary type.');

console.log(JSON.stringify({
  generatedAt:new Date().toISOString(),
  purpose:'Offline Doomsday Review Selection invariant with mercenary quantity optimization enabled.',
  inputs:{capacityLimits,selectedMercenaries:names(mercenaryIds)},
  screening:{evaluations:search.evaluations,depths:search.depths,allSelectedMercenariesMandatory:true},
  optimizedArmy:{squads:selectedIds.length,eld:optimized.result.expectedTotalLifetimeDamage,mercenaries:names(optimizedMercenaries)}
},null,2));
