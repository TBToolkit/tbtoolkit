import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../js/epic-stacker.js',import.meta.url),'utf8');
const functionSource=name=>{
  const match=source.match(new RegExp(`function ${name}\\(\\)\\{[\\s\\S]*?\\n\\}`));
  assert.ok(match,`${name} must remain available for encounter result restoration`);
  return match[0];
};

const storage=new Map();
const workspaces={arachne:{inputs:{shareEpicArmy:false},resultCache:null},doomsday:{inputs:{shareEpicArmy:false},resultCache:null}};
let encounterId='arachne';
let failStorage=false;
const context=vm.createContext({
  activeMode:'battle',
  OPTIMIZER_CACHE_BUILD:'optimizer:test-build',
  lastOptimizedEpicPayload:null,
  lastOptimizedEpicSignature:'',
  lastEpicRunDiagnostics:null,
  state:{modes:{battle:{get activeEncounterId(){return encounterId}}}},
  currentBattleWorkspace:()=>workspaces[encounterId],
  canReuseEpicOptimizerResult:()=>false,
  optimizerResultStorageKeyFor:id=>`optimizer.${id}`,
  optimizerResultStorageKey:()=>`optimizer.${encounterId}`,
  compactOptimizerPayloadForStorage:payload=>payload,
  writeOptimizerResultWithQuotaRecovery:(key,value)=>{
    if(failStorage)throw new Error('Quota exceeded');
    storage.set(key,structuredClone(value));
  },
  readSavedJson:(_storage,key)=>storage.get(key)??null,
  localStorage:{},
  saveState:()=>{},
  console:{warn:()=>{}}
});
vm.runInContext(`${functionSource('loadSavedOptimizerResult')}\n${functionSource('saveOptimizerResult')}`,context);

context.lastOptimizedEpicPayload={result:{eld:11}};
context.lastOptimizedEpicSignature='arachne-inputs';
vm.runInContext('saveOptimizerResult()',context);
assert.equal(workspaces.arachne.resultCache.signature,'arachne-inputs');

encounterId='doomsday';
context.lastOptimizedEpicPayload={result:{eld:22}};
context.lastOptimizedEpicSignature='doomsday-inputs';
vm.runInContext('saveOptimizerResult()',context);
assert.equal(workspaces.doomsday.resultCache.signature,'doomsday-inputs');

encounterId='arachne';
vm.runInContext('loadSavedOptimizerResult()',context);
assert.equal(context.lastOptimizedEpicSignature,'arachne-inputs','Returning to Arachne must restore its result, not Doomsday’s.');
assert.equal(context.lastOptimizedEpicPayload.result.eld,11);

encounterId='doomsday';
vm.runInContext('loadSavedOptimizerResult()',context);
assert.equal(context.lastOptimizedEpicSignature,'doomsday-inputs','Returning to Doomsday must restore its own result.');

workspaces.arachne.resultCache=null;
encounterId='arachne';
vm.runInContext('loadSavedOptimizerResult()',context);
assert.equal(context.lastOptimizedEpicSignature,'arachne-inputs','A page reload must restore the encounter result from browser storage.');

failStorage=true;
encounterId='doomsday';
context.lastOptimizedEpicPayload={result:{eld:33}};
context.lastOptimizedEpicSignature='doomsday-new-inputs';
vm.runInContext('saveOptimizerResult()',context);
encounterId='arachne';
vm.runInContext('loadSavedOptimizerResult()',context);
encounterId='doomsday';
vm.runInContext('loadSavedOptimizerResult()',context);
assert.equal(context.lastOptimizedEpicSignature,'doomsday-new-inputs','An in-session result must survive encounter switching even when storage is full.');

workspaces.doomsday.resultCache={build:'old-optimizer',signature:'stale',payload:{result:{eld:999}}};
storage.delete('optimizer.doomsday');
vm.runInContext('loadSavedOptimizerResult()',context);
assert.equal(context.lastOptimizedEpicPayload,null,'An incompatible optimizer build must never restore a result.');

workspaces.hellforge={inputs:{shareEpicArmy:true},resultCache:null};
workspaces.doomsday.inputs.shareEpicArmy=true;
workspaces.doomsday.resultCache={build:'optimizer:test-build',signature:'shared-inputs',payload:{result:{eld:44}},savedAt:10};
context.canReuseEpicOptimizerResult=id=>id!=='arachne';
context.linkedEpicArmyWorkspaces=()=>[{id:'doomsday',workspace:workspaces.doomsday},{id:'hellforge',workspace:workspaces.hellforge}];
context.currentEpicEffectiveSignature=()=>currentSignature;
let currentSignature='shared-inputs';
encounterId='hellforge';
vm.runInContext('loadSavedOptimizerResult()',context);
assert.equal(context.lastOptimizedEpicPayload.result.eld,44,'A linked encounter must reuse a matching optimizer result.');
currentSignature='changed-inputs';
vm.runInContext('loadSavedOptimizerResult()',context);
assert.equal(context.lastOptimizedEpicPayload,null,'Shared results must not appear after the army inputs change.');

console.log(JSON.stringify({ok:true,encounters:['arachne','doomsday'],quotaFallback:true}));
