import fs from 'node:fs';
import {optimizeEpicQuantities} from '../js/epic-quantity-optimizer.mjs';

const units=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const tiers=new Set(['G9','G8','S9','S8','E9','E8','M9','M8','M7']);
const selectedIds=units.filter(unit=>tiers.has(unit.tier)||unit.id==='troop-g7-flying-battle-griffin-7').map(unit=>unit.id);
const bonuses={monsterHealthPct:2447.5,monsterStrengthPct:5312,strengthAgainstEpicPct:6189,monsterDDPct:32,monsterSTPct:30,arachne:false,enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED'],includeMercenariesInOptimization:false,useCustomFamilyBonuses:false};
const capacityLimits={LEADERSHIP:1_330_049,DOMINANCE:270_910,AUTHORITY:0};
let lastPhase='';
const optimized=optimizeEpicQuantities({units,selectedIds,bonuses,capacityLimits,minimumHealthSeparationPct:.01,minimumQuantity:1,onProgress:progress=>{if(progress.phase!==lastPhase){lastPhase=progress.phase;console.error(`[griffin-full] ${lastPhase}`);}}});
const adjustedGold=(optimized.result.squads||[]).reduce((sum,squad)=>{
  const unit=units.find(row=>row.id===squad.id);
  return sum+Math.floor(Number(squad.quantity||0)*.9)*Number(unit?.goldRevivalCost||0);
},0)/5.91;
console.log(JSON.stringify({selectedSquads:selectedIds.length,added:'BATTLE GRIFFIN 7',eld:optimized.result.expectedTotalLifetimeDamage,adjustedGold,damagePerThousandGold:optimized.result.expectedTotalLifetimeDamage/adjustedGold*1000,capacities:optimized.result.capacities,diagnostics:optimized.diagnostics},null,2));
