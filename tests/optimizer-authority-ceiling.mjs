import fs from 'node:fs';
import {optimizeEpicQuantities} from '../js/epic-quantity-optimizer.mjs';

const units=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const selected=[
  ...units.filter(unit=>unit.category==='troop'&&['G9','G8'].includes(unit.tier)).slice(0,4),
  ...units.filter(unit=>unit.category==='monster'&&['M9','M8'].includes(unit.tier)).slice(0,4),
  ...units.filter(unit=>unit.category==='mercenary'&&unit.tierNumber===2).slice(0,4)
];
const capacityLimits={LEADERSHIP:200_000,DOMINANCE:50_000,AUTHORITY:20_000};
const bonuses={monsterHealthPct:1600,monsterStrengthPct:2000,strengthAgainstEpicPct:3800,monsterDDPct:12,monsterSTPct:18,arachne:false,enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED'],includeMercenariesInOptimization:true,useCustomFamilyBonuses:false};
const optimized=optimizeEpicQuantities({units,selectedIds:selected.map(unit=>unit.id),bonuses,capacityLimits,minimumHealthSeparationPct:.01,minimumQuantity:1});
const authority=Number(optimized.result.capacities.AUTHORITY||0);
const partialSeeds=(optimized.diagnostics.seedCandidates||[]).filter(seed=>seed.name.startsWith('authority-')).map(seed=>seed.name);

if(authority>capacityLimits.AUTHORITY)throw new Error(`Authority ${authority} exceeded ceiling ${capacityLimits.AUTHORITY}.`);
if(partialSeeds.length!==3)throw new Error(`Expected three partial-Authority basins; found ${partialSeeds.join(', ')||'none'}.`);
if(optimized.diagnostics.authorityCeiling!==capacityLimits.AUTHORITY)throw new Error('Authority ceiling diagnostic is incorrect.');
if(optimized.diagnostics.authorityUsed!==authority)throw new Error('Authority usage diagnostic is incorrect.');

console.log(JSON.stringify({ok:true,authorityCeiling:capacityLimits.AUTHORITY,authorityUsed:authority,underfilled:authority<capacityLimits.AUTHORITY,partialSeeds},null,2));
