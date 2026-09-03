import fs from 'node:fs';
import {optimizeEpicQuantities} from '../js/epic-quantity-optimizer.mjs';

const army=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const byId=new Map(army.map(unit=>[unit.id,unit]));
const caseName=String(process.argv[2]??'arachne').toLowerCase();
if(!['arachne','doomsday','early-monster','lower-doomsday','lower-arachne'].includes(caseName))throw new Error('Unknown offline case.');
const isArachne=['arachne','lower-arachne'].includes(caseName);
const isLower=caseName.startsWith('lower-');
const selectedIds=army.filter(unit=>{
  const tiers=isLower?['G8','G7','S8','S7','E8','E7','M8','M7']:isArachne?['G9','G8','S9','S8','E9','M9','M8']:['G9','G8','S9','S8','E9','E8','M9','M8','M7'];
  if(!tiers.includes(unit.tier))return false;
  return !isArachne||unit.tier!=='M7'||unit.id!=='monster-m7-flying-black-dragon';
}).map(unit=>unit.id);
const bonuses=isLower?{
  monsterHealthPct:1800,monsterStrengthPct:2600,strengthAgainstEpicPct:3200,monsterDDPct:15,monsterSTPct:15,arachne:isArachne,
  enemySquadTypes:isArachne?['FLYING','FLYING','MOUNTED','MOUNTED','MELEE','MELEE','RANGED','RANGED']:['FLYING','MOUNTED','MELEE','RANGED'],
  includeMercenariesInOptimization:false,useCustomFamilyBonuses:false
}:isArachne?{
  monsterHealthPct:2438.5,monsterStrengthPct:5300.5,strengthAgainstEpicPct:6181,monsterDDPct:32,monsterSTPct:30,arachne:true,
  enemySquadTypes:['FLYING','FLYING','MOUNTED','MOUNTED','MELEE','MELEE','RANGED','RANGED'],
  includeMercenariesInOptimization:false,useCustomFamilyBonuses:false
}:caseName==='early-monster'?{
  monsterHealthPct:1600,monsterStrengthPct:2000,strengthAgainstEpicPct:2000,monsterDDPct:10,monsterSTPct:10,arachne:false,
  enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED'],includeMercenariesInOptimization:false,useCustomFamilyBonuses:false
}:{
  monsterHealthPct:1637.5,monsterStrengthPct:2032,strengthAgainstEpicPct:3877,monsterDDPct:12,monsterSTPct:18,arachne:false,
  enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED'],includeMercenariesInOptimization:false,useCustomFamilyBonuses:false
};
const capacityLimits=isLower?{LEADERSHIP:700_000,DOMINANCE:160_000,AUTHORITY:0}:isArachne?{LEADERSHIP:1_326_786,DOMINANCE:270_245,AUTHORITY:0}:caseName==='early-monster'?{LEADERSHIP:700_000,DOMINANCE:160_000,AUTHORITY:0}:{LEADERSHIP:407_082,DOMINANCE:76_212,AUTHORITY:62_628};
const practicalEligibleCategories=caseName==='early-monster'?['monster']:['troop'];
const practicalEligibleTierPrefixes=caseName==='early-monster'?null:['G','S'];

console.error(`[conventional-order] optimizing ${caseName} case`);
const optimized=optimizeEpicQuantities({
  units:army,selectedIds,bonuses,capacityLimits,minimumHealthSeparationPct:.01,minimumQuantity:1,
  practicalEligibleCategories,practicalEligibleTierPrefixes,practicalTolerancePct:0,collectPracticalCandidates:true,
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
    .filter(row=>['G','S'].includes(String(byId.get(row.id)?.tier??'').slice(0,1)))
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
function earlyMonsterSummary(result){
  const enemyCount=bonuses.enemySquadTypes.length;
  const rows=[...(result.squads??[])].sort((a,b)=>a.predictedDeathPosition-b.predictedDeathPosition);
  const earlyMonsters=rows.filter(row=>byId.get(row.id)?.category==='monster'&&row.predictedDeathPosition<=enemyCount);
  const laterCombatTroops=rows.filter(row=>{
    const unit=byId.get(row.id);
    return unit?.category==='troop'&&String(unit.combatType).toUpperCase()!=='SIEGE'&&row.predictedDeathPosition>enemyCount;
  });
  return {earlyMonsters:earlyMonsters.map(row=>({name:row.name,death:row.predictedDeathPosition})),laterCombatTroops:laterCombatTroops.length};
}

const thresholds=[.1,.25,.5,1].map(tolerancePct=>{
  const eligible=candidates.filter(candidate=>candidate.lossPct<=tolerancePct+1e-9);
  eligible.sort((a,b)=>{
    if(caseName==='early-monster'){
      const monsterDelta=earlyMonsterSummary(a.result).earlyMonsters.length-earlyMonsterSummary(b.result).earlyMonsters.length;
      if(monsterDelta)return monsterDelta;
    }
    return a.conventionality.penalty-b.conventionality.penalty||a.conventionality.severeInversions-b.conventionality.severeInversions||b.eld-a.eld;
  });
  const chosen=eligible[0]??maximum;
  return {tolerancePct,eligibleCandidates:eligible.length,chosenLossPct:chosen.lossPct,conventionality:chosen.conventionality,eld:chosen.eld,...earlyMonsterSummary(chosen.result),troopOpening:troopOpening(chosen.result)};
});

const report={
  generatedAt:new Date().toISOString(),
  scope:'Troop death-order conventionality only; monsters and mercenaries are excluded from the practical score.',
  inputs:{encounter:isArachne?'Arachne':'Doomsday',caseName,selectedUnits:selectedIds.length,capacityLimits,bonuses},
  candidateCount:candidates.length,
  mathematicalMaximum:{eld:maximum.eld,conventionality:maximum.conventionality,...earlyMonsterSummary(maximum.result),troopOpening:troopOpening(maximum.result)},
  candidates:candidates.map(candidate=>({eld:candidate.eld,lossPct:candidate.lossPct,conventionality:candidate.conventionality,...earlyMonsterSummary(candidate.result),troopOpening:troopOpening(candidate.result)})),
  thresholds
};
if(process.argv.includes('--compact')){
  console.log(JSON.stringify({
    inputs:report.inputs,candidateCount:report.candidateCount,
    mathematicalMaximum:{eld:maximum.eld,conventionality:maximum.conventionality,...earlyMonsterSummary(maximum.result),troopOpening:troopOpening(maximum.result).slice(0,4)},
    thresholds:thresholds.map(row=>({tolerancePct:row.tolerancePct,eligibleCandidates:row.eligibleCandidates,chosenLossPct:row.chosenLossPct,conventionality:row.conventionality,troopOpening:row.troopOpening.slice(0,4)}))
  },null,2));
}else console.log(JSON.stringify(report,null,2));
