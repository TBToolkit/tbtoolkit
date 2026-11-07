import {DEFAULT_EXPLORE_TIER_DEPTHS,normalizeExploreTierDepths,exploreTimeBudgetMs,exploreTimePolicy} from '../js/epic-explore-policy.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {canonicalExploreSelection,createExploreStructures,createExploreNeighbors,diverseExploreRows,runExploreSearch} from '../js/epic-explore-search.mjs';
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

assert.deepEqual(canonicalExploreSelection(units,base),canonicalExploreSelection(units,currentIds),'Lower-tier starting choices must not change the Explore origin');
assert.deepEqual(canonicalExploreSelection(units,[...base,merc.id]).filter(id=>units.find(u=>u.id===id).category==='mercenary'),[merc.id]);
const partial=[units.find(u=>u.tier==='G9').id];
assert.deepEqual(canonicalExploreSelection(units,partial),units.filter(u=>u.tier==='G9').map(u=>u.id),'Fill the highest tier without adding unselected families');

assert.deepEqual([0,1,2,3,4].map(exploreTimeBudgetMs),[360000,360000,360000,480000,600000]);

assert.deepEqual(exploreTimePolicy(4),{totalMs:600000,screeningMs:120000,neighborhoodMs:25000});

assert.deepEqual(normalizeExploreTierDepths(),{guardsman:1,specialist:1,engineer:1,monster:2});
assert.deepEqual(normalizeExploreTierDepths(0),{guardsman:0,specialist:0,engineer:0,monster:0},'Legacy scalar depths must still work');
assert.deepEqual(normalizeExploreTierDepths({guardsman:-1,specialist:9,engineer:'2.9',monster:'bad'}),{guardsman:0,specialist:4,engineer:2,monster:2});
assert.equal(exploreTimeBudgetMs(DEFAULT_EXPLORE_TIER_DEPTHS),360000);
assert.equal(exploreTimeBudgetMs({guardsman:3,specialist:0,engineer:1,monster:2}),480000);
assert.equal(exploreTimeBudgetMs({guardsman:0,specialist:1,engineer:4,monster:0}),600000);

// Mixed ranges must constrain every generated structure and every add/remove
// neighbor, including families whose selected top tiers differ from each other.
const mixedDepths={guardsman:0,specialist:2,engineer:1,monster:3};
for(const depths of [DEFAULT_EXPLORE_TIER_DEPTHS,mixedDepths]){
  const mixed=createExploreStructures({units,currentIds,tierDepths:depths});
  const top={guardsman:9,specialist:8,engineer:9,monster:9};
  const permitted=new Set(units.filter(u=>{
    const family=u.category==='monster'?'monster':u.category==='troop'?u.unitClass.toLowerCase():null;
    return family&&u.tierNumber<=top[family]&&u.tierNumber>=top[family]-depths[family];
  }).map(u=>u.id));
  assert.deepEqual(new Set(mixed.availableIds),permitted,'Each family must have exactly its permitted tier range');
  assert.ok(mixed.structures.every(row=>row.selectedIds.every(id=>permitted.has(id))));
  const mixedNeighbors=createExploreNeighbors({units,selectedIds:currentIds,availableIds:mixed.availableIds});
  assert.ok(mixedNeighbors.every(row=>row.selectedIds.every(id=>permitted.has(id))));
  const expanded=createExploreStructures({units,currentIds,tierDepths:{...depths,guardsman:Math.min(4,depths.guardsman+1)}});
  for(const family of ['SPECIALIST','ENGINEER','MONSTER']){
    const familyIds=ids=>ids.filter(id=>{const u=units.find(u=>u.id===id);return family==='MONSTER'?u.category==='monster':u.unitClass===family;});
    assert.deepEqual(familyIds(expanded.availableIds),familyIds(mixed.availableIds),'Changing Guardsmen depth must not change '+family+' availability');
  }
}
const withoutEngineers=createExploreStructures({units,currentIds:currentIds.filter(id=>units.find(u=>u.id===id).unitClass!=='ENGINEER'),tierDepths:DEFAULT_EXPLORE_TIER_DEPTHS});
assert.ok(withoutEngineers.availableIds.every(id=>units.find(u=>u.id===id).unitClass!=='ENGINEER'),'Depth controls must not unlock an unselected family');

// A frozen family's exact checked types (including partial/lower tiers) must
// survive canonicalization, dense/sparse masks, and every neighborhood move.
const familyOf=u=>u.category==='monster'?'monster':String(u.unitClass).toLowerCase();
for(const family of Object.keys(DEFAULT_EXPLORE_TIER_DEPTHS)){
  const chosen=units.filter(u=>familyOf(u)===family&&[9,7].includes(u.tierNumber)).filter((u,i,a)=>a.findIndex(v=>v.tierNumber===u.tierNumber)===i).map(u=>u.id);
  const initial=[...currentIds.filter(id=>familyOf(units.find(u=>u.id===id))!==family),...chosen];
  const depths={...DEFAULT_EXPLORE_TIER_DEPTHS,[family]:'selected'};
  const origin=canonicalExploreSelection(units,initial,depths);
  const familyIds=ids=>ids.filter(id=>familyOf(units.find(u=>u.id===id))===family).sort();
  assert.deepEqual(familyIds(origin),[...chosen].sort());
  const frozen=createExploreStructures({units,currentIds:origin,tierDepths:depths});
  assert.deepEqual(familyIds(frozen.availableIds),[...chosen].sort());
  assert.ok(frozen.structures.length>1,'Other families must remain explorable');
  for(const row of frozen.structures)assert.deepEqual(familyIds(row.selectedIds),[...chosen].sort());
  for(const row of createExploreNeighbors({units,selectedIds:origin,...frozen}))assert.deepEqual(familyIds(row.selectedIds),[...chosen].sort());
}
const allFrozen=Object.fromEntries(Object.keys(DEFAULT_EXPLORE_TIER_DEPTHS).map(f=>[f,'selected']));
const frozenSpace=createExploreStructures({units,currentIds:base,tierDepths:allFrozen});
assert.equal(frozenSpace.structures.length,1);
assert.equal(compositionSignature(frozenSpace.structures[0].selectedIds),compositionSignature(base));
assert.deepEqual(createExploreNeighbors({units,selectedIds:base,...frozenSpace}),[]);
assert.equal(exploreTimeBudgetMs(allFrozen),360000);
assert.equal(normalizeExploreTierDepths({guardsman:'selected'}).guardsman,'selected');
console.log('Do not explore preserves exact family selections through every structural search phase.');
