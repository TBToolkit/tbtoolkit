import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizeEpicOptimizerSignature} from '../js/epic-optimizer-signature.mjs';

const source=readFileSync(new URL('../js/epic-stacker.js',import.meta.url),'utf8');
const cacheHelper=source.match(/function hasSavedOptimizerCacheForEncounter\(account,encounterId,workspace\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(cacheHelper,'Clan Overview must be able to find saved Optimize results after calculator reloads.');
const diskCache=new Map([['tbtoolkit.battleCalculator.optimizerResult.v4.player.epic-basilisk',{build:'optimizer:test-build',signature:'saved-inputs',payload:{result:{eld:123}}}]]);
const cacheContext=vm.createContext({OPTIMIZER_CACHE_BUILD:'optimizer:test-build',localStorage:{},readSavedJson:(_storage,key)=>diskCache.get(key),epicArmyGroup:()=>null,canReuseEpicOptimizerResult:()=>false});
vm.runInContext(cacheHelper,cacheContext);
assert.equal(vm.runInContext('hasSavedOptimizerCacheForEncounter({id:"player",battle:{workspaces:{}}},"epic-basilisk",{methods:{optimize:{resultCache:null}}})',cacheContext),true,'An Optimize result stored outside the compact account snapshot must be available for plan repair.');
diskCache.get('tbtoolkit.battleCalculator.optimizerResult.v4.player.epic-basilisk').build='old-build';
assert.equal(vm.runInContext('hasSavedOptimizerCacheForEncounter({id:"player",battle:{workspaces:{}}},"epic-basilisk",{methods:{optimize:{resultCache:null}}})',cacheContext),false,'A stale Optimize result must not be reused.');
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
  normalizeEpicOptimizerSignature,
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

const canonicalSignature=JSON.stringify({selected:{troop:['corax'],monster:[],mercenary:[]},monsterDD:14});
const legacySignature=JSON.stringify({selected:{troop:['corax'],monster:[],mercenary:[]},rankSeparation:0.05,monsterDD:14});
workspaces.doomsday.resultCache={build:'optimizer:test-build',signature:legacySignature,payload:{result:{eld:55}},savedAt:20};
currentSignature=canonicalSignature;
vm.runInContext('loadSavedOptimizerResult()',context);
assert.equal(context.lastOptimizedEpicPayload.result.eld,55,'A linked encounter must reuse a legacy result whose only extra fingerprint field is Custom separation.');
assert.equal(context.lastOptimizedEpicSignature,canonicalSignature,'Restored legacy signatures must be canonicalized in memory.');

const inputs={leadership:'450000',rankSeparation:'0.05',minimumSeparation:true,monsterDD:'14'};
const signatureContext=vm.createContext({
  activeMode:'battle',
  isAnyEpicOptimizeMode:()=>true,
  modeState:()=>({inputs,selectedIds:{troop:['corax'],monster:[],mercenary:[]}}),
  parseNumber:value=>Number(value)||0
});
vm.runInContext(functionSource('currentEpicEffectiveSignature'),signatureContext);
const before=vm.runInContext('currentEpicEffectiveSignature()',signatureContext);
inputs.minimumSeparation=false;inputs.rankSeparation='0.75';
assert.equal(vm.runInContext('currentEpicEffectiveSignature()',signatureContext),before,'Changing Custom separation must not invalidate an Epic optimizer result.');
inputs.monsterDD='15';
assert.notEqual(vm.runInContext('currentEpicEffectiveSignature()',signatureContext),before,'A genuine optimizer input change must invalidate the result.');

let fixedMercenaryInputs=null;
const fixedMercenaryContext=vm.createContext({
  modeState:()=>({inputs:{includeMercenariesInOptimization:false,autoAuthority:false,authorityFill:'100'},selectedIds:{mercenary:['merc']}}),
  baseEngineInputs:()=>({minimumSeparation:false,rankSeparation:0.0075}),
  resolvedFills:{mercenary:1},
  parseNumber:value=>Number(value)||0,
  units:{mercenary:[]},
  calculateCategory:({inputs:used})=>{fixedMercenaryInputs=used;return{results:[{name:'merc',qty:10}]};}
});
vm.runInContext(functionSource('fixedStandardMercenaryQuantitiesForOptimizer'),fixedMercenaryContext);
vm.runInContext('fixedStandardMercenaryQuantitiesForOptimizer()',fixedMercenaryContext);
assert.equal(fixedMercenaryInputs.minimumSeparation,true,'Fixed mercenary quantities in Optimize must ignore the Custom separation setting.');

console.log(JSON.stringify({ok:true,encounters:['arachne','doomsday'],quotaFallback:true}));
