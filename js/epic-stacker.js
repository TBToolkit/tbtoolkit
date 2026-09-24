import { calculateEpicStack, calculateCategory, calculateCustomStack, calculateCustomCategory, customInternalRank } from './epic-engine.mjs';
import { scoreEpicArmy, validateArmyDatabase } from './epic-combat-engine-v2.mjs';
import { calculateBattleStack, calculatePvpCpStack, calculatePvpCustomStack, calculatePvpUnknownStack, calculatePvpUnknownCustomStack, defaultPvpInternalOrder } from './battle-engine.mjs';
import { actualRevivalCost as sharedActualRevivalCost, attackingRevivableQuantity as sharedAttackingRevivableQuantity } from './combat-mechanics.mjs';
import { BUILT_IN_ENCOUNTERS, makeAccount, encountersForAccount, resolveEncounter, isBuiltInEncounter, createCustomEncounter, uniqueStableId, enemySquadTypes, engineBattleType, validateAccountCollection } from './workspace-model.mjs';
import { BIFF_MAX_BYTES, serializeAccountToBiff, parseBiff, materializeImportedAccount } from './biff-format.mjs';
import {APP_BUILD,OPTIMIZER_CACHE_BUILD} from './build-info.mjs';
import {persistentAccountSnapshot,readSavedJson,writeSavedJson,validateAccountState} from './browser-storage.mjs';
import {readLatestSavedState,SAVED_STATE_KEY,SAVED_STATE_SCHEMA_VERSION} from './saved-state-schema.mjs';
import {createOptimizerWorker,createReviewWorker} from './calculator-workers.mjs';
import {escapeHtml,formatDamage,formatElapsed,formatInteger,mixHex,parseNumber,tierNumber} from './ui-utils.mjs';
import {estimatedEpicPoints} from './epic-points-estimates.mjs';
import {calculateEncounterPlan} from './encounter-plan.mjs';
import {readClanProfiles,linkedClanProfile,clanEncounterNorm,saveClanEncounterNorm} from './clan-profile-link.mjs';
import {normalizeEpicOptimizerSignature} from './epic-optimizer-signature.mjs';
import {EPIC_ARMY_GROUPS,epicArmyGroup,canReuseEpicOptimizerResult,copySharedEpicArmy} from './shared-epic-armies.mjs';
import {REBUILD_COST_ASSUMPTION,unitRebuildCost} from './unit-rebuild-costs.mjs';

const STORAGE_KEY=SAVED_STATE_KEY;
const LEGACY_EPIC_KEY='tbtoolkit.epicStacker.v2';
const OPTIMIZER_RESULT_KEY='tbtoolkit.epicOptimizer.lastResult.v2';
const ENCOUNTER_RESULT_STORE_KEY='tbtoolkit.epicEncounterResults.v1';
const EPIC_NORM_POINTS_PER_CHEST={ARACHNE:300e6/35,ARCANOMANCER:800e6/52,ARMAGEDDON:750e6/35,BASILISK:750e6/35,BRIAREUS:800e6/52,CHIMERA:2e6,DOOMSDAY:50e6/7,FENRIR:2e6,HELLFORGE:150e6/7,JORMUNGANDR:2e6,'SHADOW CITY':14e9/75};
const REVIEW_SELECTION_UI_ENABLED=false;
const CAPACITY_META={troop:{limit:'leadership',fill:'leadershipFill',auto:'autoLeadership'},mercenary:{limit:'authority',fill:'authorityFill',auto:'autoAuthority'},monster:{limit:'dominance',fill:'dominanceFill',auto:'autoDominance'}};
const units={troop:[],monster:[],mercenary:[]};let armyV2=[];const els={};let activeCategory='troop';let activeMode='battle';let activeView='troop';let resolvedFills={troop:1,monster:1,mercenary:1};
let epicWorker=null;let epicRequestId=0;let epicResultCurrent=false;let lastOptimizedEpicSignature='';let lastEpicRunDiagnostics=null;let lastOptimizedEpicPayload=null;
let reviewWorker=null;let reviewRequestId=0;let pendingReviewProposal=null;let reviewStartedAt=0;let reviewElapsedTimer=null;let reviewInputSignature='';
let appInitialized=false;let optimizerBestEldSoFar=0;
let epicChestRewards=new Map();
let pendingBiffImport=null;
let optimizerStartedAt=0;let optimizerElapsedTimer=null;let lastOptimizationElapsedMs=null;
let encounterPlanContext=null;
const HUMAN_BONUS_ROW=Object.freeze({key:'human',auto:'autoHumanBonuses',healthOffset:100,strengthOffset:100});
const MONSTER_CHILD_BONUS_ROWS=Object.freeze([
  {key:'beast',auto:'autoBeastBonuses'},
  {key:'dragon',auto:'autoDragonBonuses'},
  {key:'elemental',auto:'autoElementalBonuses'},
  {key:'giant',auto:'autoGiantBonuses'},
]);
const HUMAN_CHILD_BONUS_ROWS=Object.freeze([
  {key:'guardsman',auto:'autoGuardsmanBonuses'},
  {key:'specialist',auto:'autoSpecialistBonuses'},
  {key:'engineer',auto:'autoEngineerBonuses'},
]);
const EPIC_HUNTER_BONUS_ROW=Object.freeze({key:'epicHunter',auto:'autoEpicHunterBonuses',healthOffset:741,strengthOffset:741});
const LINKED_BONUS_ROWS=Object.freeze([...MONSTER_CHILD_BONUS_ROWS,...HUMAN_CHILD_BONUS_ROWS]);
const BONUS_PROFILE_ROWS=Object.freeze([...MONSTER_CHILD_BONUS_ROWS,...HUMAN_CHILD_BONUS_ROWS,EPIC_HUNTER_BONUS_ROW]);
const BONUS_INPUT_ROWS=Object.freeze([...MONSTER_CHILD_BONUS_ROWS,HUMAN_BONUS_ROW,...HUMAN_CHILD_BONUS_ROWS,EPIC_HUNTER_BONUS_ROW]);
const BONUS_PROFILE_FIELD_IDS=Object.freeze(BONUS_INPUT_ROWS.flatMap(({key})=>['DD','ST','Health','Strength'].map(stat=>`${key}${stat}`)));
function updateOptimizerElapsed(){
  if(!optimizerStartedAt)return;
  const elapsed=performance.now()-optimizerStartedAt;
  if(els.optimizerElapsedTime)els.optimizerElapsedTime.textContent=formatElapsed(elapsed);
}
function startOptimizerElapsedTimer(){
  if(optimizerElapsedTimer)clearInterval(optimizerElapsedTimer);
  optimizerStartedAt=performance.now();
  lastOptimizationElapsedMs=null;
  updateOptimizerElapsed();
  optimizerElapsedTimer=setInterval(updateOptimizerElapsed,250);
}
function stopOptimizerElapsedTimer(){
  if(!optimizerStartedAt)return lastOptimizationElapsedMs;
  lastOptimizationElapsedMs=performance.now()-optimizerStartedAt;
  if(optimizerElapsedTimer){clearInterval(optimizerElapsedTimer);optimizerElapsedTimer=null;}
  if(els.optimizerElapsedTime)els.optimizerElapsedTime.textContent=formatElapsed(lastOptimizationElapsedMs);
  optimizerStartedAt=0;
  return lastOptimizationElapsedMs;
}
function defaultInputs(mode){return{
leadership:'',leadershipFill:'99.99',autoLeadership:true,
authority:'',authorityFill:'10.00',autoAuthority:false,
dominance:'',dominanceFill:'99.99',autoDominance:true,
monsterHealth:'1600',humanHealth:'1500',epicHunterHealth:'859',pvpHealth:'1600',
monsterStrength:'2000',strengthAgainstEpic:'2000',pvpStrength:'2000',monsterDD:'10',monsterST:'10',
beastHealth:'1600',dragonHealth:'1600',elementalHealth:'1600',giantHealth:'1600',
beastStrength:'2000',dragonStrength:'2000',elementalStrength:'2000',giantStrength:'2000',
beastDD:'10',dragonDD:'10',elementalDD:'10',giantDD:'10',beastST:'10',dragonST:'10',elementalST:'10',giantST:'10',
humanStrength:'1900',epicHunterStrength:'1259',
humanDD:'10',epicHunterDD:'10',humanST:'5',epicHunterST:'5',
guardsmanHealth:'1500',specialistHealth:'1500',engineerHealth:'1500',
guardsmanStrength:'1900',specialistStrength:'1900',engineerStrength:'1900',
guardsmanDD:'10',specialistDD:'10',engineerDD:'10',
guardsmanST:'5',specialistST:'5',engineerST:'5',
autoBeastBonuses:true,autoDragonBonuses:true,autoElementalBonuses:true,autoGiantBonuses:true,
autoHumanBonuses:true,autoGuardsmanBonuses:true,autoSpecialistBonuses:true,autoEngineerBonuses:true,autoEpicHunterBonuses:true,
useCustomFamilyBonuses:false,useCustomHealthInputs:false,includeMercenariesInOptimization:false,
arachne:false,battleType:'epic_standard',battleMethod:'optimize',enemyUnitId:'troop-g9-flying-corax-2',minimumSeparation:true,rankSeparation:'0.05',shareEpicArmy:false};}

function normalizeBonusProfileInputs(inputs){
  const i=inputs??{},mh=parseNumber(i.monsterHealth??1600),ms=parseNumber(i.monsterStrength??2000),dd=parseNumber(i.monsterDD??10),st=parseNumber(i.monsterST??10);
  const legacyManual=!!i.useCustomFamilyBonuses;
  for(const {key,auto} of MONSTER_CHILD_BONUS_ROWS){
    for(const stat of ['Health','Strength','DD','ST']){
      const monster=stat==='Health'?mh:stat==='Strength'?ms:stat==='DD'?dd:st;
      if(i[`${key}${stat}`]===undefined)i[`${key}${stat}`]=String(monster);
    }
    if(i[auto]===undefined)i[auto]=true;
  }
  for(const stat of ['Health','Strength','DD','ST']){
    const offset=stat==='Health'||stat==='Strength'?100:stat==='ST'?5:0;
    const monster=stat==='Health'?mh:stat==='Strength'?ms:stat==='DD'?dd:st;
    if(i[`human${stat}`]===undefined)i[`human${stat}`]=String(Math.max(0,monster-offset));
  }
  if(i.autoHumanBonuses===undefined)i.autoHumanBonuses=!legacyManual;
  for(const {key,auto} of HUMAN_CHILD_BONUS_ROWS){
    for(const stat of ['Health','Strength','DD','ST'])if(i[`${key}${stat}`]===undefined)i[`${key}${stat}`]=String(parseNumber(i[`human${stat}`]));
    if(i[auto]===undefined)i[auto]=true;
  }
  const {key,auto,healthOffset,strengthOffset}=EPIC_HUNTER_BONUS_ROW;
  if(i[`${key}Health`]===undefined)i[`${key}Health`]=String(legacyManual?parseNumber(i.epicHunterHealth):Math.max(0,mh-healthOffset));
  if(i[`${key}Strength`]===undefined)i[`${key}Strength`]=String(legacyManual?parseNumber(i.epicHunterStrength):Math.max(0,ms-strengthOffset));
  if(i[`${key}DD`]===undefined)i[`${key}DD`]=String(legacyManual?parseNumber(i.epicHunterDD):dd);
  if(i[`${key}ST`]===undefined)i[`${key}ST`]=String(legacyManual?parseNumber(i.epicHunterST):Math.max(0,st-5));
  if(i[auto]===undefined)i[auto]=!legacyManual;
  return i;
}
function cloneIds(source){
  return{
    troop:[...(source?.troop||[])],
    monster:[...(source?.monster||[])],
    mercenary:[...(source?.mercenary||[])]
  };
}
function cloneOrders(source){
  return{
    troop:[...(source?.troop||[])],
    monster:[...(source?.monster||[])],
    mercenary:[...(source?.mercenary||[])]
  };
}
function cloneUnitOrders(source){const out={troop:{},monster:{},mercenary:{}};for(const c of ['troop','monster','mercenary'])for(const [l,ids] of Object.entries(source?.[c]||{}))out[c][l]=[...(ids||[])];return out;}
function cloneUnitOrderManual(source){const out={troop:{},monster:{},mercenary:{}};for(const c of ['troop','monster','mercenary'])for(const [l,v] of Object.entries(source?.[c]||{}))out[c][l]=!!v;return out;}
function cloneSquadOrder(source){return cloneOrders(source);}
function makeBattleWorkspace(type='epic_standard',seed=null){
  const normalizedSeedInputs=normalizeBonusProfileInputs({...seed?.inputs});
  const customOrders=cloneOrders(
    seed?.methods?.custom?.orders ??
    seed?.orders
  );
  const customUnitOrders=cloneUnitOrders(seed?.methods?.custom?.unitOrders??seed?.unitOrders);const customUnitOrderManual=cloneUnitOrderManual(seed?.methods?.custom?.unitOrderManual??seed?.unitOrderManual);
  const customSquadOrder=cloneSquadOrder(seed?.methods?.custom?.squadOrder??seed?.squadOrder);
  const optimizeResult=
    seed?.methods?.optimize?.resultCache ??
    seed?.resultCache ??
    null;

  const workspace={
    inputs:{
      ...defaultInputs('battle'),
      ...normalizedSeedInputs,
      battleType:type,
      arachne:type==='epic_arachne'
    },
    selectedIds:cloneIds(seed?.selectedIds),
    methods:{
      basic:{},
      custom:{orders:customOrders,unitOrders:customUnitOrders,unitOrderManual:customUnitOrderManual,squadOrder:customSquadOrder},
      optimize:{resultCache:optimizeResult}
    }
  };

  // Compatibility aliases used by the existing Custom Order and optimizer
  // renderer. These point to method-specific data but do not duplicate it.
  Object.defineProperty(workspace,'orders',{
    enumerable:false,
    configurable:true,
    get(){return workspace.methods.custom.orders;},
    set(value){workspace.methods.custom.orders=cloneOrders(value);}
  });
  Object.defineProperty(workspace,'unitOrders',{
    enumerable:false,
    configurable:true,
    get(){return workspace.methods.custom.unitOrders;},
    set(value){workspace.methods.custom.unitOrders=cloneUnitOrders(value);}
  });
  Object.defineProperty(workspace,'unitOrderManual',{
    enumerable:false,
    configurable:true,
    get(){return workspace.methods.custom.unitOrderManual;},
    set(value){workspace.methods.custom.unitOrderManual=cloneUnitOrderManual(value);}
  });
  Object.defineProperty(workspace,'squadOrder',{
    enumerable:false,
    configurable:true,
    get(){return workspace.methods.custom.squadOrder;},
    set(value){workspace.methods.custom.squadOrder=cloneSquadOrder(value);}
  });
  Object.defineProperty(workspace,'resultCache',{
    enumerable:false,
    configurable:true,
    get(){return workspace.methods.optimize.resultCache;},
    set(value){workspace.methods.optimize.resultCache=value??null;}
  });

  return workspace;
}
function battleWorkspaceKey(type){
  const battle=state?.modes?.battle;
  return String(battle?.activeEncounterId&&String(type)===String(battle.activeBattleType)?battle.activeEncounterId:(type||'epic-doomsday'));
}

const TEMPLE_REVIVAL_DIVISORS=Object.freeze({
  1:1.04,2:1.06,3:1.08,4:1.11,5:1.13,6:1.16,7:1.19,8:1.22,9:1.27,
  10:1.33,11:1.36,12:1.40,13:1.44,14:1.48,15:1.53,16:1.58,17:1.63,18:1.68,19:1.74,
  20:1.81,21:1.91,22:2.02,23:2.15,24:2.31,25:2.51,26:2.68,27:2.88,28:3.13,29:3.44,
  30:3.84,31:3.93,32:4.03,33:4.13,34:4.23,35:4.34,36:4.46,37:4.59,38:4.72,39:4.87,
  40:5.02,41:5.17,42:5.34,43:5.52,44:5.71,45:5.91
});
function currentAccount(){return state.accounts[state.activeAccountId]||Object.values(state.accounts)[0];}
function currentEncounter(){return resolveEncounter(currentAccount(),state.modes.battle.activeEncounterId);}
function currentEngineBattleType(){return engineBattleType(currentEncounter());}
function templeLevel(){return Math.max(1,Math.min(45,Number(currentAccount()?.templeLevel)||45));}
function templeRevivalDivisor(){return Number(TEMPLE_REVIVAL_DIVISORS[templeLevel()]||1);}
function actualRevivalCost(rawCost){
  return sharedActualRevivalCost(Math.max(0,Number(rawCost)||0),templeRevivalDivisor());
}
function findUnitById(id){
  for(const category of ['troop','monster','mercenary']){
    const unit=units[category].find(u=>u.id===id);
    if(unit)return unit;
  }
  return null;
}
const ATTACKING_REVIVABLE_FRACTION=0.90;
function attackingRevivableQuantity(row){
  const qty=Math.max(0,Math.floor(Number(row?.qty??row?.quantity??0)||0));
  return sharedAttackingRevivableQuantity(qty,ATTACKING_REVIVABLE_FRACTION);
}
function rawSquadRevival(row,currency='gold'){
  const unit=findUnitById(row?.id);
  const each=currency==='silver'?Number(unit?.silverRevivalCost||0):Number(unit?.goldRevivalCost||0);
  return attackingRevivableQuantity(row)*each;
}
function populateTempleLevel(){
  if(!els.templeLevel)return;
  if(!els.templeLevel.options.length){
    for(let level=1;level<=45;level++){
      const option=document.createElement('option');
      option.value=String(level);
      option.textContent=`${level}`;
      els.templeLevel.append(option);
    }
  }
  els.templeLevel.value=String(templeLevel());
  if(els.templeMultiplier)els.templeMultiplier.textContent=`${templeRevivalDivisor().toFixed(2)}×`;
}
const initialAccount=makeAccount();
initialAccount.battle.activeEncounterId='epic-doomsday';
const state={preferences:{templeLevel:45,chartStyle:'separated'},accounts:{[initialAccount.id]:initialAccount},activeAccountId:initialAccount.id,modes:{
epic:{selectedIds:{troop:[],monster:[],mercenary:[]},inputs:defaultInputs('epic')},
optimizer:{selectedIds:{troop:[],monster:[],mercenary:[]},inputs:defaultInputs('optimizer')},
custom:{selectedIds:{troop:[],monster:[],mercenary:[]},inputs:defaultInputs('custom'),orders:{troop:[],monster:[],mercenary:[]},unitOrders:{troop:{},monster:{},mercenary:{}},unitOrderManual:{troop:{},monster:{},mercenary:{}},squadOrder:{troop:[],monster:[],mercenary:[]}},
battle:initialAccount.battle
}};
function ensureBattleWorkspace(type=state.modes.battle.activeBattleType,method=state.modes.battle.activeBattleMethod,seed=null){
  const encounter=currentEncounter();
  type=encounter?engineBattleType(encounter):type;
  const key=battleWorkspaceKey(type);
  if(!state.modes.battle.workspaces[key]){
    state.modes.battle.workspaces[key]=makeBattleWorkspace(type,seed);
  }
  const workspace=state.modes.battle.workspaces[key];
  workspace.inputs.battleType=type;
  workspace.inputs.battleMethod=method;
  workspace.inputs.arachne=!!encounter?.arachneBonus;
  if(encounter?.battleType==='epic')workspace.inputs.enemySquadTypes=enemySquadTypes(encounter.enemyFormation);
  return workspace;
}
function currentBattleWorkspace(){
  return ensureBattleWorkspace(
    state.modes.battle.activeBattleType,
    state.modes.battle.activeBattleMethod
  );
}
function linkedEpicArmyWorkspaces(encounterId=state.modes.battle.activeEncounterId){
  const groupId=epicArmyGroup(encounterId);
  if(!groupId)return[];
  return EPIC_ARMY_GROUPS[groupId].encounters.flatMap(id=>{
    const workspace=state.modes.battle.workspaces[id];
    return workspace?.inputs?.shareEpicArmy?[{id,workspace}]:[];
  });
}
function propagateSharedEpicArmy(){
  const id=state.modes.battle.activeEncounterId,source=state.modes.battle.workspaces[id];
  if(!source?.inputs?.shareEpicArmy||!epicArmyGroup(id))return;
  for(const peer of linkedEpicArmyWorkspaces(id))if(peer.id!==id)copySharedEpicArmy(source,peer.workspace);
}
function activateAccount(accountId){
  if(!state.accounts[accountId])return;
  state.activeAccountId=accountId;
  state.modes.battle=state.accounts[accountId].battle;
  const battle=state.modes.battle;
  battle.activeBattleCategory=battle.activeBattleCategory||'epic';
  battle.activeEncounterByType=battle.activeEncounterByType||{epic:'epic-doomsday',pvp:'pvp-single'};
  battle.activeEncounterId=battle.activeEncounterId||battle.activeEncounterByType[battle.activeBattleCategory]||'epic-doomsday';
  battle.activeBattleType=currentEngineBattleType();
  ensureBattleWorkspace();
}
function modeState(){return activeMode==='battle'?currentBattleWorkspace():state.modes[activeMode];}
function cacheElements(){['leadership','leadershipFill','autoLeadership','authority','authorityFill','autoAuthority','dominance','dominanceFill','autoDominance','monsterHealth',...BONUS_PROFILE_FIELD_IDS,...BONUS_INPUT_ROWS.map(row=>row.auto),'humanBonusDisclosure','humanBonusDetails','humanProfileStatus','arachne','arachneRow','rankSeparation','rankSeparationValue','resetAdvancedSettings','resetCalculator','modeDescription','separationLabel','separationMin','separationMid','separationMax','orderView','troopOrderList','monsterOrderList','mercenaryOrderList','clearAllSelections','reviewSelection','reviewProgressModal','reviewProgressDetail','reviewProgressTrack','reviewProgressBar','reviewProgressPercent','reviewEvaluations','reviewElapsed','cancelReviewSelection','reviewProposalDialog','reviewProposalSummary','reviewCurrentEld','reviewProposedEld','reviewImprovement','reviewAddedUnits','reviewRemovedUnits','keepCurrentSelection','acceptReviewSelection','guardsmanSelection','specialistSelection','engineerSelection','monsterSelection','mercenarySelection','guardsmanCount','specialistCount','engineerCount','monsterCardCount','mercenaryCardCount','guardsmanMaster','specialistMaster','engineerMaster','monsterMaster','mercenaryMaster','validationBox','resultsView','resultStatus','resultsMethodSwitch','resultEmpty','resultGroups','troopResults','monsterResults','mercenaryResults','leadershipBar','authorityBar','dominanceBar','leadershipActual','authorityActual','dominanceActual','layerChartPanel','layerChartEmpty','layerChartScroll','layerHealthChart','layerChartTooltip','monsterStrength','strengthAgainstEpic','monsterDD','monsterST','epicPredictionPanel','expectedLifetimeDamage','rawGoldRevival','estimatedEpicPoints','epicPointsPerFullGold','encounterNormField','encounterNormSource','encounterPlanEntry','encounterPlanSource','encounterPlanPreview','encounterPlanTitle','encounterPlanNorm','encounterPlanUnit','encounterPlanHits','encounterPlanStrategies','encounterPlanNote','predictionMeta','predictionRows','optimizeArmy','optimizeHelp','optimizerModal','optimizerProgressHeadline','optimizerProgressTrack','optimizerProgressBar','optimizerProgressPercent','optimizerProgressEvaluations','optimizerProgressDetail','optimizerProgressCurrentEld','optimizerProgressBestEld','optimizerElapsedTime','cancelOptimization','useCustomHealthInputs','classicBattleDetails','classicBattleMeta','classicBattleRows','includeMercenariesInOptimization','battleBetaPanel','battleContextNote','battleMethodNote','battleTypeSelect','battleMethodSelect','pvpEnemyUnitField','pvpEnemyUnitSelect','strengthAgainstEpicField','pvpHealthField','pvpHealth','pvpStrengthField','pvpStrength','pvpCpDetailsPanel','pvpCpLifetimeDamage','pvpCpFullGold','pvpCpEnemyName','pvpCpDetailsMeta','pvpCpDetailsRows','templeLevel','templeMultiplier','pvpCpFullSilver','setupStepNumber','selectionStepNumber','minimumSeparation','fixedSeparationControl','customOrderFloatingMetric','resetCustomOrderDefault','accountSelect','addAccount','duplicateAccount','renameAccount','removeAccount','exportAccount','importAccount','biffFileInput','biffImportDialog','biffImportForm','biffImportAccountName','biffImportName','biffImportEncounterCount','biffImportWorkspaceCount','biffImportWarnings','biffImportWarningList','biffImportError','cancelBiffImport','confirmBiffImport','encounterSelect','addEncounter','duplicateEncounter','editEncounter','removeEncounter','encounterDialog','encounterForm','encounterDialogTitle','encounterName','epicFormationFields','enemyFlying','enemyMounted','enemyMelee','enemyRanged','encounterArachneBonus','pvpModelField','encounterPvpModel','encounterFormError','cancelEncounter'].forEach(id=>els[id]=document.getElementById(id));}
function formatFieldInteger(el){const n=parseNumber(el.value);el.value=n?Math.round(n).toLocaleString('en-US'):'';}
function formatFillPercent(el){const n=parseNumber(el.value);el.value=Number.isFinite(n)?n.toFixed(2):'0.00';}
const TIER_COLORS={9:'#69b85a',8:'#9aa4ad',7:'#d8ad42',6:'#d96858',5:'#d7974b',4:'#9673c8',3:'#55a6cf',2:'#7eae59',1:'#8f9892'};
const MERC_SUBTYPE_LIGHTEN={MNST:0,COM:.06,SPCL:.12,GRD:.18,EMH:.24,EX:.30,ARNE:.36,ENG:.42};
function mercSubtype(level){const parts=String(level||'').toUpperCase().split('-');return parts.length>1?parts.slice(1).join('-'):'';}
function outputRowColors(category,row){const tier=tierNumber(row.level);let base=TIER_COLORS[tier]||'#34495a';if(category==='troop'){const meta=units.troop.find(u=>u.id===row.id),cls=String(meta?.class||'').toUpperCase(),lighten=cls==='SPECIALIST'?.16:cls==='ENGINEER'?.30:0;base=mixHex(base,'#ffffff',lighten);}else if(category==='mercenary'){const subtype=mercSubtype(row.level),lighten=MERC_SUBTYPE_LIGHTEN[subtype]??0;base=mixHex(base,'#ffffff',lighten);}const rowColor=mixHex(base,'#061725',.62),accent=mixHex(base,'#ffffff',.12),soft=mixHex(base,'#061725',.78);return{rowColor,accent,soft};}

function orderRowColors(category,level){
  const tier=tierNumber(level);
  let base=TIER_COLORS[tier]||'#34495a';

  if(category==='troop'){
    const prefix=String(level||'').toUpperCase().charAt(0);
    const lighten=prefix==='S'?.16:prefix==='E'?.30:0;
    base=mixHex(base,'#ffffff',lighten);
  }else if(category==='mercenary'){
    const subtype=mercSubtype(level);
    const lighten=MERC_SUBTYPE_LIGHTEN[subtype]??0;
    base=mixHex(base,'#ffffff',lighten);
  }

  return {
    rowColor:mixHex(base,'#061725',.42),
    accent:mixHex(base,'#ffffff',.22)
  };
}
function selectionLevelColors(category,level){
  const tier=tierNumber(level);
  let base=TIER_COLORS[tier]||'#718394';
  if(category==='troop'){
    const prefix=String(level||'').toUpperCase().charAt(0);
    const lighten=prefix==='S'?.10:prefix==='E'?.20:0;
    base=mixHex(base,'#ffffff',lighten);
  }else if(category==='mercenary'){
    const subtype=mercSubtype(level);
    base=mixHex(base,'#ffffff',(MERC_SUBTYPE_LIGHTEN[subtype]??0)*.30);
  }
  return{base,surface:mixHex(base,'#07141e',.74),surfaceStrong:mixHex(base,'#07141e',.62),border:mixHex(base,'#ffffff',.08),text:mixHex(base,'#ffffff',.25)};
}
function resultTextColor(category,row){
  const tier=tierNumber(row.level);
  let base=TIER_COLORS[tier]||'#718394';
  if(category==='troop'){
    const meta=units.troop.find(u=>u.id===row.id);
    const cls=String(meta?.class||'').toUpperCase();
    const lighten=cls==='SPECIALIST'?.08:cls==='ENGINEER'?.16:0;
    base=mixHex(base,'#ffffff',lighten);
  }else if(category==='mercenary'){
    const subtype=mercSubtype(row.level);
    base=mixHex(base,'#ffffff',(MERC_SUBTYPE_LIGHTEN[subtype]??0)*.45);
  }
  return mixHex(base,'#ffffff',.42);
}
function iconFallback(img){img.onerror=()=>{if(img.dataset.fallback)return;img.dataset.fallback='1';img.src='assets/unit-icons/missing-icon.svg';img.classList.add('missing-icon');};}

function legacyUnitFromCanonical(unit){
  const capacityField=unit.category==='troop'?'leadershipEach':unit.category==='monster'?'dominanceEach':'authorityEach';
  const mercGroupMap={COM:'COMMON',MNST:'MONSTER',SPCL:'SPECIALIST',GRD:'GUARDSMAN',EMH:'EPIC - HUNTER',EX:'EPIC - EVENT',ARNE:'ARACHNE',ENG:'ENGINEER'};
  const tierSubtype=String(unit.tier||'').toUpperCase().split('-').slice(1).join('-');
  const legacyClass=unit.category==='mercenary'?(mercGroupMap[tierSubtype]||unit.unitClass):unit.unitClass;
  return{
    id:unit.id,unitId:unit.unitId,
    category:unit.category,
    displayOrder:unit.displayOrder,
    class:legacyClass,
    type:unit.combatType,
    name:unit.name,
    level:unit.tier,
    strengthEach:unit.baseStrength,
    healthEach:unit.baseHealth,
    [capacityField]:unit.capacityCost,
    species:unit.species,
    selectionKey:`${unit.tier}|${unit.combatType}`,
    icon:unit.icon,
    bonuses:{...(unit.bonuses||{})},
    goldRevivalCost:Number(unit.goldRevivalCost||0),silverRevivalCost:Number(unit.silverRevivalCost||0)
  };
}

function populatePvpEnemyOptions(){
  if(!els.pvpEnemyUnitSelect||!armyV2.length)return;
  const previous=modeState().inputs.enemyUnitId||'troop-g9-flying-corax-2';
  els.pvpEnemyUnitSelect.innerHTML='';

  const addOption=(group,unit)=>{
    const option=document.createElement('option');
    option.value=unit.id;
    let tierLabel=unit.tier;
    if(unit.category==='mercenary'){
      const level=Number(String(unit.tier||'').split('-')[0]);
      tierLabel=({2:'II',7:'VII',6:'VI',5:'V'})[level]||String(unit.tier||'');
    }
    option.textContent=`${tierLabel} · ${unit.name} · ${unit.combatType}`;
    group.append(option);
  };

  const corax=armyV2.find(u=>u.id==='troop-g9-flying-corax-2');
  if(corax){
    const common=document.createElement('optgroup');
    common.label='Common 1-Squad PvP Enemy';
    addOption(common,corax);
    els.pvpEnemyUnitSelect.append(common);
  }

  const nonMercs=armyV2.filter(u=>u.category!=='mercenary');
  const familyOrder={G:0,S:1,E:2,M:3};
  nonMercs.sort((a,b)=>{
    const parse=u=>{
      const match=String(u.tier||'').toUpperCase().match(/^([GSEM])(\d+)$/);
      if(!match)return[9,0,9,Number(u.displayOrder||0)];
      const family=match[1],level=Number(match[2]);
      return[family==='M'?1:0,-level,familyOrder[family]??9,Number(u.displayOrder||0)];
    };
    const A=parse(a),B=parse(b);
    for(let i=0;i<A.length;i++)if(A[i]!==B[i])return A[i]-B[i];
    return 0;
  });

  let currentTier='',group=null;
  for(const unit of nonMercs){
    const tier=String(unit.tier||'').toUpperCase();
    if(tier!==currentTier){
      currentTier=tier;
      group=document.createElement('optgroup');
      group.label=tier;
      els.pvpEnemyUnitSelect.append(group);
    }
    addOption(group,unit);
  }

  // Mercenary enemy list: II, VII, VI, V. Within each level, preserve the
  // canonical army database display order exactly.
  const mercLevelOrder=['2','7','6','5'];
  const roman={2:'II',7:'VII',6:'VI',5:'V'};
  const mercs=armyV2.filter(u=>u.category==='mercenary');
  for(const level of mercLevelOrder){
    const list=mercs
      .filter(u=>String(u.tier||'').split('-')[0]===level)
      .sort((a,b)=>Number(a.displayOrder||0)-Number(b.displayOrder||0));
    if(!list.length)continue;
    const mercGroup=document.createElement('optgroup');
    mercGroup.label=`Mercenaries ${roman[Number(level)]||level}`;
    for(const unit of list)addOption(mercGroup,unit);
    els.pvpEnemyUnitSelect.append(mercGroup);
  }

  els.pvpEnemyUnitSelect.value=armyV2.some(u=>u.id===previous)?previous:'troop-g9-flying-corax-2';
}
function selectedPvpEnemy(){
  const id=modeState().inputs.enemyUnitId||'troop-g9-flying-corax-2';
  const canonical=armyV2.find(u=>u.id===id)||armyV2.find(u=>u.id==='troop-g9-flying-corax-2');
  return canonical?legacyUnitFromCanonical(canonical):null;
}
async function loadData(){
  // Use a root-relative URL first so the database loads correctly even when
  // the calculator is reached through a clean/mobile route. Fall back to the
  // document-relative URL for static/local hosting.
  const sources=['/data/army-v2.json','data/army-v2.json'];
  let lastError=null;
  for(const source of sources){
    try{
      const r=await fetch(source,{cache:'no-store'});
      if(!r.ok)throw new Error(`Army database request failed (${r.status})`);
      const data=await r.json();
      if(!Array.isArray(data)||!data.length)throw new Error('Army database is empty or invalid');
      const validation=validateArmyDatabase(data);
      if(!validation.valid)throw new Error(`Army database validation failed: ${validation.errors.join('; ')}`);
      armyV2=data;
      for(const category of ['troop','monster','mercenary']){
        units[category]=armyV2.filter(u=>u.category===category).map(legacyUnitFromCanonical);
      }
      populatePvpEnemyOptions();
      return;
    }catch(error){lastError=error;}
  }
  throw lastError||new Error('Could not load canonical army database');
}
async function loadEpicChestRewards(){
  for(const source of ['/data/chest-data.json','data/chest-data.json'])try{const response=await fetch(source,{cache:'no-store'});if(!response.ok)continue;const data=await response.json();epicChestRewards=new Map((data.records||[]).filter(record=>record.type==='EPIC').map(record=>[String(record.chest).toUpperCase(),record]));return;}catch{}
  console.warn('Epic chest rewards could not be loaded; encounter plans will show spending only.');
}
function loadSavedState(){
  try{
    const loaded=readLatestSavedState(localStorage,readSavedJson,{validate:validateAccountState});
    const currentSaved=loaded?.state;
    if(currentSaved?.preferences){
      if(Number.isFinite(Number(currentSaved.preferences.templeLevel)))state.preferences.templeLevel=Math.max(1,Math.min(45,Number(currentSaved.preferences.templeLevel)||45));
      state.preferences.chartStyle=currentSaved.preferences.chartStyle==='combined'?'combined':'separated';
    }
    if(currentSaved?.accounts&&Object.keys(currentSaved.accounts).length){
      state.accounts={};
      for(const [id,raw] of Object.entries(currentSaved.accounts))state.accounts[id]=hydrateAccount({...raw,id});
      state.activeAccountId=state.accounts[currentSaved.activeAccountId]?currentSaved.activeAccountId:Object.keys(state.accounts)[0];
      activateAccount(state.activeAccountId);activeMode='battle';return;
    }
    const saved=currentSaved;
    if(saved?.modes){
      if(saved.preferences&&Number.isFinite(Number(saved.preferences.templeLevel))){
        state.preferences.templeLevel=Math.max(1,Math.min(45,Number(saved.preferences.templeLevel)||45));
      }
      // Battle Calculator is now the public interface. Legacy calculator
      // workspaces remain stored and fully intact for rollback/testing.
      activeMode='battle';

      for(const mode of ['epic','optimizer','custom']){
        Object.assign(state.modes[mode].inputs,saved.modes[mode]?.inputs||{});
        for(const c of ['troop','monster','mercenary']){
          if(Array.isArray(saved.modes[mode]?.selectedIds?.[c]))
            state.modes[mode].selectedIds[c]=[...saved.modes[mode].selectedIds[c]];
          if(mode==='custom'&&Array.isArray(saved.modes.custom?.orders?.[c]))
            state.modes.custom.orders[c]=[...saved.modes.custom.orders[c]];
          if(mode==='custom'&&Array.isArray(saved.modes.custom?.squadOrder?.[c]))
            state.modes.custom.squadOrder[c]=[...saved.modes.custom.squadOrder[c]];
        }
      }

      const b=saved.modes.battle;
      if(b?.workspaces){
        delete state.modes.battle.activeBattleCategory;
        delete state.modes.battle.activeEncounterId;
        state.modes.battle.activeBattleType=b.activeBattleType||'epic_standard';
        state.modes.battle.activeBattleMethod=b.activeBattleMethod==='optimize'?'optimize':'custom';

        const entries=Object.entries(b.workspaces);

        // Saved calculator data can contain a mixture of legacy method-keyed
        // workspaces (for example "epic_standard.custom") and current
        // battle-type workspaces ("epic_standard"). Restore each entry by its
        // own shape instead of treating every workspace as legacy when any old
        // key exists.
        const legacyGrouped={};
        const restoredTypes=new Set();

        for(const [key,ws] of entries){
          const isCurrentTypeWorkspace=!!ws?.methods&&!key.includes('.');
          if(isCurrentTypeWorkspace){
            const type=key||ws?.inputs?.battleType||'epic_standard';
            state.modes.battle.workspaces[battleWorkspaceKey(type)]=makeBattleWorkspace(type,ws);
            restoredTypes.add(type);
            continue;
          }

          // Legacy method-keyed workspace.
          const split=key.split('.');
          const type=split[0]||ws?.inputs?.battleType||'epic_standard';
          const method=split[1]||ws?.inputs?.battleMethod||'basic';
          if(!legacyGrouped[type])legacyGrouped[type]={};
          legacyGrouped[type][method]=ws;
        }

        for(const [type,methods] of Object.entries(legacyGrouped)){
          // A current type-keyed workspace is authoritative if both formats
          // are present. This prevents stale legacy keys from resetting a
          // newer Custom Order after a browser restart.
          if(restoredTypes.has(type))continue;

          let sharedSeed=null;
          if(type===state.modes.battle.activeBattleType){
            sharedSeed=methods[state.modes.battle.activeBattleMethod]||null;
          }
          sharedSeed=sharedSeed||methods.basic||methods.custom||methods.optimize||Object.values(methods)[0]||null;

          const legacyCustom=methods.custom||{};
          const merged={
            inputs:{...(sharedSeed?.inputs||{})},
            selectedIds:cloneIds(sharedSeed?.selectedIds),
            methods:{
              basic:{},
              custom:{
                orders:cloneOrders(legacyCustom?.methods?.custom?.orders??legacyCustom?.orders),
                unitOrders:cloneUnitOrders(legacyCustom?.methods?.custom?.unitOrders??legacyCustom?.unitOrders),
                unitOrderManual:cloneUnitOrderManual(legacyCustom?.methods?.custom?.unitOrderManual??legacyCustom?.unitOrderManual),
                squadOrder:cloneSquadOrder(legacyCustom?.methods?.custom?.squadOrder??legacyCustom?.squadOrder)
              },
              optimize:{
                resultCache:methods.optimize?.methods?.optimize?.resultCache??methods.optimize?.resultCache??null
              }
            }
          };

          state.modes.battle.workspaces[battleWorkspaceKey(type)]=makeBattleWorkspace(type,merged);
        }
      }else if(b){
        // Older single Battle Calculator workspace.
        const type=b.inputs?.battleType||'epic_standard';
        const method=b.inputs?.battleMethod==='optimize'?'optimize':'custom';
        state.modes.battle.activeBattleType=type;
        state.modes.battle.activeBattleMethod=method;
        state.modes.battle.workspaces[battleWorkspaceKey(type)]=makeBattleWorkspace(type,b);
      }

      const legacyBattle=state.modes.battle;
      initialAccount.templeLevel=state.preferences.templeLevel;
      initialAccount.battle=legacyBattle;
      initialAccount.battle.activeBattleCategory=String(legacyBattle.activeBattleType||'').startsWith('pvp_')?'pvp':'epic';
      initialAccount.battle.activeEncounterByType={epic:'epic-doomsday',pvp:'pvp-single'};
      const legacyEncounter={epic_arachne:'epic-arachne',pvp_single_cp:'pvp-single',pvp_unknown:'pvp-unknown'}[legacyBattle.activeBattleType]||'epic-doomsday';
      initialAccount.battle.activeEncounterId=legacyEncounter;
      const oldWorkspaces=legacyBattle.workspaces||{};initialAccount.battle.workspaces={};
      for(const [oldKey,workspace] of Object.entries(oldWorkspaces)){
        const mapped={epic_arachne:'epic-arachne',pvp_single_cp:'pvp-single',pvp_unknown:'pvp-unknown',epic_standard:'epic-doomsday'}[oldKey]||oldKey;
        initialAccount.battle.workspaces[mapped]=workspace;
      }
      state.accounts={main:initialAccount};state.activeAccountId='main';activateAccount('main');
      return;
    }
  }catch(error){
    console.warn('Could not restore saved calculator state.',error);
  }
  ensureBattleWorkspace();
}
function saveState(){
  try{
    if(activeMode==='battle')propagateSharedEpicArmy();
    writeSavedJson(localStorage,STORAGE_KEY,{schemaVersion:SAVED_STATE_SCHEMA_VERSION,activeMode,activeAccountId:state.activeAccountId,accounts:persistentAccountSnapshot(state.accounts),preferences:state.preferences,modes:{epic:state.modes.epic,optimizer:state.modes.optimizer,custom:state.modes.custom}},{validate:validateAccountState});
  }catch(error){
    // Persistence must never interrupt a selection or calculation-method UI
    // transition. Optimizer results are stored under their own bounded key.
    console.warn('Could not save calculator state.',error);
  }
}
function safeBiffFileName(name){
  const stem=String(name||'tbtoolkit-account').trim().replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,80)||'tbtoolkit-account';
  return `${stem}.stacks`;
}
function downloadActiveAccountBiff(){
  readInputs();saveState();
  const account=currentAccount();
  const workspaces=Object.fromEntries(Object.entries(account.battle.workspaces).map(([encounterId,workspace])=>{
    let cached=workspace.resultCache;
    if(!cached){
      try{cached=readSavedJson(localStorage,`tbtoolkit.battleCalculator.optimizerResult.v4.${account.id}.${encounterId}`);}
      catch(error){console.warn(`Could not read optimized result for ${encounterId}.`,error);}
    }
    return[encounterId,{...workspace,methods:{...workspace.methods,optimize:{...workspace.methods?.optimize,resultCache:cached?.build===OPTIMIZER_CACHE_BUILD?cached:null}}}];
  }));
  const text=serializeAccountToBiff({...account,battle:{...account.battle,workspaces}},{appBuild:APP_BUILD});
  const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=safeBiffFileName(currentAccount().name);
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function allCustomEncounterIds(){return Object.values(state.accounts).flatMap(account=>Object.keys(account.customEncounters||{}));}
function comparableName(value){return String(value||'').trim().toLocaleLowerCase();}
function accountNameExists(name,excludeId=null){return Object.values(state.accounts).some(account=>account.id!==excludeId&&comparableName(account.name)===comparableName(name));}
function promptForUniqueAccountName(message,suggested,excludeId=null){
  while(true){
    const raw=prompt(message,suggested);if(raw===null)return null;
    const name=raw.trim();let error='';
    if(!name)error='Enter a Player Account name.';
    else if(name.length>60)error='Player Account names must be 60 characters or fewer.';
    else if(accountNameExists(name,excludeId))error=`A Player Account named “${name}” already exists. Choose a different name.`;
    if(error){alert(error);suggested=name;continue;}
    return name;
  }
}
function importedAccountNameSuggestion(sourceName){
  const base=String(sourceName||'Imported Account').trim().slice(0,60)||'Imported Account';
  const used=new Set(Object.values(state.accounts).map(account=>String(account.name||'').trim().toLocaleLowerCase()));
  if(!used.has(base.toLocaleLowerCase()))return base;
  const copyBase=`${base.slice(0,55).trim()} Copy`;
  if(!used.has(copyBase.toLocaleLowerCase()))return copyBase;
  let index=2,candidate='';
  do{const suffix=` Copy ${index++}`;candidate=`${base.slice(0,60-suffix.length).trim()}${suffix}`;}while(used.has(candidate.toLocaleLowerCase()));
  return candidate;
}
function validateImportedAccountName(){
  const name=String(els.biffImportName?.value||'').trim();
  let error='';
  if(!name)error='Enter a name for the new Player Account.';
  else if(name.length>60)error='Player Account names must be 60 characters or fewer.';
  else if(accountNameExists(name))error=`A Player Account named “${name}” already exists. Choose a different name.`;
  els.biffImportError.textContent=error;
  els.biffImportError.classList.toggle('show',!!error);
  els.confirmBiffImport.disabled=!!error||!pendingBiffImport;
  return error?'':name;
}
function showBiffImportPreview(materialized){
  pendingBiffImport=materialized;
  els.biffImportAccountName.textContent=materialized.summary.accountName;
  els.biffImportName.value=importedAccountNameSuggestion(materialized.summary.accountName);
  els.biffImportEncounterCount.textContent=String(materialized.summary.encounterCount);
  els.biffImportWorkspaceCount.textContent=String(materialized.summary.workspaceCount);
  els.biffImportError.textContent='';
  els.biffImportError.classList.remove('show');
  els.confirmBiffImport.disabled=false;
  els.biffImportWarningList.innerHTML='';
  for(const warning of materialized.warnings){const item=document.createElement('li');item.textContent=warning;els.biffImportWarningList.append(item);}
  els.biffImportWarnings.hidden=!materialized.warnings.length;
  validateImportedAccountName();
  els.biffImportDialog.showModal();
  els.biffImportName.focus();els.biffImportName.select();
}
function showBiffImportError(error){
  pendingBiffImport=null;
  els.biffImportAccountName.textContent='Could not read file';
  els.biffImportEncounterCount.textContent='—';els.biffImportWorkspaceCount.textContent='—';
  els.biffImportWarnings.hidden=true;els.biffImportWarningList.innerHTML='';
  els.biffImportError.textContent=error?.message||'The selected .stacks or legacy .biff file could not be imported.';
  els.biffImportError.classList.add('show');
  els.confirmBiffImport.disabled=true;
  if(!els.biffImportDialog.open)els.biffImportDialog.showModal();
}
async function prepareBiffImport(file){
  if(!file)return;
  if(file.size>BIFF_MAX_BYTES){showBiffImportError(new Error('This account file is larger than 5 MB.'));return;}
  try{
    const parsed=parseBiff(await file.text());
    const materialized=materializeImportedAccount(parsed,{
      existingAccountIds:Object.keys(state.accounts),
      existingEncounterIds:allCustomEncounterIds(),
      builtInEncounterIds:BUILT_IN_ENCOUNTERS.map(row=>row.id),
      armyIds:armyV2.map(row=>row.id),
      optimizerCacheBuild:OPTIMIZER_CACHE_BUILD
    });
    showBiffImportPreview(materialized);
  }catch(error){showBiffImportError(error);}
}
function confirmPendingBiffImport(){
  if(!pendingBiffImport)return;
  const name=validateImportedAccountName();if(!name)return;
  const imported=hydrateAccount({...pendingBiffImport.account,name});
  const previousAccounts=state.accounts,previousAccountId=state.activeAccountId,previousBattle=state.modes.battle;
  try{
    const candidate={...state.accounts,[imported.id]:imported};
    validateAccountCollection(candidate,imported.id);
    state.accounts=candidate;activateAccount(imported.id);saveState();
    for(const [encounterId,workspace] of Object.entries(imported.battle.workspaces)){
      const cache=workspace.methods?.optimize?.resultCache;
      if(!cache||cache.build!==OPTIMIZER_CACHE_BUILD)continue;
      try{writeSavedJson(localStorage,`tbtoolkit.battleCalculator.optimizerResult.v4.${imported.id}.${encounterId}`,cache);}
      catch(error){console.warn(`Could not persist imported optimized result for ${encounterId}; it remains available for this session.`,error);}
    }
    pendingBiffImport=null;els.biffImportDialog.close();els.biffFileInput.value='';
    loadSavedOptimizerResult();refreshActiveMode();
  }catch(error){
    state.accounts=previousAccounts;state.activeAccountId=previousAccountId;state.modes.battle=previousBattle;
    els.biffImportError.textContent=`Nothing was imported. ${error?.message||'Browser storage could not be updated.'}`;
    els.biffImportError.classList.add('show');
  }
}
function optimizerResultStorageKeyFor(encounterId){return`tbtoolkit.battleCalculator.optimizerResult.v4.${state.activeAccountId}.${encounterId}`;}
function optimizerResultStorageKey(){
  return activeMode==='battle'
    ?optimizerResultStorageKeyFor(battleWorkspaceKey(state.modes.battle.activeBattleType))
    :OPTIMIZER_RESULT_KEY;
}
function compactOptimizerPayloadForStorage(payload){
  if(!payload?.result)return payload;
  const result={...payload.result};
  // Initiative event traces are useful while scoring, but the results UI is
  // fully reconstructed from squads and summary fields. Keeping every trace
  // for every encounter can exhaust the browser's local-storage quota.
  delete result.cases;
  const diagnostics={...(payload.diagnostics||{})};
  // This search-only list is not rendered after optimization and can contain
  // hundreds of candidate summaries.
  delete diagnostics.practicalCandidateSummary;
  // The optimizer also returns its initial scored army and many search-only
  // diagnostics. Neither is needed to reconstruct the Results UI. Retaining
  // them made each encounter cache much larger than necessary and could fill
  // the origin's local-storage quota after several optimized encounters.
  const persistedDiagnostics={};
  for(const key of [
    'displayingOpeningSacrificeAlternativeId','evaluations','improvementPct',
    'maximumExpectedLifetimeDamage','mercenaryOptimizationMode',
    'optimizationElapsedMs','practicalTieBreakApplied',
    'practicalTieBreakLossPct','totalEvaluations','unusualSacrifices',
    'fixedMercenaries','optimizerCoreExpectedLifetimeDamage',
    'combinedExpectedLifetimeDamage'
  ])if(diagnostics[key]!==undefined)persistedDiagnostics[key]=diagnostics[key];
  return{quantities:{...(payload.quantities||{})},result,diagnostics:persistedDiagnostics};
}
function optimizerResultCacheKeys(){
  const prefix='tbtoolkit.battleCalculator.optimizerResult.v4.';
  const keys=[];
  for(let index=0;index<localStorage.length;index++){
    const key=localStorage.key(index);
    if(key?.startsWith(prefix))keys.push(key);
  }
  return keys;
}
function writeOptimizerResultWithQuotaRecovery(key,saved){
  try{
    writeSavedJson(localStorage,key,saved);
    return;
  }catch(firstError){
    // Optimizer results are reproducible caches. If accumulated caches fill
    // browser storage, discard the oldest other encounter cache and retry so
    // the result the player just waited for is the one that survives.
    const candidates=optimizerResultCacheKeys().filter(candidate=>candidate!==key).map(candidate=>{
      let savedAt=0;
      try{savedAt=Number(readSavedJson(localStorage,candidate)?.savedAt)||0;}catch{}
      return{key:candidate,savedAt};
    }).sort((a,b)=>a.savedAt-b.savedAt);
    for(const candidate of candidates){
      localStorage.removeItem(candidate.key);
      try{
        writeSavedJson(localStorage,key,saved);
        return;
      }catch{}
    }
    throw firstError;
  }
}
function loadSavedOptimizerResult(){
  try{
    lastOptimizedEpicPayload=null;lastOptimizedEpicSignature='';lastEpicRunDiagnostics=null;
    const encounterId=state.modes.battle.activeEncounterId,shared=activeMode==='battle'&&currentBattleWorkspace().inputs.shareEpicArmy&&canReuseEpicOptimizerResult(encounterId);
    const candidates=shared?linkedEpicArmyWorkspaces(encounterId).filter(peer=>canReuseEpicOptimizerResult(peer.id)):[{id:encounterId,workspace:activeMode==='battle'?currentBattleWorkspace():null}];
    const signature=shared?currentEpicEffectiveSignature():null;
    let saved=null;
    for(const candidate of candidates){
      const available=[candidate.workspace?.resultCache];
      try{available.push(readSavedJson(localStorage,activeMode==='battle'?optimizerResultStorageKeyFor(candidate.id):optimizerResultStorageKey()));}
      catch(error){console.warn(`Could not read persisted optimizer result for ${candidate.id}.`,error);}
      for(const cache of available){
        if(cache?.build!==OPTIMIZER_CACHE_BUILD||!cache.payload||!cache.signature)continue;
        const normalizedSignature=normalizeEpicOptimizerSignature(cache.signature);
        if(shared&&normalizedSignature!==signature)continue;
        if(!saved||Number(cache.savedAt)>Number(saved.savedAt))saved={...cache,signature:normalizedSignature};
      }
    }
    if(!saved?.payload||!saved?.signature||saved.build!==OPTIMIZER_CACHE_BUILD)return;
    lastOptimizedEpicPayload=saved.payload;
    lastOptimizedEpicSignature=saved.signature;
    lastEpicRunDiagnostics=saved.runDiagnostics??null;
    if(activeMode==='battle')currentBattleWorkspace().resultCache=saved;
  }catch(error){console.warn('Could not restore saved optimizer result.',error);}
}
function saveOptimizerResult(){
  if(!lastOptimizedEpicPayload||!lastOptimizedEpicSignature)return;
  const saved={build:OPTIMIZER_CACHE_BUILD,payload:compactOptimizerPayloadForStorage(lastOptimizedEpicPayload),signature:lastOptimizedEpicSignature,runDiagnostics:lastEpicRunDiagnostics,savedAt:Date.now()};
  // Always preserve the encounter result in memory before attempting the
  // quota-limited local-storage copy, so encounter switching remains safe.
  if(activeMode==='battle')currentBattleWorkspace().resultCache=saved;
  try{
    writeOptimizerResultWithQuotaRecovery(optimizerResultStorageKey(),saved);
  }catch(error){console.warn('Could not persist optimizer result outside this browser session.',error);}
  saveState();
}
function clearSavedOptimizerResult(){
  lastOptimizedEpicPayload=null;lastOptimizedEpicSignature='';lastEpicRunDiagnostics=null;
  localStorage.removeItem(optimizerResultStorageKey());
  if(activeMode==='battle')currentBattleWorkspace().resultCache=null;
}
function updateRankSeparationDisplay(){const max=1;const v=Math.min(max,Math.max(0,parseNumber(els.rankSeparation?.value)));if(els.rankSeparationValue)els.rankSeparationValue.value=`${v.toFixed(2)}%`;}

function hydrateAccount(raw){
  const account=makeAccount({id:raw?.id,name:raw?.name,templeLevel:raw?.templeLevel,clanProfileId:raw?.clanProfileId});
  account.customEncounters={...(raw?.customEncounters||{})};
  const source=raw?.battle||{};
  account.battle.activeBattleCategory=source.activeBattleCategory||'epic';
  account.battle.activeEncounterByType={...account.battle.activeEncounterByType,...(source.activeEncounterByType||{})};
  account.battle.activeEncounterId=source.activeEncounterId||account.battle.activeEncounterByType[account.battle.activeBattleCategory];
  account.battle.activeBattleMethod=source.activeBattleMethod==='optimize'?'optimize':'custom';
  account.battle.workspaces={};
  for(const [id,workspace] of Object.entries(source.workspaces||{}))account.battle.workspaces[id]=makeBattleWorkspace(workspace?.inputs?.battleType,workspace);
  return account;
}
function renderClanProfileLink(){
  const select=document.getElementById('clanProfileSelect'),status=document.getElementById('clanProfileStatus'),members=document.getElementById('encounterPlanMembers');
  if(!select||!status||!members)return;
  const linkedId=currentAccount()?.clanProfileId||'',profiles=readClanProfiles(localStorage).profiles;
  select.innerHTML='<option value="">None · independent planning</option>';
  for(const profile of profiles){const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name||'Unnamed clan';select.append(option);}
  if(linkedId&&!profiles.some(profile=>profile.id===linkedId)){const option=document.createElement('option');option.value=linkedId;option.textContent='Linked profile unavailable · choose another';select.append(option);}
  select.value=linkedId;
  const profile=profiles.find(item=>item.id===linkedId);
  members.readOnly=!!profile;
  if(profile){members.value=String(Math.min(100,Math.max(1,Math.floor(Number(profile.plan?.recipients)||100))));status.textContent=`Linked to ${profile.name}. Clan size and Epic norms come from Clan Overview; calculator overrides stay local.`;}
  else status.textContent=linkedId?'Linked clan profile is unavailable here. Import its .norms file or choose another profile.':'Optional. Link a Clan Overview profile to use its requirements.';
}
function refreshWorkspaceSelectors(){
  if(!els.accountSelect)return;
  els.accountSelect.innerHTML='';
  for(const account of Object.values(state.accounts)){
    const option=document.createElement('option');option.value=account.id;option.textContent=account.name;els.accountSelect.append(option);
  }
  els.accountSelect.value=state.activeAccountId;
  renderClanProfileLink();
  const account=currentAccount(),battle=state.modes.battle,category=battle.activeBattleCategory||'epic';
  els.battleTypeSelect.value=category;
  const choices=encountersForAccount(account,category);
  if(!choices.some(row=>row.id===battle.activeEncounterId))battle.activeEncounterId=choices[0]?.id;
  battle.activeEncounterByType[category]=battle.activeEncounterId;
  battle.activeBattleType=currentEngineBattleType();
  els.encounterSelect.innerHTML='';
  for(const encounter of choices){const option=document.createElement('option');option.value=encounter.id;option.textContent=encounter.name;els.encounterSelect.append(option);}
  els.encounterSelect.value=battle.activeEncounterId;
  const builtIn=isBuiltInEncounter(battle.activeEncounterId);
  els.editEncounter.disabled=builtIn;els.removeEncounter.disabled=builtIn;els.removeAccount.disabled=Object.keys(state.accounts).length<=1;
  renderEpicArmySharing();
}
function renderEpicArmySharing(){
  const panel=els.epicArmySharing,groupId=epicArmyGroup(state.modes.battle.activeEncounterId);
  if(!panel)return;
  panel.hidden=activeMode!=='battle'||state.modes.battle.activeBattleCategory!=='epic'||!groupId;
  if(panel.hidden)return;
  const linked=!!currentBattleWorkspace().inputs.shareEpicArmy,peers=linkedEpicArmyWorkspaces(),other=peers.filter(peer=>peer.id!==state.modes.battle.activeEncounterId);
  const group=EPIC_ARMY_GROUPS[groupId];
  els.epicArmySharingTitle.textContent=`${group.label} army`;
  const names=other.map(peer=>resolveEncounter(currentAccount(),peer.id)?.name||peer.id);
  els.epicArmySharingStatus.textContent=linked
    ?`Linked with ${names.length?names.join(', '):'no other encounters yet'}. Stats and selected units stay in sync.${state.modes.battle.activeEncounterId==='epic-arachne'?' Arachne keeps its own optimizer result.':''}`
    :`Independent. ${other.length?`Shared army available from ${names.join(', ')}.`:'Start a shared army for this group.'}`;
  els.toggleEpicArmySharing.textContent=linked?'Edit independently':other.length?'Use shared army':'Share this army';
  els.replaceSharedEpicArmy.hidden=linked||!other.length;
  panel.classList.toggle('is-linked',linked);
}
function openEncounterEditor(encounter=null,duplicate=false){
  const category=state.modes.battle.activeBattleCategory;
  els.encounterForm.dataset.editId=encounter&&!duplicate?encounter.id:'';
  els.encounterDialogTitle.textContent=encounter?(duplicate?'Duplicate Encounter':'Edit Encounter'):'New Encounter';
  els.encounterName.value=encounter?`${encounter.name}${duplicate?' Copy':''}`:'';
  const formation=encounter?.enemyFormation||{FLYING:1,MOUNTED:1,MELEE:1,RANGED:1};
  els.enemyFlying.value=formation.FLYING||0;els.enemyMounted.value=formation.MOUNTED||0;els.enemyMelee.value=formation.MELEE||0;els.enemyRanged.value=formation.RANGED||0;
  els.encounterArachneBonus.checked=!!encounter?.arachneBonus;
  els.encounterPvpModel.value=encounter?.pvpModel||'single';
  els.epicFormationFields.hidden=category!=='epic';els.pvpModelField.hidden=category!=='pvp';els.encounterFormError.textContent='';els.encounterFormError.classList.remove('show');
  els.encounterDialog.showModal();
}
function copyWorkspace(source){return source?JSON.parse(JSON.stringify(source)):null;}

function setDerivedField(id,value,readonly=true){
  if(!els[id])return;
  els[id].value=Number.isFinite(Number(value))?String(Math.max(0,Number(value))):'0';
  els[id].readOnly=readonly;
  els[id].disabled=readonly;
  els[id].tabIndex=readonly?-1:0;
  els[id].setAttribute('aria-readonly',String(readonly));
}
function syncDerivedHealthInputs(){syncDerivedEpicBonuses();}
function copyBonusRow(targetKey,sourceKey,readonly){
  for(const stat of ['Health','Strength','DD','ST'])setDerivedField(`${targetKey}${stat}`,parseNumber(els[`${sourceKey}${stat}`]?.value),readonly);
}
function updateBonusGroupStatus(rows,statusId,profile){
  const mixed=rows.some(({auto})=>!els[auto]?.checked);
  if(els[statusId]){els[statusId].hidden=!mixed;els[statusId].textContent='Mixed';}
  document.querySelector(`[data-bonus-profile="${profile}"]`)?.classList.toggle('has-mixed-profiles',mixed);
}
function syncDerivedEpicBonuses(){
  const mh=parseNumber(els.monsterHealth?.value),ms=parseNumber(els.monsterStrength?.value),dd=parseNumber(els.monsterDD?.value),st=parseNumber(els.monsterST?.value);
  for(const {key,auto} of MONSTER_CHILD_BONUS_ROWS){if(els[auto]?.checked)copyBonusRow(key,'monster',true);else for(const stat of ['Health','Strength','DD','ST'])setDerivedField(`${key}${stat}`,parseNumber(els[`${key}${stat}`]?.value),false);}
  if(els.autoHumanBonuses?.checked){setDerivedField('humanHealth',Math.max(0,mh-100),true);setDerivedField('humanStrength',Math.max(0,ms-100),true);setDerivedField('humanDD',dd,true);setDerivedField('humanST',Math.max(0,st-5),true);}
  else for(const stat of ['Health','Strength','DD','ST'])setDerivedField(`human${stat}`,parseNumber(els[`human${stat}`]?.value),false);
  for(const {key,auto} of HUMAN_CHILD_BONUS_ROWS){if(els[auto]?.checked)copyBonusRow(key,'human',true);else for(const stat of ['Health','Strength','DD','ST'])setDerivedField(`${key}${stat}`,parseNumber(els[`${key}${stat}`]?.value),false);}
  const {key,auto,healthOffset,strengthOffset}=EPIC_HUNTER_BONUS_ROW;
  if(els[auto]?.checked){setDerivedField(`${key}Health`,Math.max(0,mh-healthOffset),true);setDerivedField(`${key}Strength`,Math.max(0,ms-strengthOffset),true);setDerivedField(`${key}DD`,dd,true);setDerivedField(`${key}ST`,Math.max(0,st-5),true);}
  else for(const stat of ['Health','Strength','DD','ST'])setDerivedField(`${key}${stat}`,parseNumber(els[`${key}${stat}`]?.value),false);
  for(const row of BONUS_INPUT_ROWS){const label=els[row.auto]?.nextElementSibling;if(label)label.textContent=els[row.auto].checked?(LINKED_BONUS_ROWS.includes(row)?'Linked':'Auto'):'Manual';}
  updateBonusGroupStatus(MONSTER_CHILD_BONUS_ROWS,'monsterProfileStatus','monster');
  updateBonusGroupStatus(HUMAN_CHILD_BONUS_ROWS,'humanProfileStatus','human');
}
function epicBonusPayload(){
  const i=modeState().inputs;
  return{
    monsterHealthPct:parseNumber(i.monsterHealth),
    monsterStrengthPct:parseNumber(i.monsterStrength),
    strengthAgainstEpicPct:parseNumber(i.strengthAgainstEpic),
    monsterDDPct:parseNumber(i.monsterDD),
    monsterSTPct:parseNumber(i.monsterST),
    arachne:activeMode!=='custom'&&!!i.arachne,
    enemySquadTypes:i.enemySquadTypes,
    includeMercenariesInOptimization:!!i.includeMercenariesInOptimization,
    useCustomProfileBonuses:true,
    customProfileBonuses:Object.fromEntries(BONUS_PROFILE_ROWS.flatMap(({key})=>['Health','Strength','DD','ST'].map(stat=>[`${key}${stat}Pct`,parseNumber(i[`${key}${stat}`])]))),
  };
}
function fixedStandardMercenaryQuantitiesForOptimizer(){
  const i=modeState().inputs;
  if(i.includeMercenariesInOptimization)return {};
  const selected=[...(modeState().selectedIds.mercenary||[])];
  if(!selected.length)return {};

  const inputs=baseEngineInputs();
  // Custom's fixed-separation choice must not change the optimizer's fixed
  // mercenary army or invalidate a saved optimized result.
  inputs.minimumSeparation=true;
  // resolveAutoFills() has already established the authoritative fill used by
  // the current workspace. Preserve a manual fill exactly; Max Fill uses the
  // safe Standard fill found for the mercenary category.
  inputs.authorityFill=i.autoAuthority
    ?Number(resolvedFills.mercenary??1)
    :Math.max(0,Math.min(1,parseNumber(i.authorityFill)/100));

  const standard=calculateCategory({
    category:'mercenary',
    units:units.mercenary,
    selectedIds:selected,
    inputs
  });
  return Object.fromEntries(
    (standard.results||[])
      .filter(row=>Number(row.qty)>0)
      .map(row=>[row.name,Number(row.qty)])
  );
}

function effectiveEpicCapacityLimits(){
  const i=modeState().inputs;
  const limit=(key,fillKey,autoKey)=>{
    const max=parseNumber(i[key]);
    const fill=i[autoKey]?1:Math.max(0,Math.min(1,parseNumber(i[fillKey])/100));
    return Math.floor(max*fill);
  };
  return{
    LEADERSHIP:limit('leadership','leadershipFill','autoLeadership'),
    AUTHORITY:i.includeMercenariesInOptimization?limit('authority','authorityFill','autoAuthority'):0,
    DOMINANCE:limit('dominance','dominanceFill','autoDominance')
  };
}
function isReviewSelectionAvailable(){return REVIEW_SELECTION_UI_ENABLED&&activeMode==='battle'&&state.modes.battle.activeBattleType==='epic';}
function currentReviewInputSignature(){return JSON.stringify({encounter:state.modes.battle.activeEncounterId,method:state.modes.battle.activeBattleMethod,selectedIds:cloneIds(modeState().selectedIds),inputs:modeState().inputs});}
function setReviewSelectionState(){
  if(!els.reviewSelection)return;
  const available=isReviewSelectionAvailable();
  els.reviewSelection.hidden=!available;
  els.reviewSelection.disabled=!available||!appInitialized||!!reviewWorker||!!epicWorker;
}
function reviewHeadline(phase){
  if(phase==='tier-screen')return'Comparing broad tier structures…';
  if(phase==='unit-neighborhood')return'Checking nearby unit combinations…';
  if(phase==='short-refinement')return'Refining the strongest selections…';
  if(phase==='strong-refinement')return'Confirming the best practical selections…';
  if(phase==='complete')return'Preparing the recommendation…';
  return'Preparing the selection review…';
}
function updateReviewElapsed(){if(reviewStartedAt&&els.reviewElapsed)els.reviewElapsed.textContent=formatElapsed(performance.now()-reviewStartedAt);}
function openReviewProgress(){
  if(!els.reviewProgressModal)return;
  els.reviewProgressModal.hidden=false;document.body.classList.add('review-progress-open');reviewStartedAt=performance.now();
  if(reviewElapsedTimer)clearInterval(reviewElapsedTimer);reviewElapsedTimer=setInterval(updateReviewElapsed,250);updateReviewElapsed();
  updateReviewProgress({phase:'loading',progressPct:0});
}
function closeReviewProgress(){
  if(reviewElapsedTimer){clearInterval(reviewElapsedTimer);reviewElapsedTimer=null;}reviewStartedAt=0;
  if(els.reviewProgressModal)els.reviewProgressModal.hidden=true;document.body.classList.remove('review-progress-open');
}
function updateReviewProgress(progress={}){
  const pct=Math.max(0,Math.min(100,Math.round(Number(progress.progressPct||0))));
  if(els.reviewProgressBar)els.reviewProgressBar.style.width=`${pct}%`;
  if(els.reviewProgressTrack){els.reviewProgressTrack.setAttribute('aria-valuenow',String(pct));}
  if(els.reviewProgressPercent)els.reviewProgressPercent.textContent=`${pct}%`;
  if(els.reviewProgressDetail){const candidate=progress.candidateCount?` Candidate ${progress.candidate} of ${progress.candidateCount}.`:'';els.reviewProgressDetail.textContent=reviewHeadline(progress.phase)+candidate;}
}
function cancelReviewSelection(message='Selection review cancelled.'){
  if(reviewWorker){reviewWorker.terminate();reviewWorker=null;}pendingReviewProposal=null;closeReviewProgress();setReviewSelectionState();
  if(message&&els.resultStatus)els.resultStatus.textContent=message;
}
function reviewUnitNames(ids){const byId=new Map(armyV2.map(unit=>[unit.id,unit.name]));return(ids||[]).map(id=>byId.get(id)||id);}
function renderReviewList(target,ids){if(!target)return;const names=reviewUnitNames(ids);target.innerHTML=names.length?names.map(name=>`<li>${escapeHtml(name)}</li>`).join(''):'<li>None</li>';}
function showReviewProposal(payload){
  pendingReviewProposal=payload;const proposal=payload.proposal,hasChanges=proposal.added.length||proposal.removed.length,worthwhile=proposal.improvementPct>=.05;
  if(els.reviewCurrentEld)els.reviewCurrentEld.textContent=formatDamage(payload.current.eld);
  if(els.reviewProposedEld)els.reviewProposedEld.textContent=formatDamage(proposal.eld);
  if(els.reviewImprovement)els.reviewImprovement.textContent=`${proposal.improvementPct.toFixed(3)}%`;
  renderReviewList(els.reviewAddedUnits,proposal.added);renderReviewList(els.reviewRemovedUnits,proposal.removed);
  if(els.reviewProposalSummary)els.reviewProposalSummary.textContent=hasChanges&&worthwhile?'Review Selection found a practical improvement. Accept it to update the shared selection for this workspace.':hasChanges?'No meaningful unit-selection improvement was found. Keep your current selection.':'No better unit selection was found. Your current selection is already the strongest practical choice reviewed.';
  const methodNote=document.getElementById('reviewMethodNote');if(methodNote){const method=state.modes.battle.activeBattleMethod;methodNote.hidden=method==='optimize';methodNote.textContent=`These ELD values use optimized quantities to compare unit selections. They may be higher than the ${method==='custom'?'Custom Order':'Standard'} result currently shown on the page.`;}
  if(els.acceptReviewSelection)els.acceptReviewSelection.hidden=!(hasChanges&&worthwhile);
  els.reviewProposalDialog?.showModal();
}
function acceptReviewSelection(){
  const proposal=pendingReviewProposal?.proposal;if(!proposal)return;
  const proposed=new Set(proposal.selectedIds),mercenary=[...(modeState().selectedIds.mercenary||[])];
  modeState().selectedIds={troop:units.troop.filter(unit=>proposed.has(unit.id)).map(unit=>unit.id),monster:units.monster.filter(unit=>proposed.has(unit.id)).map(unit=>unit.id),mercenary};
  pendingReviewProposal=null;els.reviewProposalDialog?.close();clearSavedOptimizerResult();epicResultCurrent=false;syncCustomOrders();saveState();renderAllSelections();if(isCustomOrderMode())renderOrderView();recalculate();setReviewSelectionState();
}
function startReviewSelection(){
  if(!isReviewSelectionAvailable()||reviewWorker||epicWorker)return;
  reconcileSelectionsFromRenderedUI();readInputs();syncDerivedEpicBonuses();readInputs();
  const selected=modeState().selectedIds,any=selected.troop.length||selected.monster.length;
  const errors=any?validate():['Select at least one Troop or Monster unit to review.'];showValidation(errors);if(errors.length)return;
  resolveAutoFills(baseEngineInputs());
  const includeMercs=!!modeState().inputs.includeMercenariesInOptimization;
  const fixedQuantities=includeMercs?{}:fixedStandardMercenaryQuantitiesForOptimizer();
  const currentIds=[...selected.troop,...selected.monster,...selected.mercenary];
  const requestId=++reviewRequestId;reviewInputSignature=currentReviewInputSignature();pendingReviewProposal=null;
  try{reviewWorker=createReviewWorker();}catch(error){console.error(error);showValidation(['This browser could not start Review Selection. Refresh the page and try again.']);return;}
  setReviewSelectionState();openReviewProgress();
  reviewWorker.onmessage=event=>{
    const message=event.data??{};if(message.requestId!==requestId)return;
    if(message.type==='progress'){updateReviewProgress(message.payload);return;}
    if(message.type==='error'){console.error(message.message,message.stack);cancelReviewSelection('Selection review could not finish.');showValidation([message.message||'Review Selection could not finish.']);return;}
    if(message.type==='result'){
      reviewWorker.terminate();reviewWorker=null;closeReviewProgress();setReviewSelectionState();
      if(currentReviewInputSignature()!==reviewInputSignature){showValidation(['Inputs or selections changed while the review was running. Run Review Selection again.']);return;}
      showReviewProposal(message.payload);
    }
  };
  reviewWorker.onerror=event=>{console.error(event);cancelReviewSelection('Selection review could not finish.');showValidation(['Review Selection encountered an error.']);};
  reviewWorker.postMessage({type:'review',requestId,payload:{currentIds,bonuses:epicBonusPayload(),capacityLimits:effectiveEpicCapacityLimits(),fixedQuantities,timeBudgetMs:120000}});
}
function cancelEpicOptimization(){
  if(epicWorker){epicWorker.terminate();epicWorker=null;}
  closeOptimizerModal();
}


function currentEpicEffectiveSignature(){
  if(!isAnyEpicOptimizeMode())return'';
  const i=modeState().inputs;
  const includeMercs=!!i.includeMercenariesInOptimization;
  const selected={
    troop:[...(modeState().selectedIds.troop||[])].sort(),
    monster:[...(modeState().selectedIds.monster||[])].sort(),
    mercenary:includeMercs?[...(modeState().selectedIds.mercenary||[])].sort():[]
  };
  const effective={
    selected,
    leadership:parseNumber(i.leadership),
    authority:includeMercs?parseNumber(i.authority):null,
    dominance:parseNumber(i.dominance),
    autoLeadership:!!i.autoLeadership,
    autoAuthority:includeMercs?!!i.autoAuthority:null,
    autoDominance:!!i.autoDominance,
    leadershipFill:parseNumber(i.leadershipFill),
    authorityFill:includeMercs?parseNumber(i.authorityFill):null,
    dominanceFill:parseNumber(i.dominanceFill),
    includeMercenariesInOptimization:includeMercs,
    arachne:activeMode!=='custom'&&!!i.arachne,
    enemySquadTypes:i.enemySquadTypes,
    monsterHealth:parseNumber(i.monsterHealth),
    beastHealth:parseNumber(i.beastHealth),dragonHealth:parseNumber(i.dragonHealth),elementalHealth:parseNumber(i.elementalHealth),giantHealth:parseNumber(i.giantHealth),
    epicHunterHealth:parseNumber(i.epicHunterHealth),
    guardsmanHealth:parseNumber(i.guardsmanHealth),specialistHealth:parseNumber(i.specialistHealth),engineerHealth:parseNumber(i.engineerHealth),
    monsterStrength:parseNumber(i.monsterStrength),
    beastStrength:parseNumber(i.beastStrength),dragonStrength:parseNumber(i.dragonStrength),elementalStrength:parseNumber(i.elementalStrength),giantStrength:parseNumber(i.giantStrength),
    epicHunterStrength:parseNumber(i.epicHunterStrength),
    guardsmanStrength:parseNumber(i.guardsmanStrength),specialistStrength:parseNumber(i.specialistStrength),engineerStrength:parseNumber(i.engineerStrength),
    strengthAgainstEpic:parseNumber(i.strengthAgainstEpic),
    monsterDD:parseNumber(i.monsterDD),
    beastDD:parseNumber(i.beastDD),dragonDD:parseNumber(i.dragonDD),elementalDD:parseNumber(i.elementalDD),giantDD:parseNumber(i.giantDD),
    epicHunterDD:parseNumber(i.epicHunterDD),
    guardsmanDD:parseNumber(i.guardsmanDD),specialistDD:parseNumber(i.specialistDD),engineerDD:parseNumber(i.engineerDD),
    monsterST:parseNumber(i.monsterST),
    beastST:parseNumber(i.beastST),dragonST:parseNumber(i.dragonST),elementalST:parseNumber(i.elementalST),giantST:parseNumber(i.giantST),
    epicHunterST:parseNumber(i.epicHunterST),
    guardsmanST:parseNumber(i.guardsmanST),specialistST:parseNumber(i.specialistST),engineerST:parseNumber(i.engineerST)
  };
  return JSON.stringify(effective);
}
function setOptimizeButtonState(){
  if(!els.optimizeArmy||!isAnyEpicOptimizeMode())return;
  if(!appInitialized){
    els.optimizeArmy.disabled=true;
    els.optimizeArmy.textContent='Optimize Army';
    els.optimizeHelp.textContent='Loading calculator data…';
    return;
  }

  // Keep the primary action available once initialization is complete.
  // Mobile browsers can restore checkbox appearance after JavaScript startup;
  // startEpicOptimization() performs a final DOM-to-state reconciliation
  // before validation, so button availability must not depend on that race.
  const any=Object.values(modeState().selectedIds).some(a=>a.length);
  const errors=any?validate():[];
  els.optimizeArmy.disabled=!!epicWorker;
  els.optimizeArmy.textContent=epicResultCurrent?'Re-optimize Army':'Optimize Army';

  if(epicWorker)els.optimizeHelp.textContent='Optimization is running.';
  else if(!any)els.optimizeHelp.textContent='Select units, then click Optimize Army.';
  else if(errors.length)els.optimizeHelp.textContent='Click Optimize Army to review any required inputs.';
  else if(epicResultCurrent)els.optimizeHelp.textContent='Change any input or selection, then re-optimize when ready.';
  else els.optimizeHelp.textContent='Ready. Click Optimize Army to calculate the best quantities.';
}
function openOptimizerModal(){
  optimizerBestEldSoFar=0;
  renderOptimizerHealthLadder([]);
  if(els.optimizerProgressCurrentEld)els.optimizerProgressCurrentEld.textContent='—';
  if(els.optimizerProgressBestEld)els.optimizerProgressBestEld.textContent='—';
  if(!els.optimizerModal)return;
  els.optimizerModal.hidden=false;
  document.body.classList.add('optimizer-modal-open');
  updateOptimizerProgress({phase:'loading',progressPct:0,evaluations:0});
}
function chartStyle(){return state.preferences.chartStyle==='separated'?'separated':'combined';}
let lastOptimizerHealthLadderRows=[];let lastLayerChartResult=null;
function setChartStyle(style,{persist=true}={}){
  state.preferences.chartStyle=style==='separated'?'separated':'combined';
  document.querySelectorAll('[data-chart-style]').forEach(button=>{const active=button.dataset.chartStyle===state.preferences.chartStyle;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  const description=document.getElementById('layerChartDescription');if(description)description.textContent=state.preferences.chartStyle==='separated'?'Squad health within each army type. Select a point to view unit details.':'Squad health by predicted death order. Select a point to view unit details.';
  renderOptimizerHealthLadder(lastOptimizerHealthLadderRows);
  if(lastLayerChartResult)renderLayerHealthChart(lastLayerChartResult);
  if(persist)saveState();
}
function renderOptimizerHealthLadder(rows=[]){
  lastOptimizerHealthLadderRows=Array.isArray(rows)?rows:[];
  const svg=document.getElementById('optimizerHealthLadder');
  if(!svg)return;
  svg.replaceChildren();
  const data=(Array.isArray(rows)?rows:[]).filter(row=>Number(row?.effectiveHealth)>0);
  const ns='http://www.w3.org/2000/svg',make=(tag,attrs={})=>{const node=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));return node;};
  const yLabel=make('text',{x:9,y:150,transform:'rotate(-90 9 150)','text-anchor':'middle',fill:'#718594','font-size':8,'font-weight':800,'letter-spacing':'.08em'});yLabel.textContent='SQUAD HEALTH';svg.append(yLabel);
  const xLabel=make('text',{x:300,y:305,'text-anchor':'middle',fill:'#718594','font-size':8,'font-weight':800,'letter-spacing':'.08em'});xLabel.textContent=chartStyle()==='separated'?'POSITION WITHIN ARMY TYPE →':'DEATH ORDER →';svg.append(xLabel);
  if(!data.length){const label=make('text',{x:300,y:148,'text-anchor':'middle',fill:'#718594','font-size':11});label.textContent='Waiting for the first best army…';svg.append(label);return;}
  const ordered=data.slice().sort((a,b)=>Number(a.deathPosition)-Number(b.deathPosition));
  const health=ordered.map(row=>Number(row.effectiveHealth)),high=Math.max(...health),low=Math.min(...health),range=Math.max(1,high-low),count=Math.max(2,ordered.length);
  for(const y of [20,145,270])svg.append(make('line',{x1:28,y1:y,x2:572,y2:y,stroke:'#203543','stroke-width':1}));
  const colors={troop:'#dce6ec',monster:'#64a5ff',mercenary:'#e86b59'},mercTierRoman=['','I','II','III','IV','V','VI','VII','VIII','IX'];
  for(const category of ['troop','monster','mercenary']){
    const categoryRows=ordered.filter(row=>row.category===category);
    const points=categoryRows.map((row,index)=>({row,x:32+(chartStyle()==='separated'?index/Math.max(1,categoryRows.length-1):(Number(row.deathPosition)-1)/(count-1))*532,y:18+(high-Number(row.effectiveHealth))/range*248}));
    if(!points.length)continue;
    if(points.length>1)svg.append(make('polyline',{points:points.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),fill:'none',stroke:colors[category],'stroke-width':2,'stroke-linejoin':'round','stroke-linecap':'round'}));
    for(const point of points){
      const pointColor=outputRowColors(category,{id:point.row.id,level:point.row.tier}).accent;
      svg.append(make('circle',{cx:point.x,cy:point.y,r:3.2,fill:pointColor,stroke:'#07131c','stroke-width':1.3}));
      const label=make('text',{x:point.x,y:Math.max(11,point.y-7),'text-anchor':'middle',fill:pointColor,'font-size':8.5,'font-weight':900});
      if(category==='mercenary'){
        const roman=mercTierRoman[tierNumber(point.row.tier)]||String(point.row.tier||''),suffix=String(point.row.tier||'').split('-')[1];
        label.textContent=chartStyle()==='separated'&&suffix?`${roman}-${suffix}`:roman;
      }else label.textContent=String(point.row.tier||'');
      svg.append(label);
    }
  }
}
function closeOptimizerModal(){
  if(!els.optimizerModal)return;
  els.optimizerModal.hidden=true;
  document.body.classList.remove('optimizer-modal-open');
}
function optimizationHeadline(progress){
  if(progress.phase==='loading')return 'Loading the validated army database…';
  if(progress.phase==='seed'||progress.phase==='seed-screen')return 'Comparing independent starting army structures…';
  if(progress.phase==='local')return 'Optimizing the strongest independent structures…';
  if(progress.phase==='evolution')return 'Exploring new death and attack-order structures…';
  if(progress.phase==='threshold')return 'Testing attack-opportunity thresholds…';
  if(progress.phase==='counterfactual')return 'Challenging the current structure in alternate battle basins…';
  if(progress.phase==='group-redistribution')return 'Redistributing capacity across related squad groups…';
  if(progress.phase==='death-position')return 'Testing widely different death-order structures…';
  if(progress.phase==='polish')return 'Precision-polishing the best discovered army…';
  if(progress.phase==='finalizing')return 'Finalizing the highest-damage army…';
  const i=Number(progress.stageIndex||0),n=Math.max(1,Number(progress.stageCount||1));
  if(i<2)return 'Testing broad quantity reallocations…';
  if(i<5)return 'Refining squad quantities and death order…';
  if(i<n-1)return 'Fine-tuning the highest-value quantity changes…';
  return 'Running the final precision pass…';
}
function updateOptimizerProgress(progress={}){
  const pct=Math.max(0,Math.min(100,Math.round(Number(progress.progressPct||0))));
  if(els.optimizerProgressBar)els.optimizerProgressBar.style.width=`${pct}%`;
  if(els.optimizerProgressTrack)els.optimizerProgressTrack.setAttribute('aria-valuenow',String(pct));
  if(els.optimizerProgressPercent)els.optimizerProgressPercent.textContent=`${pct}%`;
  if(els.optimizerProgressHeadline)els.optimizerProgressHeadline.textContent=optimizationHeadline(progress);
  if(els.optimizerProgressEvaluations){
    const e=Number(progress.evaluations||0);
    els.optimizerProgressEvaluations.textContent=e?`${e.toLocaleString('en-US')} candidates evaluated`:'';
  }
  const currentEld=Number(progress.expectedLifetimeDamage),previousBest=optimizerBestEldSoFar;
  const reportedBest=Number(progress.bestExpectedLifetimeDamage);
  if(Number.isFinite(reportedBest)&&reportedBest>0)optimizerBestEldSoFar=Math.max(optimizerBestEldSoFar,reportedBest);
  if(Number.isFinite(currentEld)&&currentEld>0){
    optimizerBestEldSoFar=Math.max(optimizerBestEldSoFar,currentEld);
    if(currentEld>previousBest&&Array.isArray(progress.healthLadder))renderOptimizerHealthLadder(progress.healthLadder);
    if(els.optimizerProgressCurrentEld)els.optimizerProgressCurrentEld.textContent=formatDamage(currentEld);
    if(els.optimizerProgressBestEld)els.optimizerProgressBestEld.textContent=formatDamage(optimizerBestEldSoFar);
  }
}
function clearPrediction(){
  if(els.epicPredictionPanel)els.epicPredictionPanel.hidden=true;
  encounterPlanContext=null;
  if(els.encounterPlanEntry)els.encounterPlanEntry.hidden=true;
  if(els.predictionRows)els.predictionRows.innerHTML='';
  const note=document.getElementById('openingSacrificeNote');
  if(note){note.hidden=true;note.open=false;}
  updateVisibleStepNumbers();
}
// Keep the unusual-sacrifice diagnostics and explanation UI available for a
// future opt-in experience, but do not surface flags in Battle Details today.
const SHOW_BATTLE_DETAIL_SACRIFICE_FLAGS=false;
function encounterPlanStorageKey(){return`tbtoolkit.encounterPlan.v1.${state.activeAccountId}.${state.modes.battle.activeEncounterId}`;}
function saveEncounterResultSnapshot({encounter,method,estimatedPoints,fullGold,eld,ratio}){
  if(!encounter?.builtIn||!(estimatedPoints>0)||!(fullGold>0)||!(ratio>0))return;
  try{
    const stored=readSavedJson(localStorage,ENCOUNTER_RESULT_STORE_KEY)||{};
    stored.schemaVersion=1;stored.activeAccountId=state.activeAccountId;stored.accounts=stored.accounts||{};
    const account=stored.accounts[state.activeAccountId]||{name:currentAccount()?.name||'Player',encounters:{}};
    account.name=currentAccount()?.name||account.name;account.encounters=account.encounters||{};
    const result=account.encounters[encounter.id]||{name:encounter.name,methods:{}};
    result.name=encounter.name;result.methods=result.methods||{};
    result.methods[method]={estimatedEpicPoints:estimatedPoints,fullGoldRevival:fullGold,expectedLifetimeDamage:eld,pointsPerFullGoldRevival:ratio,savedAt:Date.now()};
    account.encounters[encounter.id]=result;stored.accounts[state.activeAccountId]=account;
    writeSavedJson(localStorage,ENCOUNTER_RESULT_STORE_KEY,stored);
  }catch(error){console.warn('Could not save the encounter result bridge.',error);}
}
function saveEncounterPlanSnapshot(settings,outcomes){
  if(!currentEncounter()?.builtIn)return;
  try{
    const stored=readSavedJson(localStorage,ENCOUNTER_RESULT_STORE_KEY)||{},accountId=state.activeAccountId,encounter=currentEncounter();
    stored.schemaVersion=1;stored.activeAccountId=accountId;stored.accounts=stored.accounts||{};
    const account=stored.accounts[accountId]||{name:currentAccount()?.name||'Player',encounters:{}};account.encounters=account.encounters||{};
    const result=account.encounters[encounter.id]||{name:encounter.name,methods:{}};result.name=encounter.name;
    result.plan={profileId:settings.source==='clan'?settings.profileId||'':'',profileName:settings.source==='clan'?linkedClanProfile(localStorage,settings.profileId)?.name||'':'',norm:settings.norm,unit:settings.unit,basis:settings.basis,clanMembers:settings.clanMembers,selectedStrategy:settings.strategy,outcomes,savedAt:Date.now()};
    account.encounters[encounter.id]=result;stored.accounts[accountId]=account;writeSavedJson(localStorage,ENCOUNTER_RESULT_STORE_KEY,stored);
  }catch(error){console.warn('Could not save the encounter plan bridge.',error);}
}
function compactNormPoints(points){
  for(const [unit,multiplier] of [['B',1e9],['M',1e6],['K',1e3]])if(points>=multiplier&&Math.abs(points/multiplier-Math.round(points/multiplier))<1e-6)return {norm:points/multiplier,unit};
  if(points>=1e9)return {norm:Number((points/1e9).toFixed(3)),unit:'B'};
  if(points>=1e6)return {norm:Number((points/1e6).toFixed(3)),unit:'M'};
  return {norm:Number((points/1e3).toFixed(3)),unit:'K'};
}
function activeClanEncounterNorm(encounterName){
  return clanEncounterNorm(linkedClanProfile(localStorage,currentAccount()?.clanProfileId),encounterName);
}
function renderEncounterNormSource(clanNorm){
  const profile=linkedClanProfile(localStorage,currentAccount()?.clanProfileId),source=els.encounterPlanNorm?.dataset.source;
  const actions=document.getElementById('encounterNormActions'),use=document.getElementById('useClanNorm'),save=document.getElementById('saveNormToClan');
  if(els.encounterNormSource)els.encounterNormSource.textContent=profile
    ?source==='clan'&&clanNorm?`From ${profile.name} · edit clan requirements in Clan Overview.`:clanNorm?`Manual override · ${profile.name} is unchanged.`:`Manual norm · no norm for this encounter in ${profile.name}.`
    :currentAccount()?.clanProfileId?'Linked clan profile unavailable · this norm is local.':'Manual norm · no clan profile linked.';
  if(actions){actions.hidden=!profile;use.hidden=!clanNorm||source==='clan';save.hidden=!profile||source==='clan';}
}
function loadEncounterNormSettings(){
  let saved=null;
  try{saved=readSavedJson(localStorage,encounterPlanStorageKey());}catch{}
  const portable=currentBattleWorkspace()?.inputs||{};
  if(portable.encounterNorm!==undefined&&Number.isFinite(Number(portable.encounterNorm)))saved={...(saved||{}),norm:Number(portable.encounterNorm),unit:['B','M','K'].includes(portable.encounterNormUnit)?portable.encounterNormUnit:'B',basis:portable.encounterNormBasis==='chests'?'chests':'points',clanMembers:Math.min(100,Math.max(1,Math.floor(Number(portable.clanMembers)||100))),strategy:portable.encounterPlanStrategy,source:portable.encounterNormSource==='clan'?'clan':'manual',profileId:portable.encounterNormSource==='clan'?currentAccount()?.clanProfileId||'':''};
  const clanNorm=activeClanEncounterNorm(currentEncounter()?.name),legacyManual=!!saved&&!saved.source&&(Number(saved.norm)!==1||saved.unit!=='B'),manual=saved?.source==='manual'||legacyManual;
  const selected=manual?saved:clanNorm?{...saved,...clanNorm,source:'clan'}:saved?.source==='clan'?{...saved,source:'manual',profileId:''}:{norm:1,unit:'B',source:'default'};
  const supported=activeMode==='battle'&&currentEncounter()?.builtIn&&String(currentEncounter()?.name||'').toUpperCase()!=='TINMAN'&&!!EPIC_NORM_POINTS_PER_CHEST[String(currentEncounter()?.name||'').toUpperCase()];
  if(els.encounterNormField)els.encounterNormField.hidden=!supported;
  if(!supported)return {saved,clanNorm,selected};
  els.encounterPlanNorm.value=String(selected.norm??1);
  els.encounterPlanUnit.value=['B','M','K'].includes(selected.unit)?selected.unit:'B';
  const linked=linkedClanProfile(localStorage,currentAccount()?.clanProfileId),memberCount=linked?.plan?.recipients??selected.clanMembers??saved?.clanMembers??100;
  document.getElementById('encounterPlanMembers').value=String(Math.min(100,Math.max(1,Math.floor(Number(memberCount)||100))));
  const basis=document.getElementById('encounterPlanBasis');basis.checked=selected.basis!=='chests';
  syncEncounterNormSuffix();
  els.encounterPlanNorm.dataset.source=selected.source||'manual';
  els.encounterPlanNorm.dataset.profileId=selected.profileId||'';
  renderEncounterNormSource(clanNorm);
  return {saved,clanNorm,selected};
}
function loadEncounterPlanSettings(){
  const {saved,clanNorm}=loadEncounterNormSettings();
  encounterPlanContext.clanProfile=clanNorm;
  const strategy=['full','mercenary-monster','mercenary-only'].includes(saved?.strategy)?saved.strategy:(saved?.strategy==='none'?'mercenary-only':'full');
  const radio=els.encounterPlanStrategies?.querySelector(`input[value="${strategy}"]`);
  if(radio)radio.checked=true;
}
function syncEncounterNormSuffix(){const suffix=document.getElementById('encounterPlanUnitSuffix'),basis=document.getElementById('encounterPlanBasis'),mode=document.getElementById('encounterPlanBasisMode'),inputGroup=els.encounterPlanNorm?.closest('.battle-norm-input');if(!suffix||!basis||!mode||!inputGroup||!els.encounterPlanUnit)return;const chests=!basis.checked;suffix.textContent=els.encounterPlanUnit.value;els.encounterPlanNorm.parentElement.style.setProperty('--norm-chars',String(Math.max(1,String(els.encounterPlanNorm.value||'').length)));mode.textContent=chests?'Chests':'Points';inputGroup.classList.toggle('is-chests',chests);els.encounterPlanUnit.disabled=chests;els.encounterPlanNorm.step=chests?'1':'any';}
function normalizeEncounterNorm(){
  if(!document.getElementById('encounterPlanBasis').checked){els.encounterPlanNorm.value=String(Math.max(0,Math.floor(Number(els.encounterPlanNorm.value)||0)));syncEncounterNormSuffix();return;}
  let value=Math.max(0,Number(els.encounterPlanNorm.value)||0),unit=els.encounterPlanUnit.value;
  if(value>0&&value<1&&unit==='B'){value*=1000;unit='M';}
  else if(value>0&&value<1&&unit==='M'){value*=1000;unit='K';}
  else if(value>=1000&&unit==='K'){value/=1000;unit='M';}
  else if(value>=1000&&unit==='M'){value/=1000;unit='B';}
  els.encounterPlanNorm.value=String(Number(value.toFixed(6)));els.encounterPlanUnit.value=unit;syncEncounterNormSuffix();
}
function saveManualEncounterNorm(){
  let saved={};try{saved=readSavedJson(localStorage,encounterPlanStorageKey())||{};}catch{}
  const settings={...saved,norm:Math.max(0,Number(els.encounterPlanNorm.value)||0),unit:els.encounterPlanUnit.value,basis:document.getElementById('encounterPlanBasis').checked?'points':'chests',clanMembers:Math.min(100,Math.max(1,Math.floor(Number(document.getElementById('encounterPlanMembers').value)||100))),source:'manual',profileId:''};
  syncEncounterNormSuffix();
  els.encounterPlanNorm.dataset.source='manual';els.encounterPlanNorm.dataset.profileId='';
  const inputs=currentBattleWorkspace().inputs;inputs.clanMembers=settings.clanMembers;inputs.encounterNorm=settings.norm;inputs.encounterNormUnit=settings.unit;inputs.encounterNormBasis=settings.basis;inputs.encounterNormSource='manual';inputs.encounterPlanStrategy=settings.strategy||inputs.encounterPlanStrategy||'full';
  renderEncounterNormSource(activeClanEncounterNorm(currentEncounter()?.name));
  try{writeSavedJson(localStorage,encounterPlanStorageKey(),settings);}catch{}
  saveState();
}
function useLinkedClanNorm(){
  const norm=activeClanEncounterNorm(currentEncounter()?.name);
  if(!norm)return;
  const inputs=currentBattleWorkspace().inputs;
  inputs.encounterNormSource='clan';
  let saved={};try{saved=readSavedJson(localStorage,encounterPlanStorageKey())||{};}catch{}
  try{writeSavedJson(localStorage,encounterPlanStorageKey(),{...saved,source:'clan',profileId:norm.profileId});}catch{}
  loadEncounterNormSettings();
  if(encounterPlanContext)updateEncounterPlan();
  saveState();
}
function saveCurrentNormToClan(){
  const profileId=currentAccount()?.clanProfileId,encounter=currentEncounter();
  if(!profileId||!encounter?.builtIn)return;
  try{
    saveClanEncounterNorm(localStorage,profileId,encounter.name,{
      norm:Number(els.encounterPlanNorm.value),
      unit:els.encounterPlanUnit.value,
      basis:document.getElementById('encounterPlanBasis').checked?'points':'chests'
    });
    useLinkedClanNorm();
  }catch(error){alert(error.message||'The clan norm could not be saved.');}
}
function updateEncounterPlan(){
  if(!encounterPlanContext)return;
  const multiplier={B:1e9,M:1e6,K:1e3}[els.encounterPlanUnit.value]||1;
  const selected=els.encounterPlanStrategies?.querySelector('input:checked')?.value||'full';
  const settings={norm:Math.max(0,Number(els.encounterPlanNorm.value)||0),unit:els.encounterPlanUnit.value,basis:document.getElementById('encounterPlanBasis').checked?'points':'chests',clanMembers:Math.min(100,Math.max(1,Math.floor(Number(document.getElementById('encounterPlanMembers').value)||100))),strategy:selected,source:els.encounterPlanNorm.dataset.source||'manual',profileId:els.encounterPlanNorm.dataset.profileId||''};
  const portable=currentBattleWorkspace().inputs;portable.clanMembers=settings.clanMembers;portable.encounterNorm=settings.norm;portable.encounterNormUnit=settings.unit;portable.encounterNormBasis=settings.basis;portable.encounterNormSource=settings.source;portable.encounterPlanStrategy=settings.strategy;
  renderEncounterNormSource(activeClanEncounterNorm(currentEncounter()?.name));
  const monster=String(currentEncounter()?.name||'').toUpperCase(),pointsPerChest=EPIC_NORM_POINTS_PER_CHEST[monster]||0,normPoints=settings.basis==='chests'?settings.norm*pointsPerChest:settings.norm*multiplier,reward=epicChestRewards.get(monster),members=settings.clanMembers,chestsPerMember=pointsPerChest?Math.floor(normPoints/pointsPerChest):0,received=reward&&members&&chestsPerMember?{gold:chestsPerMember*members*(Number(reward.gold)||0),potion:chestsPerMember*members*(Number(reward.potion)||0),silver:chestsPerMember*members*(Number(reward.silver)||0),dragon:chestsPerMember*members*(Number(reward.dragonCoins)||0)}:null;
  if(received)received.revival=received.gold+received.potion;
  const renderOutcome=(cell,spent,income)=>{if(!received){cell.className='spend-only';cell.textContent=spent?`${formatDamage(spent)} spent`:'—';return;}const net=income-spent;cell.className=net>=0?'net-positive':'net-negative';cell.innerHTML=`<strong>${net>=0?'+':'−'}${formatDamage(Math.abs(net))}</strong><small>${formatDamage(spent)} spent · ${formatDamage(income)} received</small>`;};
  let sharedHits=0;const outcomes={};
  for(const row of els.encounterPlanStrategies?.querySelectorAll('tr[data-strategy]')??[]){
    const strategy=row.dataset.strategy;
    const plan=calculateEncounterPlan({normPoints,pointsPerAttack:encounterPlanContext.pointsPerAttack,goldByCategory:encounterPlanContext.goldByCategory,rebuildRows:encounterPlanContext.rebuildRows,strategy});
    outcomes[strategy]={hits:plan.hits,gold:{spent:plan.totalGold,received:received?.revival||0,goldReceived:received?.gold||0,potionReceived:received?.potion||0,net:(received?.revival||0)-plan.totalGold},silver:{spent:plan.totalSilver,received:received?.silver||0,net:(received?.silver||0)-plan.totalSilver},dragonCoins:{spent:plan.totalDragonCoins,received:received?.dragon||0,net:(received?.dragon||0)-plan.totalDragonCoins},complete:!!received&&plan.rebuildCostsComplete};
    sharedHits=plan.hits;
    row.classList.toggle('is-selected',strategy===selected);
    row.querySelector('input').checked=strategy===selected;
    renderOutcome(row.querySelector('[data-cost="gold"]'),plan.hits?plan.totalGold:0,received?.revival||0);
    renderOutcome(row.querySelector('[data-cost="silver"]'),plan.hits&&plan.rebuildCostsComplete?plan.totalSilver:0,received?.silver||0);
    renderOutcome(row.querySelector('[data-cost="dragon"]'),plan.hits&&plan.rebuildCostsComplete?plan.totalDragonCoins:0,received?.dragon||0);
  }
  els.encounterPlanHits.textContent=sharedHits?sharedHits.toLocaleString('en-US'):'—';
  els.encounterPlanNote.textContent=received?`Estimated rewards use ${members.toLocaleString('en-US')} clan members meeting the norm (${chestsPerMember.toLocaleString('en-US')} chests each). Gold and Potion rewards are combined 1:1 as revival currency. ${REBUILD_COST_ASSUMPTION}`:`Enter a clan norm to include resource rewards and net change. ${REBUILD_COST_ASSUMPTION}`;
  saveEncounterPlanSnapshot(settings,outcomes);
  try{writeSavedJson(localStorage,encounterPlanStorageKey(),settings);}catch{}
  saveState();
}
function renderPrediction(opt){
  if(!opt?.result){clearPrediction();return;}const r=opt.result;els.epicPredictionPanel.hidden=false;els.expectedLifetimeDamage.textContent=formatDamage(r.expectedTotalLifetimeDamage);const revivalRaw=(r.squads??[]).reduce((sum,s)=>sum+rawSquadRevival({id:s.id,quantity:s.quantity},'gold'),0);const actualGold=actualRevivalCost(revivalRaw);els.rawGoldRevival.textContent=Math.round(actualGold).toLocaleString('en-US');const encounter=currentEncounter();const pointsEstimate=encounter?.builtIn?estimatedEpicPoints(encounter.name,r.expectedTotalLifetimeDamage):null;els.estimatedEpicPoints.textContent=pointsEstimate===null?'—':formatDamage(pointsEstimate);const pointsPerFullGold=pointsEstimate!==null&&actualGold>0?pointsEstimate/actualGold:null;els.epicPointsPerFullGold.textContent=pointsPerFullGold===null?'—':pointsPerFullGold.toFixed(pointsPerFullGold>=100?0:2);if(pointsPerFullGold!==null)saveEncounterResultSnapshot({encounter,method:state.modes.battle.activeBattleMethod,estimatedPoints:pointsEstimate,fullGold:actualGold,eld:r.expectedTotalLifetimeDamage,ratio:pointsPerFullGold});const goldByCategory={mercenary:0,monster:0,troop:0},rebuildRows=[];for(const squad of r.squads??[]){if(Object.hasOwn(goldByCategory,squad.category))goldByCategory[squad.category]+=actualRevivalCost(rawSquadRevival({id:squad.id,quantity:squad.quantity},'gold'));const cost=unitRebuildCost(squad.id);rebuildRows.push({category:squad.category,quantity:squad.quantity,revivableQuantity:attackingRevivableQuantity(squad),silverEach:cost?.silverEach,dragonCoinsEach:cost?.dragonCoinsEach});}encounterPlanContext=pointsEstimate===null?null:{pointsPerAttack:pointsEstimate,goldByCategory,rebuildRows};els.encounterPlanEntry.hidden=!encounterPlanContext;if(encounterPlanContext){els.encounterPlanTitle.textContent=`${encounter.name} strategy`;loadEncounterPlanSettings();updateEncounterPlan();}updateVisibleStepNumbers();const minSep=r.separationSummary?.minPct;const templeText=` · 90% attacking losses revivable · Temple ${templeLevel()} (${templeRevivalDivisor().toFixed(2)}× revival divisor)`;
  const optimizerContext=isAnyEpicOptimizeMode();
  const isArachneBattle=activeMode==='battle'
    ? !!modeState().inputs.arachne
    : !!modeState().inputs.arachne;
  if(optimizerContext){const improvement=opt.diagnostics?.improvementPct,run=lastEpicRunDiagnostics,elapsedMs=Number(opt.diagnostics?.optimizationElapsedMs??run?.optimizationElapsedMs),timeText=Number.isFinite(elapsedMs)&&elapsedMs>=0?` · Optimization time: ${formatElapsed(elapsedMs)}`:'',buildText=run?` · Optimizer ${run.optimizerBuild} · Engine ${run.engineBuild} · ${run.armyDatabase}`:'',mercText=modeState().inputs.includeMercenariesInOptimization?' · Mercenaries included':' · Mercenaries excluded from optimization',epicTypeText=isArachneBattle?' · Arachne: 8 enemy squads':' · Standard Epic: 4 enemy squads',evalCount=opt.diagnostics?.totalEvaluations??opt.diagnostics?.evaluations;els.predictionMeta.textContent=`Opening initiative: 50/50 · Epic starts every later cycle · ${Number.isFinite(improvement)?`Optimizer gain vs best starting population: ${improvement.toFixed(2)}% · `:''}${Number.isFinite(minSep)?`Closest health spacing: ${minSep.toFixed(4)}% · `:''}${evalCount?.toLocaleString('en-US')??'—'} candidates evaluated · Multi-seed global search · Dynamic death & attack order${epicTypeText}${mercText}${timeText}${templeText}${buildText}`;}
  else{const label=activeMode==='epic'?'Epic Stacker':'Custom Stacker',epicTypeText=activeMode==='epic'&&modeState().inputs.arachne?' · Arachne: 8 enemy squads':' · Standard Epic: 4 enemy squads';els.predictionMeta.textContent=`${label} · Opening initiative: 50/50 · Epic starts every later cycle${Number.isFinite(minSep)?` · Closest health spacing: ${minSep.toFixed(4)}%`:''}${epicTypeText}${templeText} · Full battle simulation using the displayed quantities.`;}
  const diagnosticNotes=new Map((opt.diagnostics?.unusualSacrifices??[]).map(n=>[String(n.id),n]));
  const rows=[...(r.squads??[])].sort((a,b)=>(a.predictedDeathPosition??999)-(b.predictedDeathPosition??999)||a.displayOrder-b.displayOrder);

  // Detection and counterfactual attribution are intentionally separate.
  // A productive squad can be visibly unusual even when the small final
  // counterfactual pass cannot find a feasible later-position comparison.
  const productive=rows.filter(s=>Number(s.expectedLifetimeDamage||0)>0&&Number(s.averageAttackOpportunities||0)>0);
  const damageValues=productive.map(s=>Number(s.expectedDamagePerOpportunity||0)).filter(Number.isFinite).sort((a,b)=>a-b);
  const upperQuartile=damageValues.length?damageValues[Math.floor((damageValues.length-1)*.75)]:0;
  const enemySquadCount=isArachneBattle?8:4;
  const selectedTierMax=new Map();
  for(const s of rows){const tierNum=Number((String(s.tier||'').match(/\d+/)||[0])[0]);selectedTierMax.set(s.capacityType,Math.max(selectedTierMax.get(s.capacityType)||0,tierNum));}
  const familyMedian=new Map();
  for(const type of ['LEADERSHIP','DOMINANCE','AUTHORITY']){const a=productive.filter(s=>s.capacityType===type).map(s=>Number(s.expectedDamagePerOpportunity||0)).filter(Number.isFinite).sort((x,y)=>x-y);familyMedian.set(type,a.length?a[Math.floor(a.length/2)]:0);}
  const unusualMap=new Map();
  if(optimizerContext){
    // Counterfactual notes describe decisions made by the optimizer itself.
    // When Standard mercenaries are added after ADS, their presence can shift
    // the displayed global death positions. Keep the optimizer flags attached
    // to the affected Troop/Monster squads even after that final merge.
    if(['standard-postprocess','standard-live'].includes(opt.diagnostics?.mercenaryOptimizationMode)){
      for(const s of rows){
        if(s.category==='mercenary')continue;
        const diagnostic=diagnosticNotes.get(String(s.id));
        if(diagnostic)unusualMap.set(String(s.id),diagnostic);
      }
    }
    for(const s of rows){
      const death=Number(s.predictedDeathPosition??999);
      const productiveEarly=death<=enemySquadCount&&Number(s.expectedLifetimeDamage||0)>0&&Number(s.averageAttackOpportunities||0)>0;
      const normalSacrifice=String(s.combatType||'').toUpperCase()==='SIEGE';
      const damage=Number(s.expectedDamagePerOpportunity||0),tierNum=Number((String(s.tier||'').match(/\d+/)||[0])[0]);
      const topTier=tierNum>0&&tierNum>=Number(selectedTierMax.get(s.capacityType)||0);
      const meaningfulDamage=(topTier&&damage>=Number(familyMedian.get(s.capacityType)||0))||damage>=upperQuartile;

      // Arachne has eight enemy attacks in the first cycle, so a top-tier
      // squad can be strategically unusual even when its raw damage falls
      // just below the global damage threshold. Flag it when lower-tier
      // squads using the same army capacity survive beyond the first cycle.
      const lowerTierSurvivesLater=isArachneBattle&&topTier&&rows.some(other=>{
        if(other===s||other.capacityType!==s.capacityType)return false;
        const otherTier=Number((String(other.tier||'').match(/\d+/)||[0])[0]);
        const otherDeath=Number(other.predictedDeathPosition??999);
        return otherTier>0&&otherTier<tierNum&&otherDeath>enemySquadCount;
      });
      const unusualByArachneStructure=isArachneBattle&&topTier&&lowerTierSurvivesLater;

      if(!productiveEarly||(!meaningfulDamage&&!unusualByArachneStructure)||normalSacrifice)continue;
      const diagnostic=diagnosticNotes.get(String(s.id));
      unusualMap.set(String(s.id),diagnostic??{
        id:String(s.id),name:s.name,tier:s.tier,originalDeath:death,
        penaltyPct:null,classification:unusualByArachneStructure?'arachne-structure':'unknown',
        reason:unusualByArachneStructure?'top-tier-first-cycle':''
      });
    }
  }

  els.predictionRows.innerHTML=rows.map(s=>{
    const note=optimizerContext?unusualMap.get(String(s.id)):null;
    const flag=SHOW_BATTLE_DETAIL_SACRIFICE_FLAGS&&note?` <button class="sacrifice-flag" type="button" data-sacrifice-id="${escapeHtml(String(s.id))}" aria-label="Explain unusual early death for ${escapeHtml(s.name)}" title="Why does this squad die early?">?</button>`:'';
    return `<tr><td>${escapeHtml(s.tier)} · ${escapeHtml(s.name)}${flag}</td><td>${formatInteger(s.quantity)}</td><td>${s.predictedDeathPosition??'—'}</td><td>${Number(s.averageAttackOpportunities||0).toFixed(1)}</td><td>${Math.round(actualRevivalCost(rawSquadRevival({id:s.id,quantity:s.quantity},'gold'))).toLocaleString('en-US')}</td><td>${formatDamage(s.expectedDamagePerOpportunity)}</td><td>${formatDamage(s.expectedLifetimeDamage)}</td></tr>`;
  }).join('');
  const openingNotes=optimizerContext?(opt.diagnostics?.unusualSacrifices??[]).filter(note=>note.reason==='opening-sacrifice'):[];
  const openingNote=document.getElementById('openingSacrificeNote');
  const openingSummary=document.getElementById('openingSacrificeSummary');
  const openingExplanation=document.getElementById('openingSacrificeExplanation');
  if(openingNote&&openingSummary&&openingExplanation){
    openingNote.hidden=!openingNotes.length;openingNote.open=false;
    if(openingNotes.length){
      const labels=openingNotes.map(note=>`${note.tier} ${note.name}`);
      const activeId=String(opt.diagnostics?.displayingOpeningSacrificeAlternativeId??'');
      const activeNote=openingNotes.find(note=>String(note.id)===activeId);
      if(activeNote){
        openingSummary.textContent=`No-sacrifice alternative: ${activeNote.tier} ${activeNote.name} attacks`;
        openingExplanation.innerHTML=`<p>${escapeHtml(openingSacrificeAlternativeText(activeNote))}</p><button class="opening-sacrifice-action" data-restore-maximum-eld type="button">Restore maximum-ELD army</button>`;
      }else{
        openingSummary.textContent=`Opening sacrifice: ${labels.join(', ')} ${openingNotes.length===1?'does':'do'} not attack`;
        openingExplanation.innerHTML=openingNotes.map(note=>{
          const hasAlternative=note.alternativeQuantities&&Number(note.alternativeEld)>0&&Number(note.alternativeEld)<=Number(note.originalEld)+1e-6;
          const button=hasAlternative?`<button class="opening-sacrifice-action" data-opening-alternative-id="${escapeHtml(String(note.id))}" type="button">Use best no-sacrifice alternative — ${formatEldReductionPercent((Number(note.alternativeEld)/Number(note.originalEld)-1)*100)}% less ELD</button>`:'';
          return `<p>${escapeHtml(openingSacrificeText(note))}</p>${button}`;
        }).join('');
      }
    }else{
      openingSummary.textContent='Opening sacrifice';openingExplanation.innerHTML='';
    }
  }
  if(optimizerContext&&unusualMap.size){
    els.predictionRows.querySelectorAll('[data-sacrifice-id]').forEach(button=>button.addEventListener('click',()=>openSacrificeHelp(unusualMap.get(String(button.dataset.sacrificeId)))));
  }
  openingExplanation?.querySelectorAll('[data-opening-alternative-id]').forEach(button=>button.addEventListener('click',()=>showOpeningSacrificeAlternative(button.dataset.openingAlternativeId)));
  openingExplanation?.querySelector('[data-restore-maximum-eld]')?.addEventListener('click',restoreMaximumEldArmy);
}

function formatEldReductionPercent(value){
  const percent=Math.abs(Number(value));
  if(!Number.isFinite(percent))return '—';
  if(percent<.001)return '<0.001';
  return percent.toFixed(percent<1?3:2).replace(/\.?0+$/,'');
}
function openingSacrificeText(note){
  const label=`${note.tier} ${note.name}`;
  let text=`${label} is intentionally acting as an opening shield. The optimizer scores expected damage from the whole army, so keeping this squad alive can reduce attack opportunities for other squads.`;
  const originalEld=Number(note.originalEld),alternativeEld=Number(note.alternativeEld);
  if(Number.isFinite(originalEld)&&originalEld>0&&Number.isFinite(alternativeEld)&&alternativeEld>0){
    const changePct=(alternativeEld/originalEld-1)*100;
    const pctText=formatEldReductionPercent(changePct);
    if(changePct<0)text+=` The best tested adjustment that gives it an attack lowers total ELD by ${pctText}%.`;
    else if(changePct>0)text+=` A tested adjustment that gives it an attack raises total ELD by ${pctText}%; this may indicate another optimization basin worth testing.`;
    else text+=' The best tested adjustment that gives it an attack produces no measurable ELD change.';
  }
  return text;
}
function openingSacrificeAlternativeText(note){
  const reduction=formatEldReductionPercent((Number(note.alternativeEld)/Number(note.originalEld)-1)*100);
  return `${note.tier} ${note.name} now receives ${Number(note.alternativeAttacks||0).toFixed(1)} expected attacks. This constrained alternative lowers total ELD by ${reduction}% compared with the maximum-ELD army.`;
}
function showOpeningSacrificeAlternative(id){
  const maximum=lastOptimizedEpicPayload;
  const note=(maximum?.diagnostics?.unusualSacrifices??[]).find(item=>String(item.id)===String(id));
  if(!note?.alternativeQuantities||currentEpicEffectiveSignature()!==lastOptimizedEpicSignature)return;
  const result=scoreEpicArmy({units:armyV2,quantities:note.alternativeQuantities,bonuses:epicBonusPayload()});
  renderEpicOptimizedResult({
    ...maximum,quantities:{...note.alternativeQuantities},result,
    diagnostics:{...(maximum.diagnostics||{}),displayingOpeningSacrificeAlternativeId:String(note.id)}
  });
}
function restoreMaximumEldArmy(){
  if(!lastOptimizedEpicPayload||currentEpicEffectiveSignature()!==lastOptimizedEpicSignature)return;
  renderEpicOptimizedResult(lastOptimizedEpicPayload);
}

function openSacrificeHelp(note){
  if(!note)return;
  const modal=document.getElementById('sacrificeHelpModal');if(!modal)return;

  const hasPenalty=note.penaltyPct!==null&&note.penaltyPct!==undefined&&Number.isFinite(Number(note.penaltyPct));
  const penalty=hasPenalty?Number(note.penaltyPct):null;
  const originalDeath=Number(note.originalDeath);
  const alternativeDeath=Number(note.alternativeDeath);
  const hasAlternativeDeath=Number.isFinite(alternativeDeath)&&alternativeDeath>0;
  const originalEld=Number(note.originalEld);
  const alternativeEld=Number(note.alternativeEld);
  const hasEldPair=Number.isFinite(originalEld)&&originalEld>0&&Number.isFinite(alternativeEld)&&alternativeEld>0;

  document.getElementById('sacrificeHelpTitle').textContent=`Why does ${note.tier} ${note.name} die early?`;
  let text='The optimizer compares expected damage from the whole army, not the survival of each squad by itself. Keeping this squad alive longer changes the death order and can reduce attack opportunities for other squads.';
  if(['standard-postprocess','standard-live'].includes(lastOptimizedEpicPayload?.diagnostics?.mercenaryOptimizationMode)){
    text+=' This optimizer decision was evaluated before the fixed Standard mercenary stack was added to the final battle result, so the displayed global death position can be later than the optimizer position described below.';
  }

  if(note.reason==='top-tier-first-cycle'){
    text+=' This squad is flagged because it is a top-tier squad dying during the first Arachne cycle while lower-tier squads from the same army capacity survive beyond that cycle.';
  }

  if(hasAlternativeDeath&&hasPenalty){
    const fromDeath=Number.isFinite(originalDeath)&&originalDeath>0?`death #${originalDeath}`:'its current death position';
    const prefix=` A later death position was also tested. Moving this squad from ${fromDeath} to about #${alternativeDeath}`;

    if(hasEldPair){
      const deltaPct=(alternativeEld/originalEld-1)*100;
      const pctText=formatEldReductionPercent(deltaPct);
      const direction=deltaPct>1e-12?'increased':deltaPct<-1e-12?'decreased':'changed';
      text+=`${prefix} changed expected lifetime damage from ${formatDamage(originalEld)} to ${formatDamage(alternativeEld)}`;
      if(direction==='changed')text+=' with no measurable percentage change.';
      else text+=`, which ${direction} ELD by ${pctText}%.`;
    }else if(penalty<=0){
      text+=`${prefix} produced no measurable change in total expected lifetime damage.`;
    }else if(penalty<.001){
      text+=`${prefix} reduced total expected lifetime damage by less than 0.001%.`;
    }else{
      const pct=penalty<.01?penalty.toFixed(3):penalty<.1?penalty.toFixed(2):penalty.toFixed(1);
      text+=`${prefix} reduced total expected lifetime damage by ${pct}%.`;
    }
  }else if(note.reason==='top-tier-first-cycle'){
    text+=' The diagnostic search did not find a feasible later-position comparison for this squad, so no alternative position or ELD change is reported.';
  }

  document.getElementById('sacrificeHelpText').textContent=text;
  modal.hidden=false;document.body.classList.add('sacrifice-help-modal-open');
}
function closeSacrificeHelp(){const modal=document.getElementById('sacrificeHelpModal');if(!modal)return;modal.hidden=true;document.body.classList.remove('sacrifice-help-modal-open');}

function scoreClassicResult(result){if(!armyV2.length)return null;const quantities={};for(const cat of ['troop','monster','mercenary'])for(const row of result?.categories?.[cat]?.results??[])quantities[row.name]=row.qty;return {result:scoreEpicArmy({units:armyV2,quantities,bonuses:epicBonusPayload()}),diagnostics:{classic:true}};}
function convertEpicV2Result(opt){
  const r=opt.result;
  const cats={troop:{results:[]},monster:{results:[]},mercenary:{results:[]}};
  for(const s of r.squads){
    const row={
      id:s.id,category:s.category,displayOrder:s.displayOrder,
      level:s.tier,type:s.combatType,name:s.name,icon:s.icon,
      qty:s.quantity,rawQty:s.quantity,
      squadHealth:s.effectiveHealth,squadStrength:s.nominalSquadStrength,
      totalCapacity:s.capacityUsed,
      expectedDamagePerOpportunity:s.expectedDamagePerOpportunity,
      expectedLifetimeDamage:s.expectedLifetimeDamage,
      averageAttackOpportunities:s.averageAttackOpportunities,
      predictedDeathPosition:s.predictedDeathPosition
    };
    if(cats[s.category])cats[s.category].results.push(row);
  }
  for(const c of Object.values(cats))c.results.sort((a,b)=>a.displayOrder-b.displayOrder);
  return{
    categories:cats,
    totals:{
      leadership:r.capacities.LEADERSHIP,
      authority:r.capacities.AUTHORITY,
      dominance:r.capacities.DOMINANCE
    },
    epicV2:opt
  };
}
function liveStandardMercenaryOptimizerPayload(opt){
  if(!opt?.result||modeState().inputs.includeMercenariesInOptimization)return opt;
  const fixedMercs=fixedStandardMercenaryQuantitiesForOptimizer();

  // The saved optimizer payload contains the last combined result. Strip any
  // mercenary quantities from it to recover the persistent optimized core.
  const coreQuantities={};
  const mercNames=new Set((units.mercenary||[]).map(u=>u.name));
  for(const [name,qty] of Object.entries(opt.quantities||{})){
    if(!mercNames.has(name))coreQuantities[name]=Number(qty)||0;
  }
  // Compatibility fallback for older cached optimizer payloads.
  if(!Object.keys(coreQuantities).length){
    for(const s of opt.result.squads||[]){
      if(s.category!=='mercenary')coreQuantities[s.name]=Number(s.quantity)||0;
    }
  }
  const combinedQuantities={...coreQuantities,...fixedMercs};
  const combinedResult=scoreEpicArmy({
    units:armyV2,
    quantities:combinedQuantities,
    bonuses:epicBonusPayload()
  });
  const normalizedQuantities=Object.fromEntries((combinedResult?.squads||[]).map(s=>[s.name,s.quantity]));

  return{
    ...opt,
    quantities:normalizedQuantities,
    result:combinedResult,
    diagnostics:{
      ...(opt.diagnostics||{}),
      fixedMercenaries:Object.keys(fixedMercs).length,
      mercenaryOptimizationMode:'standard-live',
      combinedExpectedLifetimeDamage:Number(combinedResult.expectedTotalLifetimeDamage||0)
    }
  };
}

function renderEpicOptimizedResult(opt){
  clearLiveDamageMetrics();
  opt=liveStandardMercenaryOptimizerPayload(opt);
  const result=convertEpicV2Result(opt);
  renderResultRows('mercenary',result.categories.mercenary.results);
  renderResultRows('monster',result.categories.monster.results);
  renderResultRows('troop',result.categories.troop.results);
  updateCapacity(result);
  syncAutoFillDisplayToActual(result);
  renderLayerHealthChart(result);
  renderPrediction(opt);
  updateLiveDamageMetric(Number(opt?.result?.expectedTotalLifetimeDamage||0),false,true);
  const count=result.categories.troop.results.length+result.categories.monster.results.length+result.categories.mercenary.results.length;
  els.resultStatus.classList.remove('optimizing-status');
  const alternativeShown=!!opt?.diagnostics?.displayingOpeningSacrificeAlternativeId;
  els.resultStatus.textContent=activeMode==='battle'
    ?`${count} optimized squad${count===1?'':'s'}${alternativeShown?' · Best no-sacrifice alternative':''} · Total Battle mobile entry order`
    :`${count} optimized squad${count===1?'':'s'}${alternativeShown?' · Best no-sacrifice alternative':''} · mobile entry order`;
  els.resultEmpty.hidden=true;
  els.resultGroups.hidden=false;
}
function startEpicOptimization(){
  if(!isAnyEpicOptimizeMode()||epicWorker)return;

  // Final authoritative reconciliation at user action time. This avoids
  // Android/Chrome form-restoration timing differences during initial load.
  reconcileSelectionsFromRenderedUI();
  readInputs();
  syncDerivedEpicBonuses();
  readInputs();
  const any=Object.values(modeState().selectedIds).some(a=>a.length);
  const errors=any?validate():['Select units to build your stack.'];
  showValidation(errors);
  if(errors.length){setOptimizeButtonState();return;}

  resolveAutoFills(baseEngineInputs());
  const requestId=++epicRequestId;
  epicResultCurrent=false;
  els.optimizeArmy.disabled=true;
  els.resultStatus.textContent='Optimizing quantities…';
  els.resultStatus.classList.add('optimizing-status');
  openOptimizerModal();
  startOptimizerElapsedTimer();

  try{
    epicWorker=createOptimizerWorker();
  }catch(error){
    console.error(error);
    stopOptimizerElapsedTimer();
    closeOptimizerModal();
    els.resultStatus.classList.remove('optimizing-status');
    showValidation(['This browser could not start the Epic Optimizer. Refresh the page and try again.']);
    epicResultCurrent=false;
    setOptimizeButtonState();
    return;
  }
  epicWorker.onmessage=(event)=>{
    const msg=event.data??{};
    if(msg.requestId!==requestId)return;
    if(msg.type==='progress'){
      updateOptimizerProgress(msg.payload);
      return;
    }
    if(msg.type==='error'){
      console.error(msg.message,msg.stack);
      if(epicWorker){epicWorker.terminate();epicWorker=null;}
      stopOptimizerElapsedTimer();
      closeOptimizerModal();
      els.resultStatus.classList.remove('optimizing-status');
      showValidation([msg.message||'The Epic optimizer could not complete the stack.']);
      clearResults('Optimization error.');
      epicResultCurrent=false;
      setOptimizeButtonState();
      return;
    }
    if(msg.type==='result'){
      try{
        const elapsedMs=stopOptimizerElapsedTimer();
        if(msg.payload){
          msg.payload.diagnostics={...(msg.payload.diagnostics||{}),optimizationElapsedMs:elapsedMs};
        }
        lastEpicRunDiagnostics={...(msg.diagnostics??{}),optimizationElapsedMs:elapsedMs};
        console.info('[TB Toolkit Epic Optimizer]',{
          build:lastEpicRunDiagnostics,
          expectedLifetimeDamage:msg.payload?.result?.expectedTotalLifetimeDamage,
          capacities:msg.payload?.result?.capacities,
          quantities:msg.payload?.quantities
        });
        updateOptimizerProgress({phase:'finalizing',progressPct:100,evaluations:msg.payload?.diagnostics?.totalEvaluations??msg.payload?.diagnostics?.evaluations,expectedLifetimeDamage:msg.payload?.result?.expectedTotalLifetimeDamage,bestExpectedLifetimeDamage:msg.payload?.diagnostics?.maximumExpectedLifetimeDamage,practicalTieBreakApplied:!!msg.payload?.diagnostics?.practicalTieBreakApplied,practicalTieBreakLossPct:msg.payload?.diagnostics?.practicalTieBreakLossPct});
        renderEpicOptimizedResult(msg.payload);
        lastOptimizedEpicPayload=msg.payload;
        epicResultCurrent=true;
        lastOptimizedEpicSignature=currentEpicEffectiveSignature();
        saveOptimizerResult();
      }catch(error){
        console.error(error);
        showValidation([error.message||'The Epic optimizer result could not be rendered.']);
        clearResults('Optimization error.');
        epicResultCurrent=false;
      }finally{
        if(epicWorker){epicWorker.terminate();epicWorker=null;}
        setTimeout(closeOptimizerModal,180);
        setOptimizeButtonState();
      }
    }
  };
  epicWorker.onerror=(event)=>{
    if(requestId!==epicRequestId)return;
    console.error(event);
    if(epicWorker){epicWorker.terminate();epicWorker=null;}
    stopOptimizerElapsedTimer();
    closeOptimizerModal();
    els.resultStatus.classList.remove('optimizing-status');
    showValidation(['The Epic optimizer worker encountered an error.']);
    clearResults('Optimization error.');
    epicResultCurrent=false;
    setOptimizeButtonState();
  };
  const includeMercs=!!modeState().inputs.includeMercenariesInOptimization;
  const fixedMercenaryQuantities=includeMercs?{}:fixedStandardMercenaryQuantitiesForOptimizer();
  epicWorker.postMessage({
    type:'optimize',requestId,
    selectedIds:[
      ...modeState().selectedIds.troop,
      ...modeState().selectedIds.monster,
      ...(includeMercs?modeState().selectedIds.mercenary:[])
    ],
    fixedQuantities:fixedMercenaryQuantities,
    fixedMercenaryIds:includeMercs?[]:[...(modeState().selectedIds.mercenary||[])],
    fixedAuthorityMaximum:Math.max(0,Math.floor(parseNumber(modeState().inputs.authority))),
    bonuses:epicBonusPayload(),
    capacityLimits:effectiveEpicCapacityLimits()
  });
}

function updateVisibleStepNumbers(){
  if(activeMode!=='battle')return;
  let step=5;
  document.querySelectorAll('.battle-sequenced-section').forEach(section=>{
    const style=getComputedStyle(section);
    if(section.hidden||style.display==='none'||style.visibility==='hidden')return;
    const badge=section.querySelector('.managed-step-number, .section-kicker');
    if(!badge)return;
    badge.textContent=String(step++);
  });
}

function syncResultsMethodSwitch(){
  if(!els.resultsMethodSwitch)return;
  const visible=activeMode==='battle'&&currentEncounter()?.battleType==='epic';
  els.resultsMethodSwitch.hidden=!visible;
  const active=state.modes.battle.activeBattleMethod||'optimize';
  els.resultsMethodSwitch.querySelectorAll('[data-results-method]').forEach(button=>{
    const selected=button.dataset.resultsMethod===active;
    button.classList.toggle('is-active',selected);
    button.setAttribute('aria-pressed',String(selected));
  });
}

function selectBattleMethod(requested,preserveResultsPosition=false){
  if(activeMode!=='battle')return;
  const resultsTop=preserveResultsPosition&&els.resultsView?els.resultsView.getBoundingClientRect().top:null;
  if(resultsTop!==null)document.documentElement.classList.add('preserve-results-position');
  readInputs();saveState();
  const type=state.modes.battle.activeBattleType||'epic_standard';
  let method=requested==='optimize'?'optimize':'custom';
  if(method==='optimize'&&type.startsWith('pvp_'))method='custom';
  state.modes.battle.activeBattleMethod=method;
  if(els.battleMethodSelect)els.battleMethodSelect.value=method;
  ensureBattleWorkspace(type,method);
  loadSavedOptimizerResult();
  refreshActiveMode();
  if(resultsTop!==null){
    window.scrollBy(0,els.resultsView.getBoundingClientRect().top-resultsTop);
    requestAnimationFrame(()=>document.documentElement.classList.remove('preserve-results-position'));
  }
}

function configureModeUI(){
  const classic=activeMode==='epic';
  const optimizer=activeMode==='optimizer';
  const custom=activeMode==='custom';
  const battle=activeMode==='battle';

  document.querySelectorAll('.mode-button').forEach(b=>{
    const on=b.dataset.mode===activeMode;
    b.classList.toggle('active',on);
    b.setAttribute('aria-pressed',String(on));
  });

  els.modeDescription.textContent=battle
    ?'Build and optimize an army for Epic Monster or Player vs. Player battles.'
    : classic
      ?'Automatically orders selected squads for Epic battles using the Squad Separation setting.'
      : optimizer
        ?'Epic Optimizer calculates stack quantities for the units you select. It searches many possible army structures and uses simulated Epic battles to find the army with the highest expected lifetime damage.'
        :'You choose the death order by level. The calculator automatically orders unit types within each level.';

  const battleCustom=battle&&state.modes.battle.activeBattleMethod==='custom';
  els.orderView.hidden=!(custom||battleCustom);
  els.arachneRow.hidden=custom||battle;
  if(battle)els.arachneRow.style.display='none';
  else els.arachneRow.style.removeProperty('display');
  if(els.battleBetaPanel)els.battleBetaPanel.hidden=!battle;
  document.body.classList.toggle('battle-mode-active',battle);
  if(els.setupStepNumber)els.setupStepNumber.textContent=battle?'3':'1';
  if(els.selectionStepNumber&&!battle)els.selectionStepNumber.textContent='2';
  if(battle){
    refreshWorkspaceSelectors();
    loadEncounterNormSettings();
    const type=currentEngineBattleType();state.modes.battle.activeBattleType=type;
    const method=state.modes.battle.activeBattleMethod||'optimize';
    if(els.battleMethodSelect){
      const optimizeOption=els.battleMethodSelect.querySelector('option[value="optimize"]');
      if(optimizeOption)optimizeOption.disabled=type.startsWith('pvp_');
      if(type.startsWith('pvp_')&&state.modes.battle.activeBattleMethod==='optimize'){
        state.modes.battle.activeBattleMethod='custom';ensureBattleWorkspace(type,'custom');
      }
      els.battleMethodSelect.value=state.modes.battle.activeBattleMethod||'optimize';
    }
    modeState().inputs.arachne=!!currentEncounter()?.arachneBonus;
    if(currentEncounter()?.battleType==='epic')modeState().inputs.enemySquadTypes=enemySquadTypes(currentEncounter().enemyFormation);
    const isPvp=type.startsWith('pvp_');
    const optimizeOption=document.getElementById('battleMethodOptimizeOption');
    if(optimizeOption){
      optimizeOption.hidden=isPvp;
      optimizeOption.disabled=isPvp;
    }
    if(isPvp&&state.modes.battle.activeBattleMethod==='optimize'){
      state.modes.battle.activeBattleMethod='custom';
      if(els.battleMethodSelect)els.battleMethodSelect.value='custom';
    }
    if(els.strengthAgainstEpicField)els.strengthAgainstEpicField.hidden=isPvp;
    if(els.pvpHealthField)els.pvpHealthField.hidden=!isPvp;
    if(els.pvpStrengthField)els.pvpStrengthField.hidden=!isPvp;
    if(els.pvpEnemyUnitField)els.pvpEnemyUnitField.hidden=type!=='pvp_single_cp';
    if(type==='pvp_single_cp'&&els.pvpEnemyUnitSelect&&armyV2.length){
      const enemyId=modeState().inputs.enemyUnitId||'troop-g9-flying-corax-2';
      els.pvpEnemyUnitSelect.value=armyV2.some(u=>u.id===enemyId)?enemyId:'troop-g9-flying-corax-2';
    }
    if(els.battleContextNote)els.battleContextNote.textContent=
      type==='epic'?`${currentEncounter()?.name||'Epic Monster'}: ${modeState().inputs.enemySquadTypes.length} enemy squad${modeState().inputs.enemySquadTypes.length===1?'':'s'}${modeState().inputs.arachne?' with the Arachne bonus.':'.'}`
      :type==='pvp_unknown'?'PvP: enemy squad count and composition are unknown. Damage value is averaged across valid PvP target archetypes.'
      :'PvP — 1 enemy squad: the calculator builds a stack for a battle against one selected enemy squad.';
    const activeMethod=state.modes.battle.activeBattleMethod||'custom';
    if(els.battleMethodNote)els.battleMethodNote.textContent=
      activeMethod==='optimize'
        ?'Optimize: searches many possible army structures and death orders. It uses simulated battles to find the army with the highest expected lifetime damage.'
        :activeMethod==='custom'
          ?'Custom: starts with the default death order. You can rearrange squads to test another order.'
          :type==='pvp_single_cp'
            ?'Standard: fills each capacity pool and orders its squads automatically. Gold revival cost is prioritized, stronger squads are preserved when Gold costs are similar, and Silver breaks remaining ties. The global death order follows calculated squad health.'
            :type==='pvp_unknown'
              ?'Standard: fills each capacity pool and orders its squads automatically. Gold revival cost is prioritized, stronger average PvP damage is preserved when Gold costs are similar, and Silver breaks remaining ties. The global death order follows calculated squad health.'
              :'Standard: calculates squad quantities using the selected Squad Separation. The death order generally preserves squads with greater damage potential for later attacks.';
  }
  if(!battle){
    if(els.strengthAgainstEpicField)els.strengthAgainstEpicField.hidden=false;
    if(els.pvpHealthField)els.pvpHealthField.hidden=true;
    if(els.pvpStrengthField)els.pvpStrengthField.hidden=true;
    if(els.pvpEnemyUnitField)els.pvpEnemyUnitField.hidden=true;
  }
  if((battleCustom||custom)&&armyV2.length){syncCustomOrders();renderOrderView();}
  const battleOptimize=isBattleOptimizeMode();
  document.querySelectorAll('.optimizer-only').forEach(el=>el.hidden=!(optimizer||battleOptimize));
  document.querySelectorAll('.separation-mode-only').forEach(el=>el.hidden=optimizer||battleOptimize);


  if(classic||custom||battle){
    els.separationLabel.textContent='Squad Separation';
    els.rankSeparation.min='0';els.rankSeparation.max='1';els.rankSeparation.step='0.01';
    els.separationMin.textContent='0%';els.separationMid.textContent='0.50%';els.separationMax.textContent='1.00%';
  }

  const nums=document.querySelectorAll('.output-section-number');
  if(nums[0])nums[0].textContent=custom?'4':optimizer?'4':'3';
  if(nums[1])nums[1].textContent=custom?'5':optimizer?'5':'4';

  syncDerivedEpicBonuses();
  syncResultsMethodSwitch();
  updateVisibleStepNumbers();
  setOptimizeButtonState();
  setReviewSelectionState();
}
function applyStateToInputs(){
  const i=normalizeBonusProfileInputs(modeState().inputs);
  for(const id of ['leadership','authority','dominance','monsterHealth','pvpHealth','monsterStrength','strengthAgainstEpic','pvpStrength','monsterDD','monsterST',...BONUS_PROFILE_FIELD_IDS]){
    if(!els[id])continue;
    els[id].value=i[id]??defaultInputs(activeMode)[id]??'';
  }
  for(const id of ['leadership','authority','dominance'])formatFieldInteger(els[id]);
  for(const id of ['leadershipFill','authorityFill','dominanceFill']){
    els[id].value=i[id]??'';
    formatFillPercent(els[id]);
  }
  els.rankSeparation.value=String(Math.min(1,Math.max(0,parseNumber(i.rankSeparation??'0.05'))));
  if(els.minimumSeparation)els.minimumSeparation.checked=i.minimumSeparation!==false;
  for(const id of ['autoLeadership','autoAuthority','autoDominance'])els[id].checked=!!i[id];
  for(const {auto} of BONUS_INPUT_ROWS)if(els[auto])els[auto].checked=i[auto]!==false;
  els.arachne.checked=!!i.arachne;
  els.includeMercenariesInOptimization.checked=!!i.includeMercenariesInOptimization;
  if(els.pvpEnemyUnitSelect&&armyV2.length){
    const id=i.enemyUnitId||'troop-g9-flying-corax-2';
    els.pvpEnemyUnitSelect.value=armyV2.some(u=>u.id===id)?id:'troop-g9-flying-corax-2';
  }
  populateTempleLevel();
  configureModeUI();
  updateRankSeparationDisplay();
  updateSeparationModeUI();
  updateFillFieldStates();
}
function readInputs(){
  const i=modeState().inputs;
  for(const id of ['leadership','authority','dominance','monsterHealth','pvpHealth','monsterStrength','strengthAgainstEpic','pvpStrength','monsterDD','monsterST',...BONUS_PROFILE_FIELD_IDS]){
    if(els[id])i[id]=String(parseNumber(els[id].value));
  }
  i.rankSeparation=String(parseNumber(els.rankSeparation.value));
  if(!isAnyEpicOptimizeMode()){
    i.minimumSeparation=!!els.minimumSeparation?.checked;
  }
  if(activeMode==='battle'&&els.pvpEnemyUnitSelect)i.enemyUnitId=els.pvpEnemyUnitSelect.value||'troop-g9-flying-corax-2';
  for(const id of ['autoLeadership','autoAuthority','autoDominance'])i[id]=els[id].checked;
  for(const [cat,meta] of Object.entries(CAPACITY_META)){
    if(!i[meta.auto])i[meta.fill]=String(parseNumber(els[meta.fill].value));
  }
  if(activeMode!=='battle')i.arachne=els.arachne.checked;
  for(const {auto} of BONUS_INPUT_ROWS)i[auto]=els[auto]?.checked!==false;
  i.useCustomFamilyBonuses=false;
  i.includeMercenariesInOptimization=!!els.includeMercenariesInOptimization?.checked;
  saveState();
}
function updateSeparationModeUI(){
  const optimizing=isAnyEpicOptimizeMode();
  const minimum=modeState().inputs.minimumSeparation!==false;
  if(els.minimumSeparation)els.minimumSeparation.checked=minimum;
  if(els.fixedSeparationControl)els.fixedSeparationControl.hidden=optimizing||minimum;
  const t=els.minimumSeparation?.closest('.minimum-separation-toggle');
  if(t)t.hidden=optimizing;
}
function updateFillFieldStates(){for(const [cat,meta] of Object.entries(CAPACITY_META)){const auto=!!modeState().inputs[meta.auto];els[meta.fill].disabled=auto;if(!auto)els[meta.fill].value=modeState().inputs[meta.fill]??'99.99';}}

function troopLevelCompare(a,b){const ma=/^([GSE])(\d+)$/.exec(a),mb=/^([GSE])(\d+)$/.exec(b);if(!ma||!mb)return a.localeCompare(b);const tier=Number(mb[2])-Number(ma[2]);if(tier)return tier;return({G:0,S:1,E:2}[ma[1]]??9)-({G:0,S:1,E:2}[mb[1]]??9);}
function monsterLevelCompare(a,b){return parseInt(b.slice(1))-parseInt(a.slice(1));}
function mercLevelCompare(a,b){const [na,ca]=a.split('-'),[nb,cb]=b.split('-');const tierOrder=[2,7,6,5];const ia=tierOrder.indexOf(Number(na)),ib=tierOrder.indexOf(Number(nb));if(ia!==ib)return (ia<0?99:ia)-(ib<0?99:ib);const classOrder=['COM','MNST','SPCL','GRD','EMH','EX','ARNE','ENG'];return classOrder.indexOf(ca)-classOrder.indexOf(cb);}
function getLevelRows(category){const map=new Map();for(const u of units[category]){if(!map.has(u.level))map.set(u.level,[]);map.get(u.level).push(u);}let levels=[...map.keys()];levels.sort(category==='troop'?troopLevelCompare:category==='monster'?monsterLevelCompare:mercLevelCompare);return levels.map(level=>({level,rows:map.get(level).sort((a,b)=>b.strengthEach-a.strengthEach||a.name.localeCompare(b.name))}));}
function selectedSet(category){return new Set(modeState().selectedIds[category]);}
function selectedIdsFor(category){return modeState().selectedIds[category];}
function selectedLevels(category){const ids=new Set(selectedIdsFor(category)),levels=[];for(const group of getLevelRows(category))if(group.rows.some(u=>ids.has(u.id)))levels.push(group.level);return levels;}
function activeOrderState(){
  return activeMode==='battle' ? currentBattleWorkspace() : state.modes.custom;
}
function isBattleOptimizeMode(){
  if(activeMode!=='battle')return false;
  const type=state.modes.battle.activeBattleType||'epic_standard';
  return state.modes.battle.activeBattleMethod==='optimize' &&
    type==='epic';
}
function isAnyEpicOptimizeMode(){
  return activeMode==='optimizer'||isBattleOptimizeMode();
}

function isCustomOrderMode(){
  return activeMode==='custom'||(activeMode==='battle'&&state.modes.battle.activeBattleMethod==='custom');
}
function defaultCustomUnitIds(category,level){
  const chosen=units[category].filter(u=>u.level===level&&selectedIdsFor(category).includes(u.id));
  if(!chosen.length)return[];
  const battleType=activeMode==='battle'?state.modes.battle.activeBattleType:'epic_standard';
  if(String(battleType).startsWith('pvp_')){
    const inputs=baseEngineInputs();
    const enemy=battleType==='pvp_single_cp'?selectedPvpEnemy():null;
    if(battleType==='pvp_unknown'){
      // Let the unknown PvP wrapper's existing archetype model establish its
      // automatic order by calculating this tier with no explicit override.
      const selectedIds={troop:[],monster:[],mercenary:[]};selectedIds[category]=chosen.map(u=>u.id);
      const orders={troop:[],monster:[],mercenary:[]};orders[category]=[level];
      const result=calculatePvpUnknownCustomStack({troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,selectedIds,orders,unitOrders:null,inputs});
      return result.categories[category].results.slice().sort((a,b)=>a.plannedDeathIndex-b.plannedDeathIndex).map(r=>r.id);
    }
    return defaultPvpInternalOrder({category,units:units[category],selectedIds:chosen.map(u=>u.id),inputs,order:[level],enemy});
  }
  const planned=standardEpicDefaultOrder(category);
  const chosenIds=new Set(chosen.map(unit=>unit.id));
  const filtered=planned.filter(id=>chosenIds.has(id));
  return filtered.length===chosen.length
    ?filtered
    :chosen.slice().sort((a,b)=>customInternalRank(a,units[category])-customInternalRank(b,units[category])||a.displayOrder-b.displayOrder).map(u=>u.id);
}
function legacyDefaultFlatOrder(category,stateRef=activeOrderState()){
  const selected=new Set(selectedIdsFor(category));
  return (stateRef.orders?.[category]||[]).flatMap(level=>stateRef.unitOrders?.[category]?.[level]||[]).filter(id=>selected.has(id));
}
function insertMissingByDefault(existing,defaultOrder,missingId){
  const target=defaultOrder.indexOf(missingId);
  if(target<0)return [...existing,missingId];
  for(let i=target-1;i>=0;i--){const id=defaultOrder[i],at=existing.indexOf(id);if(at>=0){const next=[...existing];next.splice(at+1,0,missingId);return next;}}
  for(let i=target+1;i<defaultOrder.length;i++){const id=defaultOrder[i],at=existing.indexOf(id);if(at>=0){const next=[...existing];next.splice(at,0,missingId);return next;}}
  return [...existing,missingId];
}
function syncCustomOrders(){
 // Never reconcile persisted order against an empty database during startup.
 if(!isCustomOrderMode()||!armyV2.length)return;
 const s=activeOrderState();
 s.unitOrders=s.unitOrders||{troop:{},monster:{},mercenary:{}};
 s.unitOrderManual=s.unitOrderManual||{troop:{},monster:{},mercenary:{}};
 s.squadOrder=s.squadOrder||{troop:[],monster:[],mercenary:[]};
 // Keep the v174 nested model alive only as the trusted default-order generator
 // and as a migration source for existing saved workspaces.
 for(const c of ['troop','monster','mercenary']){
  const levels=selectedLevels(c),set=new Set(levels),next=(s.orders[c]||[]).filter(x=>set.has(x));for(const l of levels)if(!next.includes(l))next.push(l);s.orders[c]=next;s.unitOrders[c]=s.unitOrders[c]||{};s.unitOrderManual[c]=s.unitOrderManual[c]||{};
  for(const l of levels){
   const chosen=units[c].filter(u=>u.level===l&&selectedIdsFor(c).includes(u.id)),ids=new Set(chosen.map(u=>u.id));
   if(s.unitOrderManual[c][l]){const saved=(s.unitOrders[c][l]||[]).filter(id=>ids.has(id));for(const id of defaultCustomUnitIds(c,l))if(!saved.includes(id))saved.push(id);s.unitOrders[c][l]=saved;}
   else s.unitOrders[c][l]=defaultCustomUnitIds(c,l);
  }
  for(const l of Object.keys(s.unitOrders[c]))if(!set.has(l)){delete s.unitOrders[c][l];delete s.unitOrderManual[c][l];}

  const selected=new Set(selectedIdsFor(c));
  const defaults=customOrderV2DefaultFlatOrder(c,s);
  let flat=(s.squadOrder[c]||[]).filter(id=>selected.has(id));
  const legacyFlat=legacyDefaultFlatOrder(c,s);
  const oldAutomatic=legacyEpicDefaultFlatOrder(c);
  if(flat.length&&(
    (flat.length===legacyFlat.length&&flat.every((id,index)=>id===legacyFlat[index]))||
    (flat.length===oldAutomatic.length&&flat.every((id,index)=>id===oldAutomatic[index]))
  ))flat=[...defaults];
  // First v175 load migrates the exact v174 tier + internal order into one list.
  if(!flat.length&&selected.size)flat=[...defaults];
  for(const id of defaults)if(selected.has(id)&&!flat.includes(id))flat=insertMissingByDefault(flat,defaults,id);
  for(const id of selected)if(!flat.includes(id))flat.push(id);
  s.squadOrder[c]=flat;
 }
}
function moveSquadOrderItem(category,index,delta){
 const a=activeOrderState().squadOrder?.[category]||[],next=index+delta;if(next<0||next>=a.length)return;
 [a[index],a[next]]=[a[next],a[index]];saveState();renderOrderView();recalculate();
}
function commitSquadOrderFromDom(category,target){
 activeOrderState().squadOrder[category]=[...target.querySelectorAll(':scope > .squad-order-item')].map(x=>x.dataset.unitId);
 saveState();recalculate();
}
function resetCustomOrderToDefault(){
 if(!isCustomOrderMode())return;const s=activeOrderState();
 s.orders={troop:[],monster:[],mercenary:[]};s.unitOrders={troop:{},monster:{},mercenary:{}};s.unitOrderManual={troop:{},monster:{},mercenary:{}};s.squadOrder={troop:[],monster:[],mercenary:[]};
 syncCustomOrders();
 for(const category of ['troop','monster','mercenary'])s.squadOrder[category]=customOrderV2DefaultFlatOrder(category,s);
 saveState();renderOrderView();recalculate();
}
function customOrderMatchupValue(unit){
 const b=unit?.bonuses||{},bonus=k=>Number(b[String(k||'').toLowerCase()]||0);
 const battleType=activeMode==='battle'?state.modes.battle.activeBattleType:'epic_standard';
 if(battleType==='pvp_single_cp'){
  const enemy=selectedPvpEnemy();return bonus(enemy?.type)+bonus(enemy?.species);
 }
 if(battleType==='pvp_unknown'){
  const combat=['flying','mounted','melee','ranged'].reduce((s,k)=>s+bonus(k),0)/4;
  const species=['human','beast','dragon','giant','elemental'].reduce((s,k)=>s+bonus(k),0)/5;
  return combat+species;
 }
 const bestCombat=Math.max(...['flying','mounted','melee','ranged'].map(bonus));
 return bestCombat+bonus('epic')+(modeState().inputs.arachne?bonus('arachne'):0);
}
function customOrderMatchupText(unit){
 const pct=Math.round(customOrderMatchupValue(unit)*100);
 const battleType=activeMode==='battle'?state.modes.battle.activeBattleType:'epic_standard';
 if(battleType==='pvp_single_cp')return `MATCHUP +${pct}%`;
 if(battleType==='pvp_unknown')return `AVG MATCHUP +${pct}%`;
 return `BEST MATCHUP +${pct}%`;
}
function customOrderTierNumber(unit){
 const match=String(unit?.level||'').match(/\d+/);return match?Number(match[0]):999;
}
let standardEpicDefaultOrderCache={key:'',orders:null};
function standardEpicDefaultOrders(){
 const battleType=activeMode==='battle'?state.modes.battle.activeBattleType:'epic_standard';
 const selectedIds={troop:[...selectedIdsFor('troop')],monster:[...selectedIdsFor('monster')],mercenary:[...selectedIdsFor('mercenary')]};
 const inputs={...baseEngineInputs(),arachne:!!modeState().inputs.arachne,enemySquadTypes:modeState().inputs.enemySquadTypes};
 const key=JSON.stringify({battleType,selectedIds,inputs});
 if(standardEpicDefaultOrderCache.key===key&&standardEpicDefaultOrderCache.orders)return standardEpicDefaultOrderCache.orders;
 const standard=calculateEpicStack({troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,selectedIds,inputs});
 const orders=standard?.plannedOrderByCategory||{troop:[],monster:[],mercenary:[]};
 standardEpicDefaultOrderCache={key,orders};
 return orders;
}
function standardEpicDefaultOrder(category){return [...(standardEpicDefaultOrders()[category]||[])];}
function legacyEpicDefaultFlatOrder(category){
 const selected=new Set(selectedIdsFor(category));
 return units[category].filter(unit=>selected.has(unit.id)).slice().sort((a,b)=>{
   const av=customOrderMatchupValue(a),bv=customOrderMatchupValue(b);
   if(Math.abs(av-bv)>1e-12)return av-bv;
   const at=customOrderTierNumber(a),bt=customOrderTierNumber(b);
   if(at!==bt)return at-bt;
   return Number(a.displayOrder||0)-Number(b.displayOrder||0);
 }).map(unit=>unit.id);
}
function customOrderV2DefaultFlatOrder(category,stateRef=activeOrderState()){
 const selected=new Set(selectedIdsFor(category));
 const battleType=activeMode==='battle'?state.modes.battle.activeBattleType:'epic_standard';

 // PvP Custom Order starts from the exact Standard ordering for this capacity
 // pool. The completed Troop, Monster, and Mercenary squads are then combined
 // and the game's global healthiest-target-first order emerges from health.
 if(String(battleType).startsWith('pvp_')){
   const selectedIds={
     troop:[...selectedIdsFor('troop')],
     monster:[...selectedIdsFor('monster')],
     mercenary:[...selectedIdsFor('mercenary')]
   };
   const inputs=baseEngineInputs();
   let standard=null;
   if(battleType==='pvp_unknown'){
     standard=calculatePvpUnknownStack({
       troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,
       selectedIds,inputs
     });
   }else{
     standard=calculatePvpCpStack({
       troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,
       selectedIds,inputs,enemy:selectedPvpEnemy(),battleType:'pvp_single_cp'
     });
   }
   const planned=Array.isArray(standard?.plannedOrderByCategory?.[category])
     ?standard.plannedOrderByCategory[category]
     :(Array.isArray(standard?.plannedOrder)?standard.plannedOrder:[]);
   const filtered=planned.filter(id=>selected.has(id));
   if(filtered.length===selected.size)return filtered;

   // Defensive fallback if a future PvP result omits plannedOrder.
   const rows=standard?.categories?.[category]?.results||[];
   const fallback=rows.slice().sort((a,b)=>
     Number(a.plannedDeathIndex??a.deathIndex??0)-Number(b.plannedDeathIndex??b.deathIndex??0)
   ).map(r=>r.id).filter(id=>selected.has(id));
   for(const id of selected)if(!fallback.includes(id))fallback.push(id);
   return fallback;
 }

 return standardEpicDefaultOrder(category).filter(id=>selected.has(id));
}

function untouchedEpicCustomOrderMatchesStandard(){
 if(activeMode!=='battle'||state.modes.battle.activeBattleType!=='epic'||state.modes.battle.activeBattleMethod!=='custom')return false;
 const orderState=currentBattleWorkspace().methods.custom;
 return ['troop','monster','mercenary'].every(category=>{
   const selected=new Set(selectedIdsFor(category));
   const actual=(orderState.squadOrder?.[category]||[]).filter(id=>selected.has(id));
   const expected=standardEpicDefaultOrder(category).filter(id=>selected.has(id));
   return actual.length===expected.length&&actual.every((id,index)=>id===expected[index]);
 });
}

let customOrderFloatObserver=null;
function updateCustomOrderFloatingMetric(){
  const bar=els.customOrderFloatingMetric||document.getElementById('customOrderFloatingMetric');
  const panel=els.orderView||document.getElementById('orderView');
  if(!bar||!panel){return;}
  const active=isCustomOrderMode()&&!panel.hidden;
  if(!active){bar.hidden=true;return;}
  const r=panel.getBoundingClientRect();
  const visible=r.bottom>80&&r.top<window.innerHeight-40;
  // Show the compact floating metric after the normal heading has scrolled
  // out of view, and hide it again when the Custom Order section leaves view.
  bar.hidden=!(visible&&r.top<70);
}
function wireCustomOrderFloatingMetric(){
  if(customOrderFloatObserver)return;
  const panel=els.orderView||document.getElementById('orderView');
  if(!panel)return;
  customOrderFloatObserver=new IntersectionObserver(()=>updateCustomOrderFloatingMetric(),{threshold:[0,0.01,0.2,1]});
  customOrderFloatObserver.observe(panel);
  window.addEventListener('scroll',updateCustomOrderFloatingMetric,{passive:true});
  window.addEventListener('resize',updateCustomOrderFloatingMetric,{passive:true});
}
function renderOrderView(){
 syncCustomOrders();updateCustomOrderFloatingMetric();const ids={troop:'troopOrderList',monster:'monsterOrderList',mercenary:'mercenaryOrderList'},st=activeOrderState();
 for(const category of ['troop','monster','mercenary']){
  const target=els[ids[category]],order=st.squadOrder?.[category]||[],selected=new Set(selectedIdsFor(category)),unitMap=new Map(units[category].filter(u=>selected.has(u.id)).map(u=>[u.id,u]));
  target.innerHTML='';
  if(!order.length){target.innerHTML='<div class="order-empty">Select units to create an order.</div>';continue;}
  order.filter(id=>unitMap.has(id)).forEach((id,index)=>{
   const u=unitMap.get(id),row=document.createElement('div'),col=orderRowColors(category,u.level);row.className='squad-order-item';row.draggable=true;row.dataset.unitId=id;
   row.style.setProperty('--order-row-color',col.rowColor);row.style.setProperty('--order-accent',col.accent);
   row.innerHTML=`<div class="squad-order-icon-wrap"><img class="squad-order-icon" src="${escapeHtml(u.icon||'assets/unit-icons/missing-icon.svg')}" alt=""/></div><div class="squad-order-copy"><strong>${escapeHtml(u.name)}</strong><span>${escapeHtml(u.level)} · ${escapeHtml(u.type)}</span></div><div class="squad-order-bonus">${escapeHtml(customOrderMatchupText(u))}</div><button class="squad-order-move" type="button" aria-label="Move up">↑</button><button class="squad-order-move" type="button" aria-label="Move down">↓</button>`;
   const img=row.querySelector('.squad-order-icon');if(img)iconFallback(img);
   const buttons=row.querySelectorAll('.squad-order-move');
   buttons.forEach(btn=>{btn.draggable=false;btn.onpointerdown=ev=>ev.stopPropagation();});
   buttons[0].onclick=()=>moveSquadOrderItem(category,index,-1);buttons[1].onclick=()=>moveSquadOrderItem(category,index,1);
   row.ondragstart=ev=>{
     if(ev.target?.closest?.('.squad-order-move')){ev.preventDefault();return;}
     row.classList.add('dragging');ev.dataTransfer.effectAllowed='move';ev.dataTransfer.setData('text/plain',id);
   };
   row.ondragend=()=>{row.classList.remove('dragging');target.classList.remove('drag-active');commitSquadOrderFromDom(category,target)};
   target.append(row);
  });
  target.ondragover=ev=>{const dragging=target.querySelector('.squad-order-item.dragging');if(!dragging)return;ev.preventDefault();target.classList.add('drag-active');let before=null;for(const x of target.querySelectorAll(':scope > .squad-order-item:not(.dragging)')){const r=x.getBoundingClientRect();if(ev.clientY<r.top+r.height/2){before=x;break}}before?target.insertBefore(dragging,before):target.append(dragging)};
 }
}

const expandedSelectionSections=new Set();
const MERC_LEVEL_LABEL={2:'II',7:'VII',6:'VI',5:'V'};
const MERC_GROUP_ORDER=['COMMON','MONSTER','SPECIALIST','GUARDSMAN','EPIC - HUNTER','EPIC - EVENT','ARACHNE','ENGINEER'];
const MERC_GROUP_LABEL={'COMMON':'Common','MONSTER':'Monsters','SPECIALIST':'Specialists','GUARDSMAN':'Guardsmen','EPIC - HUNTER':'Epic Hunters','EPIC - EVENT':'Epic Event','ARACHNE':'Arachne','ENGINEER':'Engineers'};

function liveStandardMercenaryRefreshAvailable(){
  return isAnyEpicOptimizeMode()
    && !modeState().inputs.includeMercenariesInOptimization
    && !!lastOptimizedEpicPayload
    && !!lastOptimizedEpicSignature
    && currentEpicEffectiveSignature()===lastOptimizedEpicSignature;
}

function refreshLiveStandardMercenaries(){
  readInputs();
  syncDerivedEpicBonuses();
  readInputs();

  if(!liveStandardMercenaryRefreshAvailable())return false;

  const errors=validate();
  showValidation(errors);
  if(errors.length)return false;

  epicResultCurrent=true;
  renderEpicOptimizedResult(lastOptimizedEpicPayload);
  setOptimizeButtonState();
  return true;
}

function recalculateAfterMercenaryOnlyChange(){
  saveState();
  if(refreshLiveStandardMercenaries())return;
  recalculate();
}

function setSelection(category,rows,checked){
  const set=selectedSet(category);
  for(const unit of rows)checked?set.add(unit.id):set.delete(unit.id);
  modeState().selectedIds[category]=[...set];
  syncCustomOrders();saveState();updateCounts();renderAllSelections();
  if(isCustomOrderMode())renderOrderView();
  if(category==='mercenary'&&isAnyEpicOptimizeMode()&&!modeState().inputs.includeMercenariesInOptimization){
    recalculateAfterMercenaryOnlyChange();
    return;
  }
  recalculate();
}
function setOneSelection(category,id,checked){
  const set=selectedSet(category);checked?set.add(id):set.delete(id);
  modeState().selectedIds[category]=[...set];
  syncCustomOrders();saveState();updateCounts();renderAllSelections();
  if(isCustomOrderMode())renderOrderView();
  if(category==='mercenary'&&isAnyEpicOptimizeMode()&&!modeState().inputs.includeMercenariesInOptimization){
    recalculateAfterMercenaryOnlyChange();
    return;
  }
  recalculate();
}
function clearAllSelections(){
  modeState().selectedIds={troop:[],monster:[],mercenary:[]};
  if(activeMode==='custom'){
    state.modes.custom.orders={troop:[],monster:[],mercenary:[]};
    state.modes.custom.unitOrders={troop:{},monster:{},mercenary:{}};
    state.modes.custom.unitOrderManual={troop:{},monster:{},mercenary:{}};
  }
  if(activeMode==='battle'){
    const workspace=currentBattleWorkspace();
    workspace.orders={troop:[],monster:[],mercenary:[]};
    workspace.unitOrders={troop:{},monster:{},mercenary:{}};
    workspace.unitOrderManual={troop:{},monster:{},mercenary:{}};
    workspace.squadOrder={troop:[],monster:[],mercenary:[]};
  }
  saveState();updateCounts();renderAllSelections();if(isCustomOrderMode())renderOrderView();recalculate();
}
function checkboxState(input,rows,selected){
  const all=rows.length>0&&rows.every(u=>selected.has(u.id));
  const some=rows.some(u=>selected.has(u.id));
  input.checked=all;input.indeterminate=!all&&some;
}
function createUnitOption(category,unit,selected){
  const label=document.createElement('label');
  const on=selected.has(unit.id);
  label.className=`hierarchy-unit${on?' selected':''}`;
  const levelColors=selectionLevelColors(category,unit.level);
  label.style.setProperty('--level-base',levelColors.base);
  label.style.setProperty('--level-surface',levelColors.surface);
  label.style.setProperty('--level-border',levelColors.border);
  label.style.setProperty('--level-text',levelColors.text);
  label.title=`${unit.name} · ${unit.level} · ${unit.type} · Strength/EA ${formatInteger(unit.strengthEach)}`;
  label.innerHTML=`<input type="checkbox" data-selection-category="${escapeHtml(category)}" data-unit-id="${escapeHtml(unit.id)}" ${on?'checked':''}><span class="hierarchy-check" aria-hidden="true">${on?'✓':''}</span><span class="hierarchy-unit-copy"><strong>${escapeHtml(unit.name)}</strong><small>${escapeHtml(unit.type)}</small></span>`;
  label.querySelector('input').addEventListener('change',e=>setOneSelection(category,unit.id,e.target.checked));
  return label;
}
function createLevelDetails({category,level,rows,selected,key,label=level,subgroups=null}){
  const details=document.createElement('details');details.className='selection-level';details.open=expandedSelectionSections.has(key);details.dataset.selectionCategory=category;details.dataset.selectionLevel=String(level);
  const levelColors=selectionLevelColors(category,level);
  details.style.setProperty('--level-base',levelColors.base);
  details.style.setProperty('--level-surface',levelColors.surface);
  details.style.setProperty('--level-surface-strong',levelColors.surfaceStrong);
  details.style.setProperty('--level-border',levelColors.border);
  details.style.setProperty('--level-text',levelColors.text);
  details.addEventListener('toggle',()=>details.open?expandedSelectionSections.add(key):expandedSelectionSections.delete(key));
  const summary=document.createElement('summary');
  const chosen=rows.filter(u=>selected.has(u.id)).length;
  summary.innerHTML=`<span class="level-chevron" aria-hidden="true"></span><label class="level-master"><input type="checkbox"><span>${escapeHtml(label)}</span></label><span class="level-selected-count">${chosen}/${rows.length}</span>`;
  const master=summary.querySelector('input');master.dataset.selectionMaster='level';master.dataset.selectionCategory=category;master.dataset.selectionLevel=String(level);checkboxState(master,rows,selected);
  summary.querySelector('.level-master').addEventListener('click',e=>e.stopPropagation());master.addEventListener('click',e=>e.stopPropagation());master.addEventListener('change',e=>setSelection(category,rows,e.target.checked));
  details.appendChild(summary);
  const body=document.createElement('div');body.className='selection-level-body';
  if(subgroups){
    for(const subgroup of subgroups){
      const sub=document.createElement('details');sub.className='selection-subgroup';const subKey=`${key}|${subgroup.name}`;sub.open=expandedSelectionSections.has(subKey);
      sub.addEventListener('toggle',()=>sub.open?expandedSelectionSections.add(subKey):expandedSelectionSections.delete(subKey));
      const ss=document.createElement('summary');const sc=subgroup.rows.filter(u=>selected.has(u.id)).length;
      ss.innerHTML=`<span class="subgroup-chevron" aria-hidden="true"></span><label class="subgroup-master"><input type="checkbox"><span>${escapeHtml(subgroup.label)}</span></label><span>${sc}/${subgroup.rows.length}</span>`;
      const sm=ss.querySelector('input');checkboxState(sm,subgroup.rows,selected);ss.querySelector('.subgroup-master').addEventListener('click',e=>e.stopPropagation());sm.addEventListener('click',e=>e.stopPropagation());sm.addEventListener('change',e=>setSelection(category,subgroup.rows,e.target.checked));
      sub.appendChild(ss);
      const grid=document.createElement('div');grid.className='hierarchy-unit-list';for(const unit of subgroup.rows)grid.appendChild(createUnitOption(category,unit,selected));sub.appendChild(grid);body.appendChild(sub);
    }
  }else{
    const grid=document.createElement('div');grid.className='hierarchy-unit-list';for(const unit of rows)grid.appendChild(createUnitOption(category,unit,selected));body.appendChild(grid);
  }
  details.appendChild(body);return details;
}
function renderTroopClass(className,targetId){
  const target=els[targetId],selected=selectedSet('troop');target.innerHTML='';
  const rows=units.troop.filter(u=>String(u.class).toUpperCase()===className);
  const map=new Map();for(const u of rows){if(!map.has(u.level))map.set(u.level,[]);map.get(u.level).push(u);}const levels=[...map.keys()].sort(troopLevelCompare);
  for(const level of levels){const group=map.get(level).sort((a,b)=>a.displayOrder-b.displayOrder);target.appendChild(createLevelDetails({category:'troop',level,rows:group,selected,key:`troop|${className}|${level}`}));}
}
function renderMonsters(){
  const target=els.monsterSelection,selected=selectedSet('monster');target.innerHTML='';
  for(const group of getLevelRows('monster'))target.appendChild(createLevelDetails({category:'monster',level:group.level,rows:group.rows.sort((a,b)=>a.displayOrder-b.displayOrder),selected,key:`monster|${group.level}`}));
}
function renderMercenaries(){
  const target=els.mercenarySelection,selected=selectedSet('mercenary');target.innerHTML='';
  const tiers=[...new Set(units.mercenary.map(u=>tierNumber(u.level)))].sort((a,b)=>{const o=[2,7,6,5];return o.indexOf(a)-o.indexOf(b);});
  for(const tier of tiers){
    const rows=units.mercenary.filter(u=>tierNumber(u.level)===tier).sort((a,b)=>a.displayOrder-b.displayOrder);
    const groups=[];for(const cls of MERC_GROUP_ORDER){const r=rows.filter(u=>String(u.class).toUpperCase()===cls);if(r.length)groups.push({name:cls,label:MERC_GROUP_LABEL[cls]||cls,rows:r});}
    const extras=[...new Set(rows.map(u=>String(u.class).toUpperCase()))].filter(c=>!MERC_GROUP_ORDER.includes(c));for(const cls of extras){const r=rows.filter(u=>String(u.class).toUpperCase()===cls);groups.push({name:cls,label:cls,rows:r});}
    target.appendChild(createLevelDetails({category:'mercenary',level:String(tier),label:MERC_LEVEL_LABEL[tier]||String(tier),rows,selected,key:`mercenary|${tier}`,subgroups:groups}));
  }
}
function setMaster(master,rows,category){const selected=selectedSet(category);checkboxState(master,rows,selected);master.onchange=e=>setSelection(category,rows,e.target.checked);}
function updateCounts(){
  const sel=modeState().selectedIds;const g=units.troop.filter(u=>u.class==='GUARDSMAN'),s=units.troop.filter(u=>u.class==='SPECIALIST'),e=units.troop.filter(u=>u.class==='ENGINEER');const troopSel=new Set(sel.troop);
  els.guardsmanCount.textContent=`${g.filter(u=>troopSel.has(u.id)).length} selected`;els.specialistCount.textContent=`${s.filter(u=>troopSel.has(u.id)).length} selected`;els.engineerCount.textContent=`${e.filter(u=>troopSel.has(u.id)).length} selected`;
  els.monsterCardCount.textContent=`${sel.monster.length} selected`;els.mercenaryCardCount.textContent=`${sel.mercenary.length} selected`;
  setMaster(els.guardsmanMaster,g,'troop');setMaster(els.specialistMaster,s,'troop');setMaster(els.engineerMaster,e,'troop');setMaster(els.monsterMaster,units.monster,'monster');setMaster(els.mercenaryMaster,units.mercenary,'mercenary');
}
function renderAllSelections(){renderTroopClass('GUARDSMAN','guardsmanSelection');renderTroopClass('SPECIALIST','specialistSelection');renderTroopClass('ENGINEER','engineerSelection');renderMonsters();renderMercenaries();updateCounts();}


function reconcileSelectionsFromRenderedUI(){
  if(!appInitialized)return false;
  const next={troop:new Set(),monster:new Set(),mercenary:new Set()};
  const seen={troop:false,monster:false,mercenary:false};

  // Mobile browsers may restore a collapsed level's master checkbox without
  // restoring the dynamically-created child checkboxes. A checked level
  // master therefore represents the whole level and takes precedence.
  document.querySelectorAll('.selection-level').forEach(details=>{
    const category=details.dataset.selectionCategory;
    const level=details.dataset.selectionLevel;
    if(!next[category]||!level)return;
    const master=details.querySelector(':scope > summary input[data-selection-master="level"]');
    if(!master)return;
    seen[category]=true;
    if(master.checked&&!master.indeterminate){
      // The rendered descendants are the authoritative members of this
      // selection group. Mercenary group labels use a Roman tier (for
      // example, "II" / tier 2), while individual mercenary levels include
      // a subtype (for example, "2-COM"). Comparing those level strings can
      // therefore erase a fully selected mercenary tier during reconciliation.
      details.querySelectorAll('.hierarchy-unit input[data-unit-id]').forEach(input=>{
        next[category].add(input.dataset.unitId);
      });
      return;
    }
    // Partial or unchecked levels use the leaf checkboxes that are available.
    details.querySelectorAll('.hierarchy-unit input[data-unit-id]').forEach(input=>{
      if(input.checked)next[category].add(input.dataset.unitId);
    });
  });

  let changed=false;
  for(const category of ['troop','monster','mercenary']){
    if(!seen[category])continue;
    const current=[...(modeState().selectedIds[category]||[])].sort();
    const restored=[...next[category]].sort();
    if(current.length!==restored.length||current.some((id,index)=>id!==restored[index])){
      modeState().selectedIds[category]=restored;
      changed=true;
    }
  }
  if(changed){
    syncCustomOrders();
    saveState();
    renderAllSelections();
    if(isCustomOrderMode())renderOrderView();
  }
  return changed;
}
function refreshAfterBrowserRestore(){
  if(!appInitialized)return;

  // A visibility/pageshow refresh must never cancel an active optimization.
  // recalculate() intentionally terminates the worker when inputs change, so
  // skip restore synchronization until the running job has completed.
  if(epicWorker){
    setOptimizeButtonState();
    return;
  }

  renderClanProfileLink();
  reconcileSelectionsFromRenderedUI();
  recalculate();
  setOptimizeButtonState();
}


function baseEngineInputs(){
  const i=modeState().inputs;
  const isPvp=activeMode==='battle'&&String(i.battleType||state.modes.battle.activeBattleType||'').startsWith('pvp_');
  const pvpHealth=isPvp?parseNumber(i.pvpHealth):0;
  const pvpStrength=isPvp?parseNumber(i.pvpStrength):0;
  return{
    leadership:parseNumber(i.leadership),leadershipFill:parseNumber(i.leadershipFill)/100,
    authority:parseNumber(i.authority),authorityFill:parseNumber(i.authorityFill)/100,
    dominance:parseNumber(i.dominance),dominanceFill:parseNumber(i.dominanceFill)/100,
    arachne:!!i.arachne,
    enemySquadTypes:i.enemySquadTypes,
    healthInputs:{
      MONSTER:parseNumber(i.monsterHealth)+pvpHealth,
      BEAST:parseNumber(i.beastHealth)+pvpHealth,
      DRAGON:parseNumber(i.dragonHealth)+pvpHealth,
      ELEMENTAL:parseNumber(i.elementalHealth)+pvpHealth,
      GIANT:parseNumber(i.giantHealth)+pvpHealth,
      GUARDSMAN:parseNumber(i.guardsmanHealth)+pvpHealth,
      SPECIALIST:parseNumber(i.specialistHealth)+pvpHealth,
      ENGINEER:parseNumber(i.engineerHealth)+pvpHealth,
      HUMAN:parseNumber(i.guardsmanHealth)+pvpHealth,
      EPIC_HUNTER:parseNumber(i.epicHunterHealth)+pvpHealth
    },
    monsterStrengthPct:parseNumber(i.monsterStrength)+pvpStrength,
    beastStrengthPct:parseNumber(i.beastStrength)+pvpStrength,dragonStrengthPct:parseNumber(i.dragonStrength)+pvpStrength,elementalStrengthPct:parseNumber(i.elementalStrength)+pvpStrength,giantStrengthPct:parseNumber(i.giantStrength)+pvpStrength,
    strengthAgainstEpicPct:parseNumber(i.strengthAgainstEpic),
    guardsmanStrengthPct:parseNumber(i.guardsmanStrength)+pvpStrength,
    specialistStrengthPct:parseNumber(i.specialistStrength)+pvpStrength,
    engineerStrengthPct:parseNumber(i.engineerStrength)+pvpStrength,
    humanStrengthPct:parseNumber(i.guardsmanStrength)+pvpStrength,
    epicHunterStrengthPct:parseNumber(i.epicHunterStrength)+pvpStrength,
    pvpHealthPct:pvpHealth,pvpStrengthPct:pvpStrength,
    monsterDDPct:parseNumber(i.monsterDD),beastDDPct:parseNumber(i.beastDD),dragonDDPct:parseNumber(i.dragonDD),elementalDDPct:parseNumber(i.elementalDD),giantDDPct:parseNumber(i.giantDD),guardsmanDDPct:parseNumber(i.guardsmanDD),specialistDDPct:parseNumber(i.specialistDD),engineerDDPct:parseNumber(i.engineerDD),humanDDPct:parseNumber(i.guardsmanDD),epicHunterDDPct:parseNumber(i.epicHunterDD),
    monsterSTPct:parseNumber(i.monsterST),beastSTPct:parseNumber(i.beastST),dragonSTPct:parseNumber(i.dragonST),elementalSTPct:parseNumber(i.elementalST),giantSTPct:parseNumber(i.giantST),guardsmanSTPct:parseNumber(i.guardsmanST),specialistSTPct:parseNumber(i.specialistST),engineerSTPct:parseNumber(i.engineerST),humanSTPct:parseNumber(i.guardsmanST),epicHunterSTPct:parseNumber(i.epicHunterST),
    templeLevel:templeLevel(),templeRevivalDivisor:templeRevivalDivisor(),
    enemyUnitId:i.enemyUnitId||'troop-g9-flying-corax-2',
    minimumSeparation:!!i.minimumSeparation,
    rankSeparation:parseNumber(i.rankSeparation)/100,layerSeparation:parseNumber(i.rankSeparation)/100
  };
}
function categoryProbe(category,fill,inputs){
  const meta=CAPACITY_META[category],probeInputs={...inputs,[meta.fill]:fill,_skipHardCapacity:true};
  const battleType=activeMode==='battle'?String(state.modes.battle.activeBattleType||''):'';
  if(battleType.startsWith('pvp_')){
    let result;
    if(isCustomOrderMode()){
      syncCustomOrders();
      result=battleType==='pvp_unknown'
        ?calculatePvpUnknownCustomStack({troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,selectedIds:modeState().selectedIds,orders:currentBattleWorkspace().orders,unitOrders:currentBattleWorkspace().methods.custom.unitOrders,squadOrders:currentBattleWorkspace().methods.custom.squadOrder,inputs:probeInputs})
        :calculatePvpCustomStack({troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,selectedIds:modeState().selectedIds,orders:currentBattleWorkspace().orders,unitOrders:currentBattleWorkspace().methods.custom.unitOrders,squadOrders:currentBattleWorkspace().methods.custom.squadOrder,inputs:probeInputs,enemy:selectedPvpEnemy(),battleType:'pvp_single_cp'});
    }else{
      result=battleType==='pvp_unknown'
        ?calculatePvpUnknownStack({troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,selectedIds:modeState().selectedIds,inputs:probeInputs})
        :calculatePvpCpStack({troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,selectedIds:modeState().selectedIds,inputs:probeInputs,enemy:selectedPvpEnemy(),battleType:'pvp_single_cp'});
    }
    return result.categories[category];
  }
  if(isCustomOrderMode()){
    syncCustomOrders();
    return calculateCustomCategory({
      category,units:units[category],selectedIds:selectedIdsFor(category),
      inputs:probeInputs,order:activeOrderState().orders[category],
      unitOrder:activeOrderState().squadOrder?.[category]?.length
        ? activeOrderState().squadOrder[category]
        : (activeOrderState().orders[category]||[]).flatMap(level=>activeOrderState().unitOrders?.[category]?.[level]||[])
    });
  }
  return calculateCategory({category,units:units[category],selectedIds:selectedIdsFor(category),inputs:probeInputs});
}
function findMaxSafeFill(category,inputs){const meta=CAPACITY_META[category],limit=inputs[meta.limit];if(!modeState().selectedIds[category].length||!(limit>0))return 1;const full=categoryProbe(category,1,inputs);if(full.totalCapacity<=limit)return 1;let low=0,high=1;for(let i=0;i<24;i++){const mid=(low+high)/2;const r=categoryProbe(category,mid,inputs);if(r.totalCapacity<=limit)low=mid;else high=mid;if(high-low<1e-7)break;}return low;}
function resolveAutoFills(inputs){
  for(const [cat,meta] of Object.entries(CAPACITY_META)){
    if(modeState().inputs[meta.auto]){
      const fixedMercenaryGroup=isAnyEpicOptimizeMode()&&cat==='mercenary'&&!modeState().inputs.includeMercenariesInOptimization;
      if(activeMode==='optimizer'&&!fixedMercenaryGroup){
        resolvedFills[cat]=1;
        inputs[meta.fill]=1;
        els[meta.fill].value='100.00';
      }else{
        resolvedFills[cat]=findMaxSafeFill(cat,inputs);
        inputs[meta.fill]=resolvedFills[cat];
        els[meta.fill].value=(resolvedFills[cat]*100).toFixed(2);
      }
    }else resolvedFills[cat]=inputs[meta.fill];
  }
  return inputs;
}
function validate(){
  const errors=[],hasAny=Object.values(modeState().selectedIds).some(a=>a.length);
  if(!hasAny)return errors;
  const inp=baseEngineInputs();

  {
    if(parseNumber(modeState().inputs.monsterHealth)<0)errors.push('Enter Monster Health.');
    for(const [key,label] of [['monsterStrength','Monster Strength'],['strengthAgainstEpic','Strength PvE']]){
      if(parseNumber(modeState().inputs[key])<0)errors.push(`${label} cannot be negative.`);
    }
    for(const [key,label] of [['monsterDD','Monster Double Damage'],['monsterST','Monster Strike Twice']]){
      const v=parseNumber(modeState().inputs[key]);if(v<0||v>100)errors.push(`${label} must be between 0% and 100%.`);
    }
    for(const {key} of BONUS_PROFILE_ROWS){
      for(const stat of ['Health','Strength'])if(parseNumber(modeState().inputs[`${key}${stat}`])<0)errors.push(`${key==='epicHunter'?'Epic Hunter':key[0].toUpperCase()+key.slice(1)} ${stat} cannot be negative.`);
      for(const stat of ['DD','ST']){const v=parseNumber(modeState().inputs[`${key}${stat}`]);if(v<0||v>100)errors.push(`${key==='epicHunter'?'Epic Hunter':key[0].toUpperCase()+key.slice(1)} ${stat==='DD'?'Double Damage':'Strike Twice'} must be between 0% and 100%.`);}
    }
  }
  if(activeMode!=='optimizer'){
    if(!(inp.healthInputs.MONSTER>0))errors.push('Enter Monster Health.');
    if(!(inp.healthInputs.GUARDSMAN>0))errors.push('Enter Guardsman Health.');
    if(!(inp.healthInputs.SPECIALIST>0))errors.push('Enter Specialist Health.');
    if(!(inp.healthInputs.ENGINEER>0))errors.push('Enter Engineer Health.');
    if(!(inp.healthInputs.EPIC_HUNTER>0))errors.push('Enter Epic Hunter Health.');
    if(!modeState().inputs.minimumSeparation){const sep=parseNumber(modeState().inputs.rankSeparation),maxSep=1;if(sep<0||sep>maxSep)errors.push(`Squad separation must be between 0% and ${maxSep.toFixed(2)}%.`);}
  }

  if(modeState().selectedIds.troop.length&&!(inp.leadership>0))errors.push('Enter Leadership for selected Troops.');
  if(modeState().selectedIds.monster.length&&!(inp.dominance>0))errors.push('Enter Dominance for selected Monsters.');
  if(modeState().selectedIds.mercenary.length&&!(inp.authority>0))errors.push('Enter Authority for selected Mercenaries.');

  for(const [cat,meta] of Object.entries(CAPACITY_META)){
    if(!modeState().inputs[meta.auto]){
      const v=parseNumber(modeState().inputs[meta.fill]);
      if(v<0||v>100)errors.push(`${meta.fill.replace('Fill','')} fill must be between 0% and 100%.`);
    }
  }
  return errors;
}
function showValidation(errors){if(!errors.length){els.validationBox.classList.remove('show');els.validationBox.innerHTML='';return;}els.validationBox.innerHTML=`<strong>Check these inputs:</strong><br>${errors.map(escapeHtml).join('<br>')}`;els.validationBox.classList.add('show');}
function clearResults(message='Enter your values and select units.'){clearClassicBattleDetails();els.resultEmpty.hidden=false;els.resultGroups.hidden=true;els.resultStatus.classList.remove('optimizing-status');els.resultStatus.textContent=message;clearPrediction();for(const id of ['troopResults','monsterResults','mercenaryResults'])els[id].innerHTML='';updateCapacity(null);clearLayerChart();}

function clearClassicBattleDetails(){
  if(els.classicBattleDetails)els.classicBattleDetails.hidden=true;
  if(els.classicBattleRows)els.classicBattleRows.innerHTML='';
  if(els.classicBattleMeta)els.classicBattleMeta.textContent='';
  clearPvpCpDetails();
}
function renderClassicBattleDetails(result){
  if(activeMode==='optimizer'||!els.classicBattleDetails||(activeMode==='battle'&&String(state.modes.battle.activeBattleType||'').startsWith('pvp_'))){clearClassicBattleDetails();return;}
  const rows=[
    ...(result?.categories?.troop?.results??[]),
    ...(result?.categories?.monster?.results??[]),
    ...(result?.categories?.mercenary?.results??[])
  ];
  if(!rows.length){clearClassicBattleDetails();return;}

  const deathRows=[...rows].sort((a,b)=>
    Number(b.squadHealth||0)-Number(a.squadHealth||0) ||
    Number(a.displayOrder||0)-Number(b.displayOrder||0)
  );
  const deathMap=new Map(deathRows.map((r,i)=>[r.id,i+1]));

  const attackRows=[...rows].sort((a,b)=>
    Number(b.squadStrength||0)-Number(a.squadStrength||0) ||
    Number(a.displayOrder||0)-Number(b.displayOrder||0)
  );
  const attackMap=new Map(attackRows.map((r,i)=>[r.id,i+1]));

  els.classicBattleRows.innerHTML=deathRows.map(r=>`<tr>
    <td>${escapeHtml(r.level)} · ${escapeHtml(r.name)}</td>
    <td>${formatInteger(r.qty)}</td>
    <td>${deathMap.get(r.id)??'—'}</td>
    <td>${Number(r.squadStrength)>0?(attackMap.get(r.id)??'—'):'—'}</td>
    <td>${compactHealth(r.squadHealth)}</td>
    <td>${formatInteger(r.totalCapacity??0)}</td>
  </tr>`).join('');

  const battleCustom=activeMode==='battle'&&state.modes.battle.activeBattleMethod==='custom';
  els.classicBattleMeta.textContent=(activeMode==='epic'||(activeMode==='battle'&&!battleCustom))
    ?'Predicted death order is based on calculated squad health. Attack order is ranked by nominal squad strength.'
    :'Predicted global death order is based on the calculated health produced by your Custom Die Order. Attack order is ranked by nominal squad strength.';
  els.classicBattleDetails.hidden=false;
}

function renderResultRows(category,rows){
  const target=els[`${category}Results`];
  target.innerHTML='';
  if(!rows.length){
    target.innerHTML='<div class="result-empty compact-result-empty">None selected.</div>';
    return;
  }
  for(const row of rows){
    const div=document.createElement('div');
    div.className='result-row compact-result-row';
    const resultColors=outputRowColors(category,row);
    div.style.setProperty('--result-text',resultTextColor(category,row));
    div.style.setProperty('--result-bg',resultColors.rowColor);
    div.style.setProperty('--result-bg-soft',resultColors.soft);
    div.style.setProperty('--result-accent',resultColors.accent);
    const unit=armyV2.find(candidate=>candidate.id===row.id),icon=row.icon||unit?.icon||'assets/unit-icons/missing-icon.svg';
    div.innerHTML=`<div class="result-label"><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.level)} · ${escapeHtml(row.type)}</span></div><img class="result-unit-icon" src="${escapeHtml(icon)}" alt="" aria-hidden="true" loading="lazy"><div class="result-qty">${formatInteger(row.qty)}</div>`;
    iconFallback(div.querySelector('.result-unit-icon'));
    target.appendChild(div);
  }
}
const CHART_SERIES={
  troop:{label:'Troops',color:'#e9edf2'},
  monster:{label:'Monsters',color:'#4e91e6'},
  mercenary:{label:'Mercs',color:'#d34c3f'}
};

function compactHealth(value){
  const n=Number(value)||0;
  if(n>=1e9)return`${(n/1e9).toFixed(n>=1e10?1:2)}B`;
  if(n>=1e6)return`${(n/1e6).toFixed(n>=1e8?1:2)}M`;
  if(n>=1e3)return`${(n/1e3).toFixed(n>=1e5?0:1)}K`;
  return Math.round(n).toLocaleString('en-US');
}

function niceHealthAxisStep(maxValue,targetIntervals=5){
  const rough=Math.max(Number(maxValue)||1,1)/Math.max(targetIntervals,1);
  const magnitude=10**Math.floor(Math.log10(rough));
  const normalized=rough/magnitude;
  const factor=normalized<=1?1:normalized<=2?2:normalized<=5?5:10;
  return factor*magnitude;
}

function compactAxisHealth(value){
  return compactHealth(value).replace(/\.0+(?=[KMB]$)/,'');
}

function chartUnitLabel(category,row){
  if(category==='mercenary'){
    const roman=['','I','II','III','IV','V','VI','VII','VIII','IX'][tierNumber(row.level)]||row.level;
    if(chartStyle()==='separated'){
      const canonical=armyV2.find(unit=>unit.id===row.id),suffix=String(canonical?.tier||'').split('-')[1];
      if(suffix)return`${roman}-${suffix}`;
    }
    return roman;
  }
  return row.level;
}

function clearLayerChart(){
  if(els.layerHealthChart)els.layerHealthChart.innerHTML='';
  if(els.layerChartScroll)els.layerChartScroll.hidden=true;
  if(els.layerChartEmpty)els.layerChartEmpty.hidden=false;
  if(els.layerChartTooltip)els.layerChartTooltip.hidden=true;
}

function svgEl(name,attrs={}){
  const el=document.createElementNS('http://www.w3.org/2000/svg',name);
  for(const [key,val] of Object.entries(attrs))el.setAttribute(key,String(val));
  return el;
}

function renderLayerHealthChart(result){
  lastLayerChartResult=result;
  const source={
    troop:[...(result?.categories?.troop?.results??[])],
    monster:[...(result?.categories?.monster?.results??[])],
    mercenary:[...(result?.categories?.mercenary?.results??[])]
  };
  const all=[...source.troop,...source.monster,...source.mercenary];
  if(!all.length){clearLayerChart();return;}

  for(const key of Object.keys(source)){
    source[key].sort((a,b)=>b.squadHealth-a.squadHealth||a.displayOrder-b.displayOrder);
  }

  els.layerChartEmpty.hidden=true;
  els.layerChartScroll.hidden=false;

  const svg=els.layerHealthChart;
  svg.innerHTML='';
  const width=900;
  const height=480;
  const margin={top:38,right:24,bottom:58,left:70};
  const plotW=width-margin.left-margin.right;
  const plotH=height-margin.top-margin.bottom;
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio','none');

  const vals=all.map(r=>r.squadHealth).filter(Number.isFinite);
  const min=0,rawMax=Math.max(...vals);
  const healthStep=niceHealthAxisStep(rawMax);
  const max=Math.max(healthStep,Math.ceil(rawMax/healthStep)*healthStep);

  const y=v=>margin.top+(max-v)/(max-min)*plotH;
  const x=(i,count)=>{
    if(count<=1)return margin.left+plotW*.5;
    return margin.left+(i/(count-1))*plotW;
  };

  const deathValue=row=>{
    const explicit=Number(row.predictedDeathPosition);
    if(Number.isFinite(explicit))return explicit;
    const index=Number(row.predictedDeathIndex);
    return Number.isFinite(index)?index+1:Infinity;
  };
  const combinedOrder=all.slice().sort((a,b)=>deathValue(a)-deathValue(b)||b.squadHealth-a.squadHealth||a.displayOrder-b.displayOrder);
  const deathPosition=new Map(combinedOrder.map((row,index)=>[row,index]));

  // Rounded health intervals create one clean, predictable horizontal grid.
  for(let value=0;value<=max+healthStep*.001;value+=healthStep){
    const yy=y(value);
    if(value>0)svg.appendChild(svgEl('line',{x1:margin.left,x2:margin.left+plotW,y1:yy,y2:yy,class:'chart-grid-line'}));
    const label=svgEl('text',{x:margin.left-10,y:yy+4,'text-anchor':'end',class:'chart-axis-label'});
    label.textContent=compactAxisHealth(value);
    svg.appendChild(label);
  }
  const baselineY=y(0);
  const horizontalCount=chartStyle()==='separated'?Math.max(...Object.values(source).map(rows=>rows.length)):combinedOrder.length;
  for(let death=5;chartStyle()==='combined'&&death<=horizontalCount;death+=5){
    const xx=x(death-1,horizontalCount);
    svg.appendChild(svgEl('line',{x1:xx,x2:xx,y1:margin.top,y2:baselineY,class:'chart-grid-line chart-grid-line-vertical'}));
    const label=svgEl('text',{x:xx,y:baselineY+19,'text-anchor':'middle',class:'chart-axis-label'});
    label.textContent=String(death);
    svg.appendChild(label);
  }
  svg.appendChild(svgEl('line',{x1:margin.left,x2:margin.left,y1:margin.top,y2:baselineY,class:'chart-axis-line'}));
  svg.appendChild(svgEl('line',{x1:margin.left,x2:margin.left+plotW,y1:baselineY,y2:baselineY,class:'chart-axis-line'}));
  const yTitle=svgEl('text',{x:15,y:height/2,transform:`rotate(-90 15 ${height/2})`,'text-anchor':'middle',class:'chart-y-title'});
  yTitle.textContent='Squad Health';
  svg.appendChild(yTitle);
  const xTitle=svgEl('text',{x:margin.left+plotW/2,y:height-13,'text-anchor':'middle',class:'chart-y-title'});
  xTitle.textContent=chartStyle()==='separated'?'Position Within Army Type →':'Death Order →';
  svg.appendChild(xTitle);

  for(const [category,rows] of Object.entries(source)){
    if(!rows.length)continue;
    const meta=CHART_SERIES[category];
    const points=rows.map((row,index)=>({row,x:x(chartStyle()==='separated'?index:deathPosition.get(row),chartStyle()==='separated'?rows.length:combinedOrder.length),y:y(row.squadHealth)})).sort((a,b)=>a.x-b.x);
    const path=svgEl('polyline',{
      points:points.map(p=>`${p.x},${p.y}`).join(' '),
      class:'chart-series-line',
      stroke:meta.color
    });
    svg.appendChild(path);

    points.forEach(p=>{
      const g=svgEl('g');
      const pointColor=outputRowColors(category,p.row).accent;
      const c=svgEl('circle',{cx:p.x,cy:p.y,r:5.3,fill:pointColor,class:'chart-point',tabindex:'0'});
      const label=svgEl('text',{
        x:p.x,
        y:Math.max(14,p.y-11),
        fill:pointColor,
        class:'chart-point-label'
      });
      label.textContent=chartUnitLabel(category,p.row);
      g.appendChild(c);
      g.appendChild(label);
      svg.appendChild(g);

      const showTip=(evt)=>{
        const tip=els.layerChartTooltip;
        const positionText=chartStyle()==='separated'?`Position in ${meta.label}: ${rows.indexOf(p.row)+1} of ${rows.length}`:`Death Order: ${deathPosition.get(p.row)+1} of ${combinedOrder.length}`;
        tip.innerHTML=`<img src="${escapeHtml(p.row.icon)}" alt=""><div class="tooltip-copy"><strong>${escapeHtml(p.row.level)} · ${escapeHtml(p.row.type)}</strong><span>${escapeHtml(p.row.name)}</span><span>Quantity: ${formatInteger(p.row.qty)}</span><span>Squad Health: ${Math.round(p.row.squadHealth).toLocaleString('en-US')}</span><span>${positionText}</span></div>`;
        iconFallback(tip.querySelector('img'));
        tip.hidden=false;
        const wrap=svg.parentElement.getBoundingClientRect();
        const rect=evt.currentTarget.getBoundingClientRect();
        let left=rect.left-wrap.left+12;
        let top=rect.top-wrap.top-10;
        if(left+235>wrap.width)left=Math.max(5,rect.left-wrap.left-230);
        tip.style.left=`${left}px`;
        tip.style.top=`${Math.max(5,top)}px`;
      };
      let tipTimer=null;
      const hideTip=()=>{
        if(tipTimer){clearTimeout(tipTimer);tipTimer=null;}
        els.layerChartTooltip.hidden=true;
      };
      c.addEventListener('mouseenter',showTip);
      c.addEventListener('mouseleave',hideTip);
      c.addEventListener('pointerleave',hideTip);
      c.addEventListener('pointercancel',hideTip);
      c.addEventListener('focus',showTip);
      c.addEventListener('blur',hideTip);

      if(window.matchMedia('(hover: none), (pointer: coarse)').matches){
        c.addEventListener('click',evt=>{
          showTip(evt);
          if(tipTimer)clearTimeout(tipTimer);
          tipTimer=setTimeout(hideTip,2500);
        });
      }
    });
  }
  const wrap=svg.parentElement;
  if(!wrap.dataset.tooltipLeaveBound){
    const dismissTip=()=>{els.layerChartTooltip.hidden=true;};
    wrap.addEventListener('mouseleave',dismissTip);
    wrap.addEventListener('pointerleave',dismissTip);
    wrap.addEventListener('pointercancel',dismissTip);
    document.addEventListener('pointerdown',evt=>{
      if(!evt.target.closest('.chart-point')) dismissTip();
    });
    wrap.dataset.tooltipLeaveBound='1';
  }
}
function syncAutoFillDisplayToActual(result){
  // Max Fill is a user-facing capacity result, so show the actual achieved
  // utilization after whole-unit rounding for every calculation method. This
  // only updates the disabled display; the saved manual fill and optimizer
  // capacity ceiling remain unchanged.
  if(!result)return;
  const map={
    troop:{fieldId:'leadershipFill',total:'leadership',limit:'leadership'},
    mercenary:{fieldId:'authorityFill',total:'authority',limit:'authority'},
    monster:{fieldId:'dominanceFill',total:'dominance',limit:'dominance'}
  };
  for(const [category,{fieldId,total,limit}] of Object.entries(map)){
    const meta=CAPACITY_META[category];
    if(!modeState().inputs[meta.auto])continue;
    const categoryPct=Number(result?.categories?.[category]?.capacityPercent);
    const maximum=parseNumber(modeState().inputs[limit]);
    const actual=Number(result?.totals?.[total]);
    const pct=Number.isFinite(categoryPct)
      ?categoryPct
      :maximum>0&&Number.isFinite(actual)?actual/maximum:NaN;
    if(Number.isFinite(pct)&&els[fieldId])els[fieldId].value=(pct*100).toFixed(2);
  }
}
function updateCapacity(result){for(const [name,actual,limit] of [['leadership',result?.totals.leadership,parseNumber(modeState().inputs.leadership)],['authority',result?.totals.authority,parseNumber(modeState().inputs.authority)],['dominance',result?.totals.dominance,parseNumber(modeState().inputs.dominance)]]){const bar=els[`${name}Bar`],fill=bar.querySelector('i'),pct=limit>0&&Number.isFinite(actual)?actual/limit:0;fill.style.width=`${Math.min(Math.max(pct*100,0),100)}%`;bar.classList.toggle('over',pct>1);els[`${name}Actual`].textContent=actual==null?'—':`${formatInteger(actual)} / ${limit?formatInteger(limit):'—'}${limit?` · ${(pct*100).toFixed(2)}%`:''}`;}}

function clearPvpCpDetails(){
  if(els.pvpCpDetailsPanel)els.pvpCpDetailsPanel.hidden=true;
  if(els.pvpCpDetailsRows)els.pvpCpDetailsRows.innerHTML='';
}
function compactNumber(value){
  const n=Number(value||0);
  return new Intl.NumberFormat('en-US',{notation:'compact',minimumFractionDigits:3,maximumFractionDigits:3}).format(n);
}
function renderPvpCpDetails(result){
  if(!els.pvpEnemySummaryLabel)els.pvpEnemySummaryLabel=document.getElementById('pvpEnemySummaryLabel');
  if(!els.pvpCpDetailsPanel||!els.pvpCpDetailsRows)return;
  const battleType=state.modes.battle.activeBattleType;
  if(activeMode!=='battle'||!['pvp_single_cp','pvp_unknown'].includes(battleType)||!result?.pvpCp){
    clearPvpCpDetails();return;
  }

  const enemy=result.enemy;
  const unknown=battleType==='pvp_unknown';
  els.pvpCpDetailsPanel.hidden=false;
  if(els.pvpCpLifetimeDamage)els.pvpCpLifetimeDamage.textContent=compactNumber(result.projectedLifetimeDamage);
  if(els.pvpEnemySummaryLabel)els.pvpEnemySummaryLabel.textContent=unknown?'Enemy Model':'Selected Enemy';
  els.pvpCpEnemyName.textContent=unknown
    ?`Unknown enemy squads · ${Number(enemy?.archetypes?.length||0)} target archetypes`
    :(enemy?`${enemy.level} · ${enemy.name} · ${enemy.type}`:'Selected enemy');
  els.pvpCpDetailsMeta.textContent=unknown
    ?`Projected Lifetime Damage is a comparison metric that assumes every friendly squad receives its predicted attack opportunities. Unknown-enemy damage gives equal weight to each supported combat-type and species archetype. Flying, Mounted, Melee, and Ranged bonuses can stack with Human, Beast, Dragon, Giant, or Elemental bonuses when both apply. Revival costs use 90% of each attacking squad, rounded down to whole units, then apply Temple Level ${templeLevel()} (${templeRevivalDivisor().toFixed(2)}× divisor). Standard treats Gold costs within 5% as economically equivalent, preserves stronger average PvP damage, and uses Silver as a deterministic tie-breaker.`
    :`Projected Lifetime Damage uses the shared two-initiative event simulation against one enemy squad and assumes that squad survives long enough to defeat every friendly squad. Revival costs use 90% of each attacking squad, rounded down to whole units, then apply Temple Level ${templeLevel()} (${templeRevivalDivisor().toFixed(2)}× divisor). Expected Damage includes applicable matchup bonuses, Specialist 2× PvP strength, Double Damage, and Strike Twice. Standard treats Gold costs within 5% as economically equivalent, preserves stronger PvP damage, and uses Silver as a deterministic tie-breaker.`;

  const rows=[
    ...result.categories.troop.results,
    ...result.categories.monster.results,
    ...result.categories.mercenary.results
  ].slice().sort((a,b)=>(a.predictedDeathIndex??999)-(b.predictedDeathIndex??999)||a.displayOrder-b.displayOrder);
  const actualFullGold=Number(result.actualAttritionGold??rows.reduce((sum,row)=>sum+Number(row.actualGoldRevivalCost||0),0));
  const actualFullSilver=Number(result.actualAttritionSilver??rows.reduce((sum,row)=>sum+Number(row.actualSilverRevivalCost||0),0));
  if(els.pvpCpFullGold)els.pvpCpFullGold.textContent=Math.round(actualFullGold).toLocaleString('en-US');
  if(els.pvpCpFullSilver)els.pvpCpFullSilver.textContent=Math.round(actualFullSilver).toLocaleString('en-US');

  const reasonFor=r=>{
    const parts=[];
    if(r.specialistPvpMultiplier===2)parts.push('2× Specialist');
    if(Number(r.pvpMatchupBonus||0)>0)parts.push(`${unknown?'Avg matchup':'Matchup'} +${Math.round(Number(r.pvpMatchupBonus||0)*100)}%`);
    return parts.length?parts.join(' · '):'Lower-cost exposure';
  };

  els.pvpCpDetailsRows.innerHTML=rows.map(r=>`<tr>
      <td>${escapeHtml(`${r.level} · ${r.name}`)}</td>
      <td>${Number(r.qty||0).toLocaleString('en-US')}</td>
      <td>${(r.predictedDeathIndex??0)+1}</td>
      <td>${Math.round(Number(r.actualGoldRevivalCost||0)).toLocaleString('en-US')}</td>
      <td>${Math.round(Number(r.actualSilverRevivalCost||0)).toLocaleString('en-US')}</td>
      <td>${compactNumber(r.expectedPvpDamage)}</td>
      <td>${escapeHtml(reasonFor(r))}</td>
    </tr>`).join('');
}
function clearLiveDamageMetrics(){
 document.querySelectorAll('.live-damage-slot').forEach(x=>x.innerHTML='');
 const floating=els.customOrderFloatingMetric||document.getElementById('customOrderFloatingMetric');
 if(floating)floating.hidden=true;
}
const liveDamagePrevious=new Map();
function liveDamageKey(){return activeMode==='battle'?`${state.modes.battle.activeBattleType}|${state.modes.battle.activeBattleMethod}`:activeMode;}
function updateLiveDamageMetric(value,isPvp,allowOptimize=false){
 const slots=document.querySelectorAll('.live-damage-slot'),method=activeMode==='battle'?state.modes.battle.activeBattleMethod:'';
 if((method==='optimize'&&!allowOptimize)||!Number.isFinite(Number(value))||Number(value)<=0){clearLiveDamageMetrics();return;}
 const key=liveDamageKey(),n=Number(value);
 liveDamagePrevious.set(key,n);const label=isPvp?'PLD':'ELD',markup=`<span class="live-damage-label">${label}</span><strong>${isPvp?compactNumber(n):formatDamage(n)}</strong>`;slots.forEach(x=>x.innerHTML=markup);
}
function recalculate(){
  readInputs();
  syncDerivedEpicBonuses();
  readInputs();

  const any=Object.values(modeState().selectedIds).some(a=>a.length);

  if(isAnyEpicOptimizeMode()){
    clearLiveDamageMetrics();
    if(epicWorker){epicWorker.terminate();epicWorker=null;closeOptimizerModal();}
    const errors=any?validate():[];showValidation(errors);const sig=!errors.length&&any?currentEpicEffectiveSignature():'';
    if(lastOptimizedEpicPayload&&lastOptimizedEpicSignature&&sig===lastOptimizedEpicSignature){epicResultCurrent=true;renderEpicOptimizedResult(lastOptimizedEpicPayload);setOptimizeButtonState();return;}
    epicResultCurrent=false;
    const emptyMessage=any&&!errors.length
      ?'Click Optimize Army to calculate quantities.'
      :!any
        ?'Select units to build your stack.'
        :'Complete the required inputs.';
    clearResults(emptyMessage);
    els.resultStatus.textContent=!any
      ?'Select units to build your stack.'
      :errors.length
        ?'Complete the required inputs.'
        :'Ready to optimize.';
    setOptimizeButtonState();
    return;
  }

  if(!any){showValidation([]);document.querySelectorAll('.live-damage-slot').forEach(x=>x.innerHTML='');clearResults('Select units to build your stack.');return;}
  const errors=validate();showValidation(errors);
  if(errors.length){document.querySelectorAll('.live-damage-slot').forEach(x=>x.innerHTML='');clearResults('Complete the required inputs.');return;}
  cancelEpicOptimization();

  try{
    const inputs=resolveAutoFills(baseEngineInputs());
    let result;

    if(activeMode==='epic'){result=calculateEpicStack({troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,selectedIds:modeState().selectedIds,inputs});}
    else if(activeMode==='battle'){
      const battleType=state.modes.battle.activeBattleType||'epic_standard';
      const method=state.modes.battle.activeBattleMethod||'custom';
      if(method==='custom'){
        syncCustomOrders();
        if(battleType==='epic'&&untouchedEpicCustomOrderMatchesStandard()){
          // An untouched Custom Order is the Standard plan. Reuse the Standard
          // result so quantities, strict-health legalization, and ELD are exact.
          result=calculateEpicStack({
            troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,
            selectedIds:modeState().selectedIds,inputs
          });
        }else if(battleType==='pvp_single_cp'){
          result=calculatePvpCustomStack({
            troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,
            selectedIds:modeState().selectedIds,orders:currentBattleWorkspace().orders,unitOrders:currentBattleWorkspace().methods.custom.unitOrders,squadOrders:currentBattleWorkspace().methods.custom.squadOrder,inputs,enemy:selectedPvpEnemy()
          });
        }else if(battleType==='pvp_unknown'){
          result=calculatePvpUnknownCustomStack({
            troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,
            selectedIds:modeState().selectedIds,orders:currentBattleWorkspace().orders,unitOrders:currentBattleWorkspace().methods.custom.unitOrders,squadOrders:currentBattleWorkspace().methods.custom.squadOrder,inputs
          });
        }else{
          result=calculateCustomStack({
            troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,
            selectedIds:modeState().selectedIds,orders:currentBattleWorkspace().orders,unitOrders:currentBattleWorkspace().methods.custom.unitOrders,squadOrders:currentBattleWorkspace().methods.custom.squadOrder,inputs
          });
        }
      }else if(battleType==='pvp_single_cp'){
        result=calculatePvpCpStack({
          troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,
          selectedIds:modeState().selectedIds,inputs,enemy:selectedPvpEnemy()
        });
      }else if(battleType==='pvp_unknown'){
        result=calculatePvpUnknownStack({
          troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,
          selectedIds:modeState().selectedIds,inputs
        });
      }else if(battleType==='epic'){
        result=calculateEpicStack({
          troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,
          selectedIds:modeState().selectedIds,inputs:{...inputs,arachne:!!modeState().inputs.arachne,enemySquadTypes:modeState().inputs.enemySquadTypes}
        });
      }else{
        result=calculateBattleStack({
          troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,
          selectedIds:modeState().selectedIds,inputs,battleType
        });
      }
    }
    else{syncCustomOrders();result=calculateCustomStack({troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,selectedIds:modeState().selectedIds,orders:state.modes.custom.orders,unitOrders:state.modes.custom.unitOrders,squadOrders:state.modes.custom.squadOrder,inputs});}

    renderResultRows('mercenary',result.categories.mercenary.results);
    renderResultRows('monster',result.categories.monster.results);
    renderResultRows('troop',result.categories.troop.results);
    updateCapacity(result);
    syncAutoFillDisplayToActual(result);
    const bt=activeMode==='battle'?state.modes.battle.activeBattleType:null;
    const canEpicScore=activeMode!=='battle'||bt==='epic';
    const scored=canEpicScore?scoreClassicResult(result):null;
    if(scored){
      renderLayerHealthChart(convertEpicV2Result(scored));
      renderPrediction(scored);
    }else{
      renderLayerHealthChart(result);
      clearPrediction();
    }
    renderClassicBattleDetails(result);
    renderPvpCpDetails(result);
    const liveIsPvp=activeMode==='battle'&&String(bt||'').startsWith('pvp_');
    updateLiveDamageMetric(liveIsPvp?Number(result.projectedLifetimeDamage||0):Number(scored?.result?.expectedTotalLifetimeDamage||0),liveIsPvp);

    const count=result.categories.troop.results.length+result.categories.monster.results.length+result.categories.mercenary.results.length;
    els.resultStatus.textContent=activeMode==='battle'?`${count} calculated squad${count===1?'':'s'} · Total Battle mobile entry order`:`${count} calculated squad${count===1?'':'s'} · mobile entry order`;
    els.resultEmpty.hidden=true;els.resultGroups.hidden=false;
  }catch(error){
    console.error(error);showValidation([error.message||'The calculator could not complete the stack.']);clearResults('Calculation error.');
  }
}
function resetCalculator(){
  if(!confirm(`Reset all ${activeMode==='epic'?'Epic Stacker':activeMode==='optimizer'?'Epic Optimizer':activeMode==='battle'?'Battle Calculator':'Custom Stacker'} inputs and selections on this device?`))return;
  if(activeMode==='battle'){
    clearSavedOptimizerResult();
    const type=state.modes.battle.activeBattleType||'epic_standard';
    state.modes.battle.workspaces[battleWorkspaceKey(type)]=makeBattleWorkspace(type);
    epicResultCurrent=false;
  }else{
    if(activeMode==='optimizer')clearSavedOptimizerResult();
    state.modes[activeMode].selectedIds={troop:[],monster:[],mercenary:[]};
    state.modes[activeMode].inputs=defaultInputs(activeMode);
    if(activeMode==='custom')state.modes.custom.orders={troop:[],monster:[],mercenary:[]};
  }
  saveState();applyStateToInputs();syncCustomOrders();renderAllSelections();if(isCustomOrderMode())renderOrderView();clearResults();
}
function refreshActiveMode({save=true}={}){
  configureModeUI();
  applyStateToInputs();
  syncCustomOrders();
  renderAllSelections();
  if(isCustomOrderMode())renderOrderView();
  syncDerivedEpicBonuses();
  readInputs();
  if(save)saveState();

  if(isAnyEpicOptimizeMode()){
    const sig=currentEpicEffectiveSignature();
    if(lastOptimizedEpicPayload&&lastOptimizedEpicSignature&&sig===lastOptimizedEpicSignature){
      epicResultCurrent=true;
      renderEpicOptimizedResult(lastOptimizedEpicPayload);
      setOptimizeButtonState();
      return;
    }
  }
  recalculate();
}
function switchMode(mode){
  if(mode===activeMode)return;
  cancelEpicOptimization();
  readInputs();saveState();
  activeMode=mode;
  if(activeMode==='battle')ensureBattleWorkspace();
  loadSavedOptimizerResult();
  refreshActiveMode();
}
function resetAdvancedSettings(){const defaults=defaultInputs(activeMode),i=modeState().inputs;for(const id of ['monsterHealth','pvpHealth','monsterStrength','strengthAgainstEpic','pvpStrength','monsterDD','monsterST'])i[id]=defaults[id];for(const {auto} of BONUS_INPUT_ROWS){i[auto]=true;if(els[auto])els[auto].checked=true;}i.useCustomFamilyBonuses=false;for(const id of ['monsterHealth','pvpHealth','monsterStrength','strengthAgainstEpic','pvpStrength','monsterDD','monsterST'])if(els[id])els[id].value=i[id];if(!isAnyEpicOptimizeMode()){i.rankSeparation=defaults.rankSeparation;els.rankSeparation.value=i.rankSeparation;updateRankSeparationDisplay();}syncDerivedEpicBonuses();saveState();recalculate();}
const STAT_HELP_BASE='assets/images/stat-help/';
const STAT_HELP={
  unitBonusProfiles:{title:'Unit bonus profiles',text:'Monsters and Humans provide simple shared rows. Expand Monsters only when Beasts, Dragons, Elementals, or Giants differ. Expand Humans only when Guardsmen, Specialists, or Engineers differ. Cursed, Demons, Elves, Undead, and Barbarians use Guardsman bonuses. Epic Hunters use their own row.',images:[]},
  bonusUnit:{title:'Choose the matching unit',text:'This Monster screenshot is an example. In a battle report, select a unit that matches the row you are editing. For example, select a Beast for the Beasts row, a Guardsman for the Guardsmen row, or an Epic Hunter for the Epic Hunters row. Then copy that unit’s bonuses into the matching fields.',images:[['monster-click.webp','Example: select a Monster in the battle report.']]},
  bonusDD:{title:'Double Damage',text:'Use a battle report for this encounter with the same captain(s) and/or Hero, armor, gems, enchantments, and artifacts. The screenshots show a Monster example: first select the unit that matches the row you are editing, then copy its Double Damage from the Bonuses section. Intrinsic unit Double Damage is added separately.',images:[['monster-click.webp','1. Select the matching unit (Monster example).'],['monster-dd.webp','2. Copy Double Damage.']]},
  bonusST:{title:'Strike Twice',text:'Use a battle report for this encounter with the same captain(s) and/or Hero, armor, gems, enchantments, and artifacts. The screenshots show a Monster example: first select the unit that matches the row you are editing, then copy its Strike Twice from the Bonuses section.',images:[['monster-click.webp','1. Select the matching unit (Monster example).'],['monster-st.webp','2. Copy Strike Twice.']]},
  bonusHealth:{title:'Health',text:'Use a battle report for this encounter with the same captain(s) and/or Hero, armor, gems, enchantments, and artifacts. The screenshots show a Monster example: first select the unit that matches the row you are editing, then copy its Health from the Bonuses section.',images:[['monster-click.webp','1. Select the matching unit (Monster example).'],['monster-health.webp','2. Copy Health.']]},
  bonusStrength:{title:'Strength',text:'Use a battle report for this encounter with the same captain(s) and/or Hero, armor, gems, enchantments, and artifacts. The screenshots show a Monster example: first select the unit that matches the row you are editing, then copy its Strength from the Bonuses section. Applicable global PvE or PvP strength is added separately.',images:[['monster-click.webp','1. Select the matching unit (Monster example).'],['monster-strength.webp','2. Copy Strength.']]},
  monsterHealth:{title:'Monster Health',text:'Open one of your Monster squads, then copy the Health percentage shown in the Bonuses section.',images:[['monster-click.webp','1. Open a Monster squad.'],['monster-health.webp','2. Copy the Health value.']]},
  humanHealth:{title:'Human Health',text:'Open one of your Human troops, then copy the Health percentage shown in the Bonuses section.',images:[['human-click.webp','1. Open a Human troop.'],['human-health.webp','2. Copy the Health value.']]},
  epicHunterHealth:{title:'Epic Hunter Health',text:'Open your Superior Epic Monster Hunter, then copy the Health percentage shown in the Bonuses section.',images:[['epic-hunter-click.webp','1. Open the Epic Hunter squad.'],['epic-hunter-health.webp','2. Copy the Health value.']]},
  monsterStrength:{title:'Monster Strength',text:'Open one of your Monster squads, then copy the Strength percentage shown in the Bonuses section.',images:[['monster-click.webp','1. Open a Monster squad.'],['monster-strength.webp','2. Copy the Strength value.']]},
  strengthAgainstEpic:{title:'Strength PvE',text:'Copy “Strength of your entire army against epic monsters.” It is an entire-army bonus, so the same value appears on Monster, Human, and Epic Hunter detail screens.',images:[['monster-epic-strength.webp','Monster example'],['human-epic-strength.webp','Human example'],['epic-hunter-epic-strength.webp','Epic Hunter example']]},
  pvpHealth:{title:'Health PvP',text:'Copy “Health in a battle against another player.” It is an entire-army bonus, so the same value appears on Monster, Human, and Epic Hunter detail screens.',images:[['monster-health-pvp.png','Monster example'],['human-health-pvp.png','Human example'],['epic-hunter-health-pvp.png','Epic Hunter example']]},
  pvpStrength:{title:'Strength PvP',text:'Copy “Strength in a battle against another player.” It is an entire-army bonus, so the same value appears on Monster, Human, and Epic Hunter detail screens.',images:[['monster-strength-pvp.png','Monster example'],['human-strength-pvp.png','Human example'],['epic-hunter-strength-pvp.png','Epic Hunter example']]},
  monsterDD:{title:'Monster Double Damage',text:'Open one of your Monster squads, then copy “Chance to deal double damage” from the Bonuses section.',images:[['monster-click.webp','1. Open a Monster squad.'],['monster-dd.webp','2. Copy Double Damage.']]},
  monsterST:{title:'Monster Strike Twice',text:'Open one of your Monster squads, then copy “Chance to strike two squads” from the Bonuses section.',images:[['monster-click.webp','1. Open a Monster squad.'],['monster-st.webp','2. Copy Strike Twice.']]},
  humanStrength:{title:'Human Strength',text:'Open one of your Human troops, then copy the Strength percentage shown in the Bonuses section.',images:[['human-click.webp','1. Open a Human troop.'],['human-strength.webp','2. Copy the Strength value.']]},
  humanDD:{title:'Human Double Damage',text:'Open one of your Human troops, then copy “Chance to deal double damage” from the Bonuses section.',images:[['human-click.webp','1. Open a Human troop.'],['human-dd.webp','2. Copy Double Damage.']]},
  humanST:{title:'Human Strike Twice',text:'Open one of your Human troops, then copy “Chance to strike two squads” from the Bonuses section.',images:[['human-click.webp','1. Open a Human troop.'],['human-st.webp','2. Copy Strike Twice.']]},
  epicHunterStrength:{title:'Epic Hunter Strength',text:'Open your Superior Epic Monster Hunter, then copy the Strength percentage shown in the Bonuses section.',images:[['epic-hunter-click.webp','1. Open the Epic Hunter squad.'],['epic-hunter-strength.webp','2. Copy the Strength value.']]},
  epicHunterDD:{title:'Epic Hunter Double Damage',text:'Open your Superior Epic Monster Hunter, then copy “Chance to deal double damage” from the Bonuses section.',images:[['epic-hunter-click.webp','1. Open the Epic Hunter squad.'],['epic-hunter-dd.webp','2. Copy Double Damage.']]},
  epicHunterST:{title:'Epic Hunter Strike Twice',text:'Open your Superior Epic Monster Hunter, then copy “Chance to strike two squads” from the Bonuses section.',images:[['epic-hunter-click.webp','1. Open the Epic Hunter squad.'],['epic-hunter-st.webp','2. Copy Strike Twice.']]}
};
let statHelpReturnFocus=null;
const STAT_HELP_GUIDE_SECTION={
  unitBonusProfiles:'bonuses',bonusUnit:'bonuses',bonusDD:'chance',bonusST:'chance',
  monsterDD:'chance',humanDD:'chance',epicHunterDD:'chance',monsterST:'chance',humanST:'chance',epicHunterST:'chance',
  bonusHealth:'health',monsterHealth:'health',humanHealth:'health',epicHunterHealth:'health',
  bonusStrength:'damage',monsterStrength:'damage',humanStrength:'damage',epicHunterStrength:'damage',strengthAgainstEpic:'damage'
};
function openStatHelp(key,trigger){
  const help=STAT_HELP[key],modal=document.getElementById('statHelpModal');if(!help||!modal)return;
  statHelpReturnFocus=trigger||document.activeElement;
  document.getElementById('statHelpTitle').textContent=help.title;
  document.getElementById('statHelpText').textContent=help.text;
  document.getElementById('statHelpGallery').innerHTML=help.images.map(([src,caption])=>`<figure class="stat-help-figure"><img alt="${escapeHtml(caption)}" loading="lazy" src="${STAT_HELP_BASE}${encodeURIComponent(src)}"/><figcaption>${escapeHtml(caption)}</figcaption></figure>`).join('');
  const guideLink=document.getElementById('statHelpGuideLink'),guideSection=STAT_HELP_GUIDE_SECTION[key];
  if(guideLink){guideLink.hidden=!guideSection;guideLink.dataset.battleGuide=guideSection||'';}
  modal.hidden=false;document.body.classList.add('stat-help-modal-open');
  requestAnimationFrame(()=>modal.querySelector('.stat-help-close')?.focus());
}
function closeStatHelp(){
  const modal=document.getElementById('statHelpModal');if(!modal||modal.hidden)return;
  modal.hidden=true;document.body.classList.remove('stat-help-modal-open');
  const target=statHelpReturnFocus;statHelpReturnFocus=null;if(target&&typeof target.focus==='function')target.focus();
}
let battleGuideReturnFocus=null;
function openBattleGuide(section='overview',trigger=null){
  const modal=document.getElementById('battleGuideModal');if(!modal)return;
  const returnTarget=!document.getElementById('statHelpModal')?.hidden&&statHelpReturnFocus?statHelpReturnFocus:(trigger||document.activeElement);
  if(!document.getElementById('statHelpModal')?.hidden)closeStatHelp();
  battleGuideReturnFocus=returnTarget;
  modal.hidden=false;document.body.classList.add('battle-guide-open');
  const panel=modal.querySelector(`[data-guide-panel="${section}"]`)||modal.querySelector('[data-guide-panel="overview"]');
  modal.querySelectorAll('[data-guide-panel]').forEach(item=>item.open=item===panel);
  if(panel)requestAnimationFrame(()=>panel.scrollIntoView({block:'start'}));
  modal.querySelectorAll('[data-battle-guide-section]').forEach(button=>button.setAttribute('aria-current',String(button.dataset.battleGuideSection===panel?.dataset.guidePanel)));
  requestAnimationFrame(()=>modal.querySelector('.battle-guide-close')?.focus());
}
function closeBattleGuide(){
  const modal=document.getElementById('battleGuideModal');if(!modal||modal.hidden)return;
  modal.hidden=true;document.body.classList.remove('battle-guide-open');
  const target=battleGuideReturnFocus;battleGuideReturnFocus=null;if(target&&typeof target.focus==='function')target.focus();
}
function wireStatHelp(){
  document.querySelectorAll('[data-chart-style]').forEach(button=>button.addEventListener('click',()=>setChartStyle(button.dataset.chartStyle)));
  document.querySelectorAll('[data-stat-help]').forEach(button=>button.addEventListener('click',e=>{e.preventDefault();openStatHelp(button.dataset.statHelp,button);}));
  document.querySelectorAll('[data-stat-help-close]').forEach(button=>button.addEventListener('click',closeStatHelp));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.getElementById('statHelpModal')?.hidden)closeStatHelp();});
  document.querySelectorAll('[data-battle-guide]').forEach(button=>button.addEventListener('click',e=>{e.preventDefault();openBattleGuide(button.dataset.battleGuide,button);}));
  document.querySelectorAll('[data-battle-guide-close]').forEach(button=>button.addEventListener('click',closeBattleGuide));
  document.querySelectorAll('[data-battle-guide-section]').forEach(button=>button.addEventListener('click',()=>{
    const section=button.dataset.battleGuideSection,panel=document.querySelector(`[data-guide-panel="${section}"]`);if(!panel)return;
    document.querySelectorAll('[data-guide-panel]').forEach(item=>item.open=item===panel);panel.scrollIntoView({behavior:'smooth',block:'start'});
    document.querySelectorAll('[data-battle-guide-section]').forEach(item=>item.setAttribute('aria-current',String(item===button)));
  }));
  document.addEventListener('keydown',e=>{
    const modal=document.getElementById('battleGuideModal');if(modal?.hidden)return;
    if(e.key==='Escape'){closeBattleGuide();return;}
    if(e.key!=='Tab')return;
    const focusable=[...modal.querySelectorAll('button,[href],summary,[tabindex]:not([tabindex="-1"])')].filter(element=>!element.hidden);
    if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  });
  document.querySelectorAll('[data-sacrifice-help-close]').forEach(el=>el.addEventListener('click',closeSacrificeHelp));
  document.getElementById('sacrificeHelpModal')?.querySelector('.sacrifice-help-backdrop')?.addEventListener('click',closeSacrificeHelp);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.getElementById('sacrificeHelpModal')?.hidden)closeSacrificeHelp();});
}


function commitNumericEdit({persist=true}={}){
  readInputs();
  if(persist)saveState();
  recalculate();
}
function selectWholeFieldOnFocus(input){
  requestAnimationFrame(()=>{
    if(document.activeElement===input&&!input.disabled&&!input.readOnly)input.select();
  });
}


function calculatorNumericNavigationOrder(){
  const battleType=activeMode==='battle'
    ? String(state.modes.battle.activeBattleType||'')
    : '';
  const isPvp=battleType.startsWith('pvp_');

  // Follow the visual matrix row order. Auto-derived rows are skipped until
  // the player switches that row to Manual.
  const ids=[
    'leadership','authority','dominance',
    'monsterDD','monsterST','monsterHealth','monsterStrength',
    ...BONUS_INPUT_ROWS.flatMap(({key})=>['DD','ST','Health','Strength'].map(stat=>`${key}${stat}`)),
    isPvp?'pvpHealth':'strengthAgainstEpic',
    isPvp?'pvpStrength':null,
  ];

  return ids.filter(id=>{
    const input=els[id];
    if(!input||input.disabled||input.readOnly)return false;
    const field=input.closest('.help-input-field');
    if(field?.hidden)return false;
    if(input.offsetParent===null)return false;
    return true;
  });
}
function handleCalculatorNumericNavigation(id,input,e){
  if((e.key!=='Tab'&&e.key!=='Enter')||input.disabled||input.readOnly)return false;
  const order=calculatorNumericNavigationOrder();
  const index=order.indexOf(id);
  if(index<0||order.length<2)return false;

  // Own both Tab and Enter so native browser focus cannot jump to a checkbox,
  // Fill field, help icon, or other non-calculator control.
  e.preventDefault();
  if(['monsterHealth','monsterStrength','monsterDD','monsterST'].includes(id)){
    syncDerivedEpicBonuses();
  }

  const step=e.shiftKey&&e.key==='Tab'?-1:1;
  const nextId=order[(index+step+order.length)%order.length];
  const next=els[nextId];
  next.focus();
  selectWholeFieldOnFocus(next);
  return true;
}

function wireEvents(){
  wireStatHelp();
  document.getElementById('clanProfileSelect')?.addEventListener('change',event=>{
    currentAccount().clanProfileId=event.target.value;
    renderClanProfileLink();
    loadEncounterNormSettings();
    if(encounterPlanContext)updateEncounterPlan();
    saveState();
  });
  document.getElementById('useClanNorm')?.addEventListener('click',useLinkedClanNorm);
  document.getElementById('saveNormToClan')?.addEventListener('click',saveCurrentNormToClan);
  for(const id of ['encounterPlanNorm','encounterPlanUnit']){const input=els[id];input?.addEventListener('input',()=>{saveManualEncounterNorm();updateEncounterPlan();});input?.addEventListener('change',()=>{normalizeEncounterNorm();saveManualEncounterNorm();updateEncounterPlan();});}
  els.encounterPlanNorm?.addEventListener('focus',()=>selectWholeFieldOnFocus(els.encounterPlanNorm));
  els.encounterPlanNorm?.addEventListener('click',()=>els.encounterPlanNorm.select());
  document.getElementById('encounterPlanBasis')?.addEventListener('change',()=>{normalizeEncounterNorm();saveManualEncounterNorm();updateEncounterPlan();});
  document.getElementById('encounterPlanMembers')?.addEventListener('input',event=>{if(event.target.readOnly)return;saveManualEncounterNorm();updateEncounterPlan();});
  document.getElementById('encounterPlanMembers')?.addEventListener('change',event=>{if(event.target.readOnly)return;event.target.value=String(Math.min(100,Math.max(1,Math.floor(Number(event.target.value)||100))));saveManualEncounterNorm();updateEncounterPlan();});
  els.encounterPlanNorm?.addEventListener('blur',()=>{normalizeEncounterNorm();saveManualEncounterNorm();updateEncounterPlan();});
  els.encounterPlanStrategies?.addEventListener('change',event=>{if(event.target.matches('input[name="encounterPlanStrategy"]'))updateEncounterPlan();});
  els.encounterPlanStrategies?.addEventListener('click',event=>{if(event.target.closest('label'))return;const row=event.target.closest('tr[data-strategy]');if(!row)return;row.querySelector('input').checked=true;updateEncounterPlan();});
  document.querySelectorAll('.mode-button').forEach(b=>b.addEventListener('click',()=>switchMode(b.dataset.mode)));
  const selectionCardMedia=window.matchMedia('(max-width:600px)');
  const syncSelectionCardLayout=()=>{
    if(selectionCardMedia.matches)return;
    document.querySelectorAll('.selection-card.is-collapsed').forEach(card=>{
      card.classList.remove('is-collapsed');
      card.querySelector('.selection-card-toggle')?.setAttribute('aria-expanded','true');
    });
  };
  document.querySelectorAll('.selection-card-toggle').forEach(button=>button.addEventListener('click',()=>{
    if(!selectionCardMedia.matches)return;
    const card=button.closest('.selection-card');
    const collapsed=card.classList.toggle('is-collapsed');
    button.setAttribute('aria-expanded',String(!collapsed));
  }));
  selectionCardMedia.addEventListener?.('change',syncSelectionCardLayout);
  els.clearAllSelections.addEventListener('click',clearAllSelections);
  if(REVIEW_SELECTION_UI_ENABLED)els.reviewSelection?.addEventListener('click',startReviewSelection);
  els.cancelReviewSelection?.addEventListener('click',()=>cancelReviewSelection());
  els.keepCurrentSelection?.addEventListener('click',()=>{pendingReviewProposal=null;els.reviewProposalDialog?.close();});
  els.acceptReviewSelection?.addEventListener('click',acceptReviewSelection);
  els.resetCalculator.addEventListener('click',resetCalculator);

  const armyGroup=['leadership','authority','dominance'];
  for(const id of armyGroup){
    const input=els[id];
    input.addEventListener('focus',()=>{input.value=String(parseNumber(input.value)||'');selectWholeFieldOnFocus(input);});
    input.addEventListener('keydown',e=>handleCalculatorNumericNavigation(id,input,e));
    input.addEventListener('blur',()=>{formatFieldInteger(input);commitNumericEdit();});
  }

  if(els.battleTypeSelect)els.battleTypeSelect.addEventListener('change',()=>{
    if(activeMode!=='battle')return;
    readInputs();saveState();
    const category=els.battleTypeSelect.value;
    state.modes.battle.activeBattleCategory=category;
    state.modes.battle.activeEncounterId=state.modes.battle.activeEncounterByType[category]||(category==='epic'?'epic-doomsday':'pvp-single');
    const type=currentEngineBattleType();
    let method=state.modes.battle.activeBattleMethod||'custom';
    if(type.startsWith('pvp_')&&method==='optimize')method='custom';
    state.modes.battle.activeBattleType=type;
    state.modes.battle.activeBattleMethod=method;
    ensureBattleWorkspace(type,method);
    loadSavedOptimizerResult();
    refreshActiveMode();
  });
  if(els.accountSelect)els.accountSelect.addEventListener('change',()=>{readInputs();saveState();activateAccount(els.accountSelect.value);loadSavedOptimizerResult();refreshActiveMode();});
  if(els.addAccount)els.addAccount.addEventListener('click',()=>{
    const name=promptForUniqueAccountName('Player account name','New Account');if(!name)return;
    const id=uniqueStableId('account',Object.keys(state.accounts));state.accounts[id]=makeAccount({id,name,templeLevel:templeLevel()});activateAccount(id);saveState();refreshActiveMode();
  });
  if(els.duplicateAccount)els.duplicateAccount.addEventListener('click',()=>{
    readInputs();const source=currentAccount(),name=promptForUniqueAccountName('Name for duplicated account',`${source.name} Copy`);if(!name)return;
    const id=uniqueStableId('account',Object.keys(state.accounts)),copy=hydrateAccount({...JSON.parse(JSON.stringify(source)),id,name});state.accounts[id]=copy;activateAccount(id);saveState();refreshActiveMode();
  });
  if(els.renameAccount)els.renameAccount.addEventListener('click',()=>{const account=currentAccount(),name=promptForUniqueAccountName('Player account name',account.name,account.id);if(!name)return;account.name=name;saveState();refreshWorkspaceSelectors();});
  if(els.removeAccount)els.removeAccount.addEventListener('click',()=>{
    if(Object.keys(state.accounts).length<=1)return;
    const account=currentAccount();if(!confirm(`Remove player account “${account.name}” and all of its saved encounters?`))return;
    delete state.accounts[account.id];activateAccount(Object.keys(state.accounts)[0]);saveState();refreshActiveMode();
  });
  if(els.exportAccount)els.exportAccount.addEventListener('click',downloadActiveAccountBiff);
  if(els.importAccount)els.importAccount.addEventListener('click',()=>{els.biffFileInput.value='';els.biffFileInput.click();});
  if(els.biffFileInput)els.biffFileInput.addEventListener('change',()=>prepareBiffImport(els.biffFileInput.files?.[0]));
  if(els.biffImportName)els.biffImportName.addEventListener('input',validateImportedAccountName);
  if(els.cancelBiffImport)els.cancelBiffImport.addEventListener('click',()=>{pendingBiffImport=null;els.biffFileInput.value='';els.biffImportDialog.close();});
  if(els.biffImportForm)els.biffImportForm.addEventListener('submit',event=>{event.preventDefault();confirmPendingBiffImport();});
  if(els.encounterSelect)els.encounterSelect.addEventListener('change',()=>{
    readInputs();saveState();state.modes.battle.activeEncounterId=els.encounterSelect.value;state.modes.battle.activeEncounterByType[state.modes.battle.activeBattleCategory]=els.encounterSelect.value;state.modes.battle.activeBattleType=currentEngineBattleType();ensureBattleWorkspace();loadSavedOptimizerResult();refreshActiveMode();
  });
  els.toggleEpicArmySharing?.addEventListener('click',()=>{
    const id=state.modes.battle.activeEncounterId,workspace=currentBattleWorkspace(),groupId=epicArmyGroup(id);
    if(!groupId)return;
    readInputs();
    if(workspace.inputs.shareEpicArmy){
      if(lastOptimizedEpicPayload&&lastOptimizedEpicSignature===currentEpicEffectiveSignature()){
        const cache={build:OPTIMIZER_CACHE_BUILD,payload:compactOptimizerPayloadForStorage(lastOptimizedEpicPayload),signature:lastOptimizedEpicSignature,runDiagnostics:lastEpicRunDiagnostics,savedAt:Date.now()};
        workspace.resultCache=cache;
        try{writeOptimizerResultWithQuotaRecovery(optimizerResultStorageKey(),cache);}catch(error){console.warn('Could not keep an independent copy of the shared optimizer result.',error);}
      }
      workspace.inputs.shareEpicArmy=false;
    }else{
      const source=linkedEpicArmyWorkspaces(id).find(peer=>peer.id!==id);
      if(source){
        const name=resolveEncounter(currentAccount(),source.id)?.name||source.id;
        if(!confirm(`Use the shared ${EPIC_ARMY_GROUPS[groupId].label} army from ${name}? This replaces this encounter’s army limits, unit bonuses, selected units, and custom order. Its clan norm and revival strategy stay unchanged.`))return;
        copySharedEpicArmy(source.workspace,workspace);
      }
      workspace.inputs.shareEpicArmy=true;
    }
    saveState();loadSavedOptimizerResult();refreshActiveMode();
  });
  els.replaceSharedEpicArmy?.addEventListener('click',()=>{
    const id=state.modes.battle.activeEncounterId,workspace=currentBattleWorkspace(),groupId=epicArmyGroup(id);
    if(!groupId||workspace.inputs.shareEpicArmy)return;
    readInputs();
    if(!confirm(`Replace the shared ${EPIC_ARMY_GROUPS[groupId].label} army with this encounter’s army limits, unit bonuses, selected units, and custom order? Linked encounters will update. Their clan norms and revival strategies stay unchanged.`))return;
    workspace.inputs.shareEpicArmy=true;
    saveState();loadSavedOptimizerResult();refreshActiveMode();
  });
  if(els.addEncounter)els.addEncounter.addEventListener('click',()=>openEncounterEditor());
  if(els.duplicateEncounter)els.duplicateEncounter.addEventListener('click',()=>openEncounterEditor(currentEncounter(),true));
  if(els.editEncounter)els.editEncounter.addEventListener('click',()=>{if(!isBuiltInEncounter(state.modes.battle.activeEncounterId))openEncounterEditor(currentEncounter());});
  if(els.removeEncounter)els.removeEncounter.addEventListener('click',()=>{
    const id=state.modes.battle.activeEncounterId,encounter=currentEncounter();if(!encounter||isBuiltInEncounter(id)||!confirm(`Remove encounter “${encounter.name}”?`))return;
    delete currentAccount().customEncounters[id];delete state.modes.battle.workspaces[id];state.modes.battle.activeEncounterId=encountersForAccount(currentAccount(),state.modes.battle.activeBattleCategory)[0].id;saveState();refreshActiveMode();
  });
  if(els.cancelEncounter)els.cancelEncounter.addEventListener('click',()=>els.encounterDialog.close());
  if(els.encounterName)els.encounterName.addEventListener('input',()=>{els.encounterFormError.textContent='';els.encounterFormError.classList.remove('show');});
  if(els.encounterForm)els.encounterForm.addEventListener('submit',event=>{
    event.preventDefault();const account=currentAccount(),category=state.modes.battle.activeBattleCategory,editId=els.encounterForm.dataset.editId;
    try{
      const requestedName=els.encounterName.value.trim();
      const duplicateName=encountersForAccount(account,category).find(row=>row.id!==editId&&comparableName(row.name)===comparableName(requestedName));
      if(duplicateName)throw new Error(`An encounter named “${requestedName}” already exists for ${category==='epic'?'Epic Monster':'Player vs. Player'} battles. Choose a different name.`);
      const id=editId||uniqueStableId(`${category}-custom`,[...Object.keys(account.customEncounters),...encountersForAccount(account,category).map(row=>row.id)]);
      const encounter=createCustomEncounter({id,name:els.encounterName.value,battleType:category,enemyFormation:{FLYING:els.enemyFlying.value,MOUNTED:els.enemyMounted.value,MELEE:els.enemyMelee.value,RANGED:els.enemyRanged.value},arachneBonus:els.encounterArachneBonus.checked,pvpModel:els.encounterPvpModel.value});
      const sourceId=editId?'':state.modes.battle.activeEncounterId;account.customEncounters[id]=encounter;
      if(!editId&&sourceId&&els.encounterDialogTitle.textContent.startsWith('Duplicate'))state.modes.battle.workspaces[id]=makeBattleWorkspace(engineBattleType(encounter),copyWorkspace(state.modes.battle.workspaces[sourceId]));
      state.modes.battle.activeEncounterId=id;state.modes.battle.activeEncounterByType[category]=id;state.modes.battle.activeBattleType=engineBattleType(encounter);ensureBattleWorkspace();els.encounterDialog.close();saveState();refreshActiveMode();
    }catch(error){els.encounterFormError.textContent=error.message;els.encounterFormError.classList.add('show');}
  });
  if(els.templeLevel)els.templeLevel.addEventListener('change',()=>{
    currentAccount().templeLevel=Math.max(1,Math.min(45,Number(els.templeLevel.value)||45));
    populateTempleLevel();
    saveState();
    // Temple affects PvP economic ordering as well as displayed revival costs,
    // so rebuild the authoritative stack with the new divisor.
    if(appInitialized)recalculate();
  });
  if(els.pvpEnemyUnitSelect)els.pvpEnemyUnitSelect.addEventListener('change',()=>{
    if(activeMode!=='battle'||state.modes.battle.activeBattleType!=='pvp_single_cp')return;
    modeState().inputs.enemyUnitId=els.pvpEnemyUnitSelect.value||'troop-g9-flying-corax-2';
    saveState();
    recalculate();
  });
  if(els.battleMethodSelect)els.battleMethodSelect.addEventListener('change',()=>selectBattleMethod(els.battleMethodSelect.value));
  els.resultsMethodSwitch?.addEventListener('click',event=>{const button=event.target.closest('[data-results-method]');if(button)selectBattleMethod(button.dataset.resultsMethod,true);});
  const advancedIds=[
    'monsterHealth','pvpHealth',...BONUS_PROFILE_FIELD_IDS,
    'monsterStrength','strengthAgainstEpic','pvpStrength','monsterDD','monsterST',
  ];
  for(const id of advancedIds){
    const input=els[id];if(!input)continue;
    input.addEventListener('focus',()=>selectWholeFieldOnFocus(input));
    input.addEventListener('keydown',e=>handleCalculatorNumericNavigation(id,input,e));
    input.addEventListener('input',()=>{
      if(['monsterHealth','monsterStrength','monsterDD','monsterST','humanHealth','humanStrength','humanDD','humanST'].includes(id))syncDerivedEpicBonuses();
    });
    input.addEventListener('blur',()=>{
      if(['pvpHealth','pvpStrength'].includes(id))input.value=String(parseNumber(input.value));
      commitNumericEdit();
    });
  }

  for(const [disclosureId,detailsId] of [['monsterBonusDisclosure','monsterBonusDetails'],['humanBonusDisclosure','humanBonusDetails']]){
    els[disclosureId]?.addEventListener('click',()=>{
      const expanded=els[disclosureId].getAttribute('aria-expanded')==='true';
      els[disclosureId].setAttribute('aria-expanded',String(!expanded));
      els[detailsId].hidden=expanded;
    });
  }

  for(const {auto} of BONUS_INPUT_ROWS){
    els[auto]?.addEventListener('change',()=>{
      const before=currentEpicEffectiveSignature();
      modeState().inputs[auto]=els[auto].checked;
      syncDerivedEpicBonuses();readInputs();saveState();
      const after=currentEpicEffectiveSignature();
      if(before===after){if(lastOptimizedEpicSignature&&after===lastOptimizedEpicSignature)epicResultCurrent=true;setOptimizeButtonState();return;}
      recalculate();
    });
  }

  for(const id of ['leadershipFill','authorityFill','dominanceFill']){
    els[id].addEventListener('blur',()=>{
      formatFillPercent(els[id]);
      commitNumericEdit();
    });
  }
  els.resetCustomOrderDefault?.addEventListener('click',resetCustomOrderToDefault);
  els.rankSeparation.addEventListener('input',updateRankSeparationDisplay);
  els.rankSeparation.addEventListener('change',()=>commitNumericEdit());
  els.minimumSeparation?.addEventListener('change',()=>{modeState().inputs.minimumSeparation=els.minimumSeparation.checked;updateSeparationModeUI();saveState();recalculate();});
  els.resetAdvancedSettings.addEventListener('click',resetAdvancedSettings);
  for(const id of ['autoLeadership','autoAuthority','autoDominance']){
    els[id].addEventListener('change',()=>{
      readInputs();updateFillFieldStates();
      if(id==='autoAuthority'&&isAnyEpicOptimizeMode()&&!modeState().inputs.includeMercenariesInOptimization){
        recalculateAfterMercenaryOnlyChange();
        return;
      }
      recalculate();
    });
  }
  els.arachne.addEventListener('change',recalculate);
  els.includeMercenariesInOptimization.addEventListener('change',()=>{
    modeState().inputs.includeMercenariesInOptimization=els.includeMercenariesInOptimization.checked;
    saveState();recalculate();
  });
  els.optimizeArmy.addEventListener('click',startEpicOptimization);
  els.cancelOptimization.addEventListener('click',()=>{
    if(epicWorker){epicWorker.terminate();epicWorker=null;}
    stopOptimizerElapsedTimer();
    closeOptimizerModal();
    els.resultStatus.classList.remove('optimizing-status');
    els.resultStatus.textContent='Optimization cancelled.';
    epicResultCurrent=false;
    setOptimizeButtonState();
  });
}

function initializeActiveCalculatorAfterData(){
  try{
    refreshActiveMode({save:false});
    return true;
  }catch(error){
    console.error('Initial calculator restore failed.',error);

    // A cached optimized result from an older build must never make the whole
    // calculator unusable. Keep it in storage, but skip rendering it for this
    // startup pass and restore the live inputs/selections normally.
    lastOptimizedEpicPayload=null;
    lastOptimizedEpicSignature='';
    lastEpicRunDiagnostics=null;
    epicResultCurrent=false;

    try{
      configureModeUI();
      applyStateToInputs();
      syncCustomOrders();
      renderAllSelections();
      if(isCustomOrderMode())renderOrderView();
      syncDerivedEpicBonuses();
      readInputs();
      recalculate();
      return true;
    }catch(fallbackError){
      console.error('Fallback calculator initialization failed.',fallbackError);
      showValidation(['The calculator interface could not be fully restored. Your saved inputs are still on this device.']);
      return false;
    }
  }
}

function persistCurrentWorkspace(){
  try{
    if(!appInitialized)return;
    readInputs();
    saveState();
  }catch(error){
    console.warn('Could not persist current calculator workspace.',error);
  }
}
window.addEventListener('pagehide',persistCurrentWorkspace);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden')persistCurrentWorkspace();
});

async function init(){
  cacheElements();
  for(const id of ['epicArmySharing','epicArmySharingTitle','epicArmySharingStatus','toggleEpicArmySharing','replaceSharedEpicArmy'])els[id]=document.getElementById(id);
  for(const id of ['monsterBonusDisclosure','monsterBonusDetails','monsterProfileStatus'])els[id]=document.getElementById(id);
  loadSavedState();
  if(activeMode==='battle')ensureBattleWorkspace();
  loadSavedOptimizerResult();
  applyStateToInputs();
  setChartStyle(state.preferences.chartStyle,{persist:false});
  wireEvents();
  wireCustomOrderFloatingMetric();

  // Only an actual database request/parse failure should produce the
  // "unit database could not be loaded" message.
  try{
    await Promise.all([loadData(),loadEpicChestRewards()]);
  }catch(error){
    console.error('Army database load failed.',error);
    appInitialized=false;
    setOptimizeButtonState();
    showValidation(['The unit database could not be loaded. Refresh the page and try again.']);
    return;
  }

  // From this point forward the calculator data is available. A later UI or
  // saved-result restore problem must not disable optimization.
  appInitialized=true;
  showValidation([]);

  initializeActiveCalculatorAfterData();

  // Re-evaluate the primary action after all units/selections have rendered.
  setOptimizeButtonState();

  requestAnimationFrame(()=>{
    if(!appInitialized)return;
    try{
      refreshAfterBrowserRestore();
    }catch(error){
      console.error('Post-render browser-state restore failed.',error);
      setOptimizeButtonState();
    }
    setTimeout(()=>{
      if(!appInitialized)return;
      try{refreshAfterBrowserRestore();}
      catch(error){console.error('Delayed browser-state restore failed.',error);setOptimizeButtonState();}
    },150);
    setTimeout(()=>{
      if(!appInitialized)return;
      try{refreshAfterBrowserRestore();}
      catch(error){console.error('Final browser-state restore failed.',error);setOptimizeButtonState();}
    },600);
  });
}
window.addEventListener('pageshow',()=>{
  requestAnimationFrame(()=>{
    if(epicWorker){
      setOptimizeButtonState();
      return;
    }
    try{refreshAfterBrowserRestore();}
    catch(error){console.error('pageshow restore failed.',error);setOptimizeButtonState();}
    setTimeout(()=>{
      if(!epicWorker){
        try{refreshAfterBrowserRestore();}
        catch(error){console.error('delayed pageshow restore failed.',error);setOptimizeButtonState();}
      }
    },150);
  });
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='visible')return;
  if(epicWorker){
    // Background tabs may be throttled by the browser, but the optimizer
    // worker should be allowed to continue/resume rather than being replaced.
    setOptimizeButtonState();
    return;
  }
  setTimeout(()=>{
    try{refreshAfterBrowserRestore();}
    catch(error){console.error('visibility restore failed.',error);setOptimizeButtonState();}
  },0);
});
init();


// v111 — inline help dismissal behavior.
document.addEventListener('click',(event)=>{
  const closeButton=event.target.closest('.inline-info-close');
  if(closeButton){
    const details=closeButton.closest('.inline-info-help');
    if(details)details.open=false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  document.querySelectorAll('.inline-info-help[open]').forEach(details=>{
    const card=details.querySelector('.inline-info-card');
    const summary=details.querySelector('summary');
    if(card?.contains(event.target)||summary?.contains(event.target))return;
    details.open=false;
  });
});
document.addEventListener('keydown',(event)=>{
  if(event.key!=='Escape')return;
  document.querySelectorAll('.inline-info-help[open]').forEach(details=>details.open=false);
});

