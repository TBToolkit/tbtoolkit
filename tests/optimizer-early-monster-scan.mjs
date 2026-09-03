import fs from 'node:fs';
import {createLegacyHealthLadderSeed} from '../js/epic-quantity-optimizer.mjs';
import {scoreEpicArmy} from '../js/epic-combat-engine-v2.mjs';

const army=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const byId=new Map(army.map(unit=>[unit.id,unit]));
const tierSets=[
  ['G9','G8','S9','S8','E9','E8','M9','M8','M7'],
  ['G9','G8','G7','S9','S8','S7','E9','E8','M9','M8','M7'],
  ['G9','S9','E9','M9','M8','M7'],
  ['G8','G7','S8','S7','E8','E7','M8','M7'],
];
const encounters=[
  {name:'Doomsday',arachne:false,enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED']},
  {name:'Arachne',arachne:true,enemySquadTypes:['FLYING','FLYING','MOUNTED','MOUNTED','MELEE','MELEE','RANGED','RANGED']},
];
const bonusProfiles=[
  {monsterHealthPct:1600,monsterStrengthPct:2000,strengthAgainstEpicPct:2000,monsterDDPct:10,monsterSTPct:10},
  {monsterHealthPct:1637.5,monsterStrengthPct:2032,strengthAgainstEpicPct:3877,monsterDDPct:12,monsterSTPct:18},
  {monsterHealthPct:2438.5,monsterStrengthPct:5300.5,strengthAgainstEpicPct:6181,monsterDDPct:32,monsterSTPct:30},
];
const capacityProfiles=[
  {LEADERSHIP:407_082,DOMINANCE:76_212,AUTHORITY:0},
  {LEADERSHIP:700_000,DOMINANCE:160_000,AUTHORITY:0},
  {LEADERSHIP:1_326_786,DOMINANCE:270_245,AUTHORITY:0},
];
const separations=[.03,.05,.10,.20,.40,.80];

function classify(result,enemyCount){
  const rows=[...(result.squads??[])].sort((a,b)=>a.predictedDeathPosition-b.predictedDeathPosition);
  const earlyMonsters=rows.filter(row=>byId.get(row.id)?.category==='monster'&&row.predictedDeathPosition<=enemyCount);
  const laterCombatTroops=rows.filter(row=>{
    const unit=byId.get(row.id);
    return unit?.category==='troop'&&unit.capacityType==='LEADERSHIP'&&String(unit.combatType).toUpperCase()!=='SIEGE'&&row.predictedDeathPosition>enemyCount;
  });
  return {rows,earlyMonsters,laterCombatTroops,anomalous:earlyMonsters.length>0&&laterCombatTroops.length>0};
}

const scenarios=[];
for(const encounter of encounters)for(const tiers of tierSets)for(const profile of bonusProfiles)for(const capacityLimits of capacityProfiles){
  const selectedIds=army.filter(unit=>tiers.includes(unit.tier)).map(unit=>unit.id);
  const bonuses={...profile,...encounter,includeMercenariesInOptimization:false,useCustomFamilyBonuses:false};
  const candidates=separations.map(separationPct=>{
    const quantities=createLegacyHealthLadderSeed({units:army,selectedIds,bonuses,capacityLimits,separationPct});
    const result=scoreEpicArmy({units:army,quantities,bonuses});
    return {separationPct,quantities,result,...classify(result,encounter.enemySquadTypes.length)};
  });
  const champion=candidates.reduce((best,row)=>row.result.expectedTotalLifetimeDamage>best.result.expectedTotalLifetimeDamage?row:best,candidates[0]);
  if(!champion.anomalous)continue;
  const maximumEld=champion.result.expectedTotalLifetimeDamage;
  const eligible=candidates.filter(row=>(maximumEld-row.result.expectedTotalLifetimeDamage)/maximumEld*100<=.25+1e-9);
  eligible.sort((a,b)=>a.earlyMonsters.length-b.earlyMonsters.length||b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage);
  const protectedCandidate=eligible[0];
  scenarios.push({
    encounter:encounter.name,tiers,bonusProfile:profile,capacityLimits,
    champion:{separationPct:champion.separationPct,eld:maximumEld,earlyMonsters:champion.earlyMonsters.map(row=>({name:row.name,death:row.predictedDeathPosition})),laterTroops:champion.laterCombatTroops.length},
    protectedCandidate:{separationPct:protectedCandidate.separationPct,eld:protectedCandidate.result.expectedTotalLifetimeDamage,lossPct:(maximumEld-protectedCandidate.result.expectedTotalLifetimeDamage)/maximumEld*100,earlyMonsters:protectedCandidate.earlyMonsters.map(row=>({name:row.name,death:row.predictedDeathPosition})),laterTroops:protectedCandidate.laterCombatTroops.length}
  });
}

scenarios.sort((a,b)=>a.protectedCandidate.earlyMonsters.length-b.protectedCandidate.earlyMonsters.length||a.protectedCandidate.lossPct-b.protectedCandidate.lossPct);
console.log(JSON.stringify({
  generatedAt:new Date().toISOString(),evaluatedScenarios:encounters.length*tierSets.length*bonusProfiles.length*capacityProfiles.length,
  seedCandidatesPerScenario:separations.length,anomalousScenarios:scenarios.length,
  fullyProtectedWithinQuarterPercent:scenarios.filter(row=>row.protectedCandidate.earlyMonsters.length===0).length,
  bestFixtures:scenarios.slice(0,12)
},null,2));
