import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createExploreStructures,createExploreNeighbors,diverseExploreRows,runExploreSearch} from '../js/epic-explore-search.mjs';
import {compositionSignature} from '../js/epic-composition-search.mjs';
const units=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url)));
const currentIds=units.filter(u=>['G9','S8','E9','M9'].includes(u.tier)).map(u=>u.id);
const space=createExploreStructures({units,currentIds,maxTierDepth:2});
const signatures=new Set(space.structures.map(r=>compositionSignature(r.selectedIds)));
assert.equal(signatures.size,space.structures.length,'Each mask is evaluated once');
const allowed=new Set(space.availableIds);
assert.ok(space.structures.every(r=>r.selectedIds.every(id=>allowed.has(id))));
const base=units.filter(u=>['G9','G8','S8','E9','E8','M9','M8','M7'].includes(u.tier)).map(u=>u.id);
for(const u of units.filter(u=>u.tier==='G7'))assert.ok(signatures.has(compositionSignature([...base,u.id])),'Sparse alternatives must exist from the actual starting selection');
// The same general expansion applies to every permitted family and tier.
for(const tier of ['S6','M7','G8']){
  const all=space.availableIds;
  const peers=units.filter(u=>allowed.has(u.id)&&u.tier===tier);
  for(const u of peers)assert.ok(signatures.has(compositionSignature([...all.filter(id=>!peers.some(p=>p.id===id)),u.id])));
}
const merc=units.find(u=>u.category==='mercenary');
const withMerc=createExploreStructures({units,currentIds:[...currentIds,merc.id],maxTierDepth:0});
assert.ok(withMerc.structures.every(r=>r.selectedIds.includes(merc.id)));
assert.ok(withMerc.structures.every(r=>r.selectedIds.every(id=>id===merc.id||['G9','S8','E9','M9'].includes(units.find(u=>u.id===id).tier))));
const winner=[...base,...units.filter(u=>u.tier==='G7').map(u=>u.id),units.find(u=>u.tier==='S7').id,merc.id];
const neighbors=createExploreNeighbors({units,selectedIds:winner,availableIds:[...space.availableIds,merc.id],mandatoryIds:[merc.id]});
const neighborMasks=new Set(neighbors.map(r=>compositionSignature(r.selectedIds)));
assert.equal(neighborMasks.size,neighbors.length);
for(const tier of ['G7','G8','S7','M8'])assert.ok(neighborMasks.has(compositionSignature(winner.filter(id=>units.find(u=>u.id===id).tier!==tier))),'The winner must have removal neighbors across all families');
assert.ok(neighbors.every(r=>r.selectedIds.includes(merc.id)&&r.selectedIds.every(id=>allowed.has(id)||id===merc.id)));
assert.ok(neighborMasks.has(compositionSignature([...winner,units.find(u=>u.tier==='E7').id])),'Missing permitted units must also get add neighbors');
const crowd=units.filter(u=>u.tier==='G7').map((u,i)=>({selectedIds:[...base,u.id],result:{expectedTotalLifetimeDamage:100-i}}));
const different={selectedIds:base,result:{expectedTotalLifetimeDamage:90}};
assert.ok(diverseExploreRows([...crowd,different],units,3).includes(different),'Diversity reserves space below a crowd of similarly shaped masks');
const tiny=runExploreSearch({units,currentIds,maxTierDepth:2,bonuses:{monsterHealthPct:1600,monsterStrengthPct:2000,strengthAgainstEpicPct:2000,monsterDDPct:10,monsterSTPct:10},capacityLimits:{LEADERSHIP:10000,DOMINANCE:10000,AUTHORITY:0},timeBudgetMs:1});
assert.ok(tiny.elapsedMs<2000,'A screening deadline must return completed work rather than throw');
console.log('Explore structure coverage, diversity, ownership, depth, deduplication, and deadline checks passed.');
