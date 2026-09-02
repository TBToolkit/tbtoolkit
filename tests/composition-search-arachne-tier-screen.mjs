import fs from 'node:fs';
import {createLegacyHealthLadderSeed} from '../js/epic-quantity-optimizer.mjs';
import {scoreEpicArmy} from '../js/epic-combat-engine-v2.mjs';
import {compositionSignature,exhaustiveGroupCompositionSearch} from '../js/epic-composition-search.mjs';

const army=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const bonuses={monsterHealthPct:2438.5,monsterStrengthPct:5300.5,strengthAgainstEpicPct:6181,monsterDDPct:32,monsterSTPct:30,arachne:true,enemySquadTypes:['FLYING','FLYING','MOUNTED','MOUNTED','MELEE','MELEE','RANGED','RANGED'],includeMercenariesInOptimization:false,useCustomFamilyBonuses:false};
const capacityLimits={LEADERSHIP:1_326_786,DOMINANCE:270_245,AUTHORITY:0};
const tiers=['G9','G8','G7','S9','S8','S7','E9','E8','E7','M9','M8','M7'];
const groups=tiers.map(tier=>({id:tier,unitIds:army.filter(unit=>unit.tier===tier).map(unit=>unit.id)}));
const candidateIds=groups.flatMap(group=>group.unitIds);
function evaluate(selectedIds){
  const quantities=createLegacyHealthLadderSeed({units:army,selectedIds,bonuses,capacityLimits,separationPct:.05});
  return{quantities,result:scoreEpicArmy({units:army,quantities,bonuses})};
}
const searched=await exhaustiveGroupCompositionSearch({groups,evaluateSelection:async ids=>evaluate(ids)});
const ranked=searched.results.sort((a,b)=>b.result.expectedTotalLifetimeDamage-a.result.expectedTotalLifetimeDamage);
// Benchmark only: this signature is never supplied to the search.
const benchmarkIds=candidateIds.filter(id=>!['G7','S7','E7'].includes(army.find(unit=>unit.id===id)?.tier));
const benchmarkRank=ranked.findIndex(row=>compositionSignature(row.selectedIds)===compositionSignature(benchmarkIds))+1;
console.log(JSON.stringify({evaluations:searched.evaluations,benchmarkRank,benchmarkScreenEld:ranked[benchmarkRank-1]?.result.expectedTotalLifetimeDamage,top:ranked.slice(0,20).map((row,index)=>({rank:index+1,tiers:row.selectedGroupIds,units:row.selectedIds.length,eld:row.result.expectedTotalLifetimeDamage}))},null,2));
