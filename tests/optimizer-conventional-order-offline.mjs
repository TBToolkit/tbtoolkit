import fs from 'node:fs';
import {optimizeEpicQuantities} from '../js/epic-quantity-optimizer.mjs';

const army=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const byId=new Map(army.map(unit=>[unit.id,unit]));
const selectedIds=army.filter(unit=>{
  if(['G9','G8','S9','S8','E9','M9','M8'].includes(unit.tier))return true;
  return unit.tier==='M7'&&unit.id!=='monster-m7-flying-black-dragon';
}).map(unit=>unit.id);
const bonuses={
  monsterHealthPct:2438.5,monsterStrengthPct:5300.5,strengthAgainstEpicPct:6181,
  monsterDDPct:32,monsterSTPct:30,arachne:true,
  enemySquadTypes:['FLYING','FLYING','MOUNTED','MOUNTED','MELEE','MELEE','RANGED','RANGED'],
  includeMercenariesInOptimization:false,useCustomFamilyBonuses:false
};
const capacityLimits={LEADERSHIP:1_326_786,DOMINANCE:270_245,AUTHORITY:0};

console.error('[conventional-order] optimizing supplied Arachne case');
const optimized=optimizeEpicQuantities({
  units:army,selectedIds,bonuses,capacityLimits,minimumHealthSeparationPct:.01,minimumQuantity:1,
  practicalEligibleCategories:['troop'],practicalTolerancePct:0,collectPracticalCandidates:true,
  onProgress:progress=>{
    if(progress.phase!==globalThis.lastPhase){globalThis.lastPhase=progress.phase;console.error(`[conventional-order] ${progress.phase}`);}
  }
});

const raw=optimized.diagnostics.practicalCandidates??[];
const candidates=[...new Map(raw.map(candidate=>[
  JSON.stringify(candidate.quantities),candidate
])).values()];
const maximum=candidates.reduce((best,candidate)=>candidate.eld>best.eld?candidate:best,candidates[0]);

function tierNumber(row){return Number((String(byId.get(row.id)?.tier??'').match(/\d+/)??[0])[0]);}
function conventionality(result){
  const rows=[...(result.squads??[])]
    .filter(row=>byId.get(row.id)?.category==='troop'&&String(row.combatType).toUpperCase()!=='SIEGE')
    .sort((a,b)=>a.predictedDeathPosition-b.predictedDeathPosition);
  const damageValues=rows.map(row=>Number(row.expectedDamagePerOpportunity||0)).filter(value=>value>0).sort((a,b)=>a-b);
  const median=damageValues[Math.floor(damageValues.length/2)]||1;
  const perceivedValue=row=>(Number(row.expectedDamagePerOpportunity||0)/median)*(1+.08*Math.max(0,tierNumber(row)-1));
  let penalty=0,inversions=0,severeInversions=0;
  for(let early=0;early<rows.length;early++)for(let late=early+1;late<rows.length;late++){
    const excess=perceivedValue(rows[early])-perceivedValue(rows[late]);
    if(excess<=.03)continue;
    const distance=late-early;
    penalty+=excess*(1+Math.log2(1+distance));
    inversions++;
    if(distance>=5&&excess>=.15)severeInversions++;
  }
  return {penalty,inversions,severeInversions};
}

for(const candidate of candidates)candidate.conventionality=conventionality(candidate.result);

function troopOpening(result){
  return [...(result.squads??[])]
    .filter(row=>byId.get(row.id)?.category==='troop')
    .sort((a,b)=>a.predictedDeathPosition-b.predictedDeathPosition)
    .slice(0,10)
    .map(row=>({name:row.name,tier:byId.get(row.id)?.tier,death:row.predictedDeathPosition,attacks:row.averageAttackOpportunities,damagePerOpportunity:row.expectedDamagePerOpportunity}));
}

const thresholds=[.1,.25,.5,1].map(tolerancePct=>{
  const eligible=candidates.filter(candidate=>candidate.lossPct<=tolerancePct+1e-9);
  eligible.sort((a,b)=>a.conventionality.penalty-b.conventionality.penalty||a.conventionality.severeInversions-b.conventionality.severeInversions||b.eld-a.eld);
  const chosen=eligible[0]??maximum;
  return {tolerancePct,eligibleCandidates:eligible.length,chosenLossPct:chosen.lossPct,conventionality:chosen.conventionality,eld:chosen.eld,troopOpening:troopOpening(chosen.result)};
});

console.log(JSON.stringify({
  generatedAt:new Date().toISOString(),
  scope:'Troop death-order conventionality only; monsters and mercenaries are excluded from the practical score.',
  inputs:{encounter:'Arachne',selectedUnits:selectedIds.length,capacityLimits,bonuses},
  candidateCount:candidates.length,
  mathematicalMaximum:{eld:maximum.eld,conventionality:maximum.conventionality,troopOpening:troopOpening(maximum.result)},
  candidates:candidates.map(candidate=>({eld:candidate.eld,lossPct:candidate.lossPct,conventionality:candidate.conventionality,troopOpening:troopOpening(candidate.result)})),
  thresholds
},null,2));
