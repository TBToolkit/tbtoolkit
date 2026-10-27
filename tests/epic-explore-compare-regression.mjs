import assert from 'node:assert/strict';
import {exploreCandidatePool,preferHigherEldResult} from '../js/epic-explore-compare.mjs';

const baseline={result:{expectedTotalLifetimeDamage:863.660e9}};
const misleadingRecommendation={result:{expectedTotalLifetimeDamage:857.046e9}};
assert.equal(preferHigherEldResult(baseline,misleadingRecommendation),baseline,'A preliminary recommendation that loses after full optimization must not replace the starting army');
assert.equal(preferHigherEldResult(baseline,{result:{expectedTotalLifetimeDamage:863.660e9}}),baseline,'A tie must preserve the starting selection');
const actualImprovement={result:{expectedTotalLifetimeDamage:870e9}};
assert.equal(preferHigherEldResult(baseline,actualImprovement),actualImprovement,'A fully optimized higher-ELD finalist may replace the baseline');
const replacementRows=Array.from({length:4},(_,i)=>({selectedIds:[`replacement-${i}`],screenedEld:10-i}));
const priorChallenges=Array.from({length:4},(_,i)=>({selectedIds:[`exclusion-${i}`],screenedEld:100+i}));
const priorFinalists=Array.from({length:3},(_,i)=>({selectedIds:[`finalist-${i}`],screenedEld:200+i}));
const pool=exploreCandidatePool({replacementFinalists:replacementRows,challengeFinalists:priorChallenges,finalists:priorFinalists});
assert.deepEqual(pool.candidates.slice(0,pool.limit),[...replacementRows,...priorChallenges,...priorFinalists],
  'Weak quick seeds must not eliminate protected replacements or displace the prior seven finalists');
assert.equal(exploreCandidatePool({finalists:priorFinalists}).limit,7,'Ordinary Explore must retain its existing finalist limit');
assert.equal(exploreCandidatePool({replacementFinalists:[...replacementRows,...replacementRows]}).limit,11,'Protected checks must add at most four full optimizations');
console.log(JSON.stringify({ok:true,baseline:baseline.result.expectedTotalLifetimeDamage,misleadingRecommendation:misleadingRecommendation.result.expectedTotalLifetimeDamage}));
