import assert from 'node:assert/strict';
import {canonicalizeReviewCandidates} from '../js/epic-review-engine.mjs';

const row=(selectedIds,eld)=>({selectedIds,result:{expectedTotalLifetimeDamage:eld}});
const canonical=canonicalizeReviewCandidates(['a','b'],[
  row(['a','b'],100),
  row(['b','a'],120),
  row(['a'],110),
]);

assert.equal(canonical.current.result.expectedTotalLifetimeDamage,120,'The current selection must use its strongest refinement');
assert.equal(canonical.candidates.length,2,'Identical unit selections must be compared only once');
assert.equal(canonical.candidates.filter(candidate=>candidate.selectedIds.length===2).length,1,'An identical selection must not reappear as a recommendation');

console.log(JSON.stringify({ok:true,candidates:canonical.candidates.length,currentEld:canonical.current.result.expectedTotalLifetimeDamage}));
