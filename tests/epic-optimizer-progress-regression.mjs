import assert from 'node:assert/strict';
import {createExploreProgressState,advanceExploreProgress} from '../js/epic-optimizer-progress.mjs';

const squad=(id,health)=>({id,category:'troop',tier:'G9',quantity:10,effectiveHealth:health,predictedDeathPosition:1});
const baseline={result:{expectedTotalLifetimeDamage:100,squads:[squad('starting',1000)]}};
let state=createExploreProgressState(baseline);
assert.equal(state.currentEld,100);
assert.equal(state.verifiedBestEld,100);
assert.equal(state.rows[0].id,'starting','A cached starting army must be ready before worker progress arrives.');

state=advanceExploreProgress(state,{phase:'explore-screen',exploreStage:'screen',screeningEvaluations:250,verifiedBestEld:100});
assert.equal(state.rows[0].id,'starting','Screening must retain the starting army chart.');
assert.equal(state.currentEld,100);

state=advanceExploreProgress(state,{phase:'seed-screen',exploreStage:'finalist',candidateIndex:1,candidateCount:2,expectedLifetimeDamage:80,verifiedBestEld:100,healthLadder:[{id:'finalist-one',effectiveHealth:800}]});
const firstRevision=state.revision;
assert.equal(state.rows[0].id,'finalist-one','The new finalist must replace the prior chart even below the overall best.');
assert.equal(state.currentEld,80);
assert.equal(state.verifiedBestEld,100,'A partially optimized finalist must not change the confirmed best.');

state=advanceExploreProgress(state,{phase:'local',exploreStage:'finalist',candidateIndex:1,candidateCount:2,expectedLifetimeDamage:75,verifiedBestEld:100,healthLadder:[{id:'worse',effectiveHealth:750}]});
assert.equal(state.revision,firstRevision,'A worse point in the same finalist must not redraw the chart.');
assert.equal(state.rows[0].id,'finalist-one');

state=advanceExploreProgress(state,{phase:'local',exploreStage:'finalist',candidateIndex:1,candidateCount:2,expectedLifetimeDamage:90,verifiedBestEld:100,healthLadder:[{id:'finalist-one-better',effectiveHealth:900}]});
assert.equal(state.rows[0].id,'finalist-one-better','Improvement within a finalist must redraw even below the confirmed best.');
assert.equal(state.verifiedBestEld,100);

state=advanceExploreProgress(state,{phase:'finalist-complete',exploreStage:'finalist-complete',candidateIndex:1,candidateCount:2,expectedLifetimeDamage:90,verifiedBestEld:100,healthLadder:[{id:'finalist-one-final',effectiveHealth:900}]});
assert.equal(state.verifiedBestEld,100);
state=advanceExploreProgress(state,{phase:'seed-screen',exploreStage:'finalist',candidateIndex:2,candidateCount:2,expectedLifetimeDamage:70,verifiedBestEld:100,healthLadder:[{id:'finalist-two',effectiveHealth:700}]});
assert.equal(state.rows[0].id,'finalist-two','Each finalist must have its own improvement threshold.');
assert.equal(state.currentEld,70);

state=advanceExploreProgress(state,{phase:'local',exploreStage:'finalist',candidateIndex:2,candidateCount:2,expectedLifetimeDamage:110,verifiedBestEld:100,healthLadder:[{id:'unverified',effectiveHealth:1100}]});
assert.equal(state.verifiedBestEld,100,'An interim lead is not yet a confirmed finalist result.');
state=advanceExploreProgress(state,{phase:'finalist-complete',exploreStage:'finalist-complete',candidateIndex:2,candidateCount:2,expectedLifetimeDamage:105,verifiedBestEld:105,healthLadder:[{id:'finalist-two-final',effectiveHealth:1050}]});
assert.equal(state.currentEld,105);
assert.equal(state.verifiedBestEld,105);
assert.equal(state.rows[0].id,'finalist-two-final');

let fresh=createExploreProgressState();
assert.equal(fresh.rows.length,0);
fresh=advanceExploreProgress(fresh,{phase:'seed',exploreStage:'baseline',expectedLifetimeDamage:50,healthLadder:[{id:'working-baseline',effectiveHealth:500}]});
assert.equal(fresh.currentEld,50);
assert.equal(fresh.verifiedBestEld,0);
fresh=advanceExploreProgress(fresh,{phase:'baseline-ready',exploreStage:'baseline-ready',expectedLifetimeDamage:60,verifiedBestEld:60,healthLadder:[{id:'confirmed-baseline',effectiveHealth:600}]});
assert.equal(fresh.currentEld,60);
assert.equal(fresh.verifiedBestEld,60);
console.log('Explore optimizer progress regression passed.');
