import fs from 'node:fs';
import {optimizeEpicQuantities} from '../js/epic-quantity-optimizer.mjs';

const army=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const byId=new Map(army.map(unit=>[unit.id,unit]));
const bonuses={
  monsterHealthPct:1637.5,monsterStrengthPct:2032,strengthAgainstEpicPct:3877,
  monsterDDPct:12,monsterSTPct:18,arachne:false,
  enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED'],
  includeMercenariesInOptimization:false,useCustomFamilyBonuses:false
};
const capacityLimits={LEADERSHIP:407_082,DOMINANCE:76_212,AUTHORITY:0};
const candidatePool=army.filter(unit=>
  (unit.category==='troop'&&['G9','G8','G7','S9','S8','S7','E9','E8','E7'].includes(unit.tier))||
  (unit.category==='monster'&&['M9','M8','M7'].includes(unit.tier))
).map(unit=>unit.id);

const withoutTierSevenTroops=candidatePool.filter(id=>{
  const unit=byId.get(id);
  return !(unit.category==='troop'&&Number(unit.tierNumber)===7);
});
const finalists=[
  {
    name:'user-manual-black-dragon-excluded',
    selectedIds:withoutTierSevenTroops.filter(id=>id!=='monster-m7-flying-black-dragon')
  },
  {
    name:'screen-alternative-wind-lord-excluded',
    selectedIds:withoutTierSevenTroops.filter(id=>id!=='monster-m7-melee-wind-lord')
  }
];

const output=[];
for(const finalist of finalists){
  const started=performance.now();
  let lastPhase='';
  const optimized=optimizeEpicQuantities({
    units:army,selectedIds:finalist.selectedIds,bonuses,capacityLimits,
    minimumHealthSeparationPct:.01,minimumQuantity:1,
    onProgress:progress=>{
      if(progress.phase===lastPhase)return;
      lastPhase=progress.phase;
      console.error(`[${finalist.name}] ${progress.phase}`);
    }
  });
  const elapsedMs=performance.now()-started;
  const quantities=optimized.quantities??{};
  const quantityFingerprint=Object.keys(quantities).sort().map(name=>`${name}:${quantities[name]}`).join('|');
  const row={
    name:finalist.name,
    selectedUnits:finalist.selectedIds.length,
    excluded:candidatePool.filter(id=>!finalist.selectedIds.includes(id)).map(id=>({id,name:byId.get(id)?.name,tier:byId.get(id)?.tier})),
    expectedLifetimeDamage:Number(optimized.result?.expectedTotalLifetimeDamage||0),
    squads:Number(optimized.result?.squads?.length||0),
    elapsedMs,
    quantityFingerprint,
    diagnostics:optimized.diagnostics
  };
  output.push(row);
  console.error(`[${finalist.name}] complete: ${row.expectedLifetimeDamage} ELD in ${(elapsedMs/1000).toFixed(1)}s`);
}

output.sort((a,b)=>b.expectedLifetimeDamage-a.expectedLifetimeDamage);
console.log(JSON.stringify({
  inputs:{bonuses,capacityLimits,candidateUnits:candidatePool.length},
  winner:output[0]?.name,
  eldDifference:Number(output[0]?.expectedLifetimeDamage||0)-Number(output[1]?.expectedLifetimeDamage||0),
  finalists:output
},null,2));
