import assert from 'node:assert/strict';
import {preferHigherEldResult} from '../js/epic-explore-compare.mjs';

const baseline={result:{expectedTotalLifetimeDamage:863.660e9}};
const misleadingRecommendation={result:{expectedTotalLifetimeDamage:857.046e9}};
assert.equal(preferHigherEldResult(baseline,misleadingRecommendation),baseline,'A preliminary recommendation that loses after full optimization must not replace the starting army');
assert.equal(preferHigherEldResult(baseline,{result:{expectedTotalLifetimeDamage:863.660e9}}),baseline,'A tie must preserve the starting selection');
const actualImprovement={result:{expectedTotalLifetimeDamage:870e9}};
assert.equal(preferHigherEldResult(baseline,actualImprovement),actualImprovement,'A fully optimized higher-ELD finalist may replace the baseline');
console.log(JSON.stringify({ok:true,baseline:baseline.result.expectedTotalLifetimeDamage,misleadingRecommendation:misleadingRecommendation.result.expectedTotalLifetimeDamage}));
