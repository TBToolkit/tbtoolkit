import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createOptimizerSearchJourney,recordOptimizerSearchJourney} from '../js/optimizer-search-journey.mjs';

const journey=createOptimizerSearchJourney();
assert.equal(recordOptimizerSearchJourney(journey,{phase:'loading',evaluations:0}),false);
assert.equal(journey.points.length,0);
assert.equal(recordOptimizerSearchJourney(journey,{phase:'seed-screen',evaluations:10,expectedLifetimeDamage:100}),true);
assert.equal(recordOptimizerSearchJourney(journey,{phase:'local',evaluations:25,expectedLifetimeDamage:120}),true);
assert.equal(recordOptimizerSearchJourney(journey,{phase:'counterfactual',evaluations:40,expectedLifetimeDamage:105}),true);
assert.deepEqual(journey.points.map(point=>point.best),[100,120,120],'Best-so-far ELD must not fall when another search path is weaker.');
assert.equal(journey.points.at(-1).eld,105,'The chart must retain weaker reported candidates to show breadth.');
recordOptimizerSearchJourney(journey,{phase:'counterfactual',evaluations:40,expectedLifetimeDamage:110});
assert.equal(journey.points.length,3,'Repeated reports at the same evaluation and phase should replace a point.');
recordOptimizerSearchJourney(journey,{phase:'polish',evaluations:41,expectedLifetimeDamage:121,bestExpectedLifetimeDamage:125});
assert.equal(journey.best,125);
assert.equal(journey.points.at(-1).best,125);
for(let index=42;index<900;index++)recordOptimizerSearchJourney(journey,{phase:'polish',evaluations:index,expectedLifetimeDamage:100+index/10});
assert.ok(journey.points.length<=240,'The chart must bound retained progress samples.');
assert.equal(journey.points[0].evaluations,10,'Downsampling must keep the beginning of the search.');
assert.equal(journey.points.at(-1).evaluations,899,'Downsampling must keep the latest result.');

const html=await readFile(new URL('../stacking.html',import.meta.url),'utf8');
const script=await readFile(new URL('../js/epic-stacker.js',import.meta.url),'utf8');
assert.match(html,/class="optimizer-search-journey"[^>]*hidden id="optimizerSearchJourneyPanel"/,'Search Journey must start hidden.');
assert.match(script,/optimizerSearchJourneyPanel\.hidden=!isBattleOptimizeMode\(\)/,'Search Journey must appear only in the Battle Calculator Optimize method.');
assert.match(script,/if\(isBattleOptimizeMode\(\)&&recordOptimizerSearchJourney/,'Other methods must not record search progress.');
console.log('Optimizer Search Journey regression checks passed.');
