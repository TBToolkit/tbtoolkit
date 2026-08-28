import { calculateEpicStack, calculateCategory, calculateCustomStack, calculateCustomCategory, customInternalRank } from './epic-engine.mjs?v=175';
import { scoreEpicArmy } from './epic-combat-engine-v2.mjs?v=74';
import { calculateBattleStack, calculateBattleCategory, calculatePvpCpStack, calculatePvpCustomStack, calculatePvpCustomCategory, calculatePvpUnknownStack, calculatePvpUnknownCustomStack, defaultPvpInternalOrder } from './battle-engine.mjs?v=175';

const STORAGE_KEY='tbtoolkit.stackingCalculator.v17';
const LEGACY_EPIC_KEY='tbtoolkit.epicStacker.v2';
const OPTIMIZER_RESULT_KEY='tbtoolkit.epicOptimizer.lastResult.v1';
const CAPACITY_META={troop:{limit:'leadership',fill:'leadershipFill',auto:'autoLeadership'},mercenary:{limit:'authority',fill:'authorityFill',auto:'autoAuthority'},monster:{limit:'dominance',fill:'dominanceFill',auto:'autoDominance'}};
const units={troop:[],monster:[],mercenary:[]};let armyV2=[];const els={};let activeCategory='troop';let activeMode='battle';let activeView='troop';let resolvedFills={troop:1,monster:1,mercenary:1};
let epicWorker=null;let epicRequestId=0;let epicResultCurrent=false;let lastOptimizedEpicSignature='';let lastEpicRunDiagnostics=null;let lastOptimizedEpicPayload=null;
let appInitialized=false;let optimizerBestEldSoFar=0;
let optimizerStartedAt=0;let optimizerElapsedTimer=null;let lastOptimizationElapsedMs=null;
function formatElapsed(ms){
  const total=Math.max(0,Math.floor(Number(ms||0)/1000));
  const minutes=Math.floor(total/60),seconds=total%60;
  return `${minutes}:${String(seconds).padStart(2,'0')}`;
}
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
monsterHealth:'1600',humanHealth:'1500',epicHunterHealth:'859',pvpHealth:'0',
monsterStrength:'2299.5',strengthAgainstEpic:'3225',pvpStrength:'0',monsterDD:'12',monsterST:'12',
humanStrength:'2199.5',epicHunterStrength:'1558.5',
humanDD:'12',epicHunterDD:'12',humanST:'7',epicHunterST:'7',
useCustomFamilyBonuses:false,useCustomHealthInputs:false,includeMercenariesInOptimization:false,
arachne:false,battleType:'epic_standard',battleMethod:'basic',enemyUnitId:'troop-g9-flying-corax-2',minimumSeparation:true,rankSeparation:mode==='optimizer'?'0.10':'0.05'};}
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
      ...(seed?.inputs||{}),
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
function battleWorkspaceKey(type){return String(type||'epic_standard');}

const TEMPLE_REVIVAL_DIVISORS=Object.freeze({
  1:1.04,2:1.06,3:1.08,4:1.11,5:1.13,6:1.16,7:1.19,8:1.22,9:1.27,
  10:1.33,11:1.36,12:1.40,13:1.44,14:1.48,15:1.53,16:1.58,17:1.63,18:1.68,19:1.74,
  20:1.81,21:1.91,22:2.02,23:2.15,24:2.31,25:2.51,26:2.68,27:2.88,28:3.13,29:3.44,
  30:3.84,31:3.93,32:4.03,33:4.13,34:4.23,35:4.34,36:4.46,37:4.59,38:4.72,39:4.87,
  40:5.02,41:5.17,42:5.34,43:5.52,44:5.71,45:5.91
});
function templeLevel(){return Math.max(1,Math.min(45,Number(state.preferences?.templeLevel)||45));}
function templeRevivalDivisor(){return Number(TEMPLE_REVIVAL_DIVISORS[templeLevel()]||1);}
function actualRevivalCost(rawCost){
  const raw=Math.max(0,Number(rawCost)||0);
  return raw/templeRevivalDivisor();
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
  return Math.floor(qty*ATTACKING_REVIVABLE_FRACTION);
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
const state={preferences:{templeLevel:45},modes:{
epic:{selectedIds:{troop:[],monster:[],mercenary:[]},inputs:defaultInputs('epic')},
optimizer:{selectedIds:{troop:[],monster:[],mercenary:[]},inputs:defaultInputs('optimizer')},
custom:{selectedIds:{troop:[],monster:[],mercenary:[]},inputs:defaultInputs('custom'),orders:{troop:[],monster:[],mercenary:[]},unitOrders:{troop:{},monster:{},mercenary:{}},unitOrderManual:{troop:{},monster:{},mercenary:{}},squadOrder:{troop:[],monster:[],mercenary:[]}},
battle:{activeBattleType:'epic_standard',activeBattleMethod:'basic',workspaces:{}}
}};
function ensureBattleWorkspace(type=state.modes.battle.activeBattleType,method=state.modes.battle.activeBattleMethod,seed=null){
  const key=battleWorkspaceKey(type);
  if(!state.modes.battle.workspaces[key]){
    state.modes.battle.workspaces[key]=makeBattleWorkspace(type,seed);
  }
  const workspace=state.modes.battle.workspaces[key];
  workspace.inputs.battleType=type;
  workspace.inputs.battleMethod=method;
  workspace.inputs.arachne=type==='epic_arachne';
  return workspace;
}
function currentBattleWorkspace(){
  return ensureBattleWorkspace(
    state.modes.battle.activeBattleType,
    state.modes.battle.activeBattleMethod
  );
}
function modeState(){return activeMode==='battle'?currentBattleWorkspace():state.modes[activeMode];}
function cacheElements(){['leadership','leadershipFill','autoLeadership','authority','authorityFill','autoAuthority','dominance','dominanceFill','autoDominance','monsterHealth','humanHealth','epicHunterHealth','arachne','arachneRow','rankSeparation','rankSeparationValue','resetAdvancedSettings','resetCalculator','modeDescription','separationLabel','separationMin','separationMid','separationMax','orderView','troopOrderList','monsterOrderList','mercenaryOrderList','clearAllSelections','guardsmanSelection','specialistSelection','engineerSelection','monsterSelection','mercenarySelection','guardsmanCount','specialistCount','engineerCount','monsterCardCount','mercenaryCardCount','guardsmanMaster','specialistMaster','engineerMaster','monsterMaster','mercenaryMaster','validationBox','resultsView','resultStatus','resultEmpty','resultGroups','troopResults','monsterResults','mercenaryResults','leadershipBar','authorityBar','dominanceBar','leadershipActual','authorityActual','dominanceActual','layerChartPanel','overlapSummary','layerChartEmpty','layerChartScroll','layerHealthChart','layerChartTooltip','monsterStrength','strengthAgainstEpic','monsterDD','monsterST','humanStrength','epicHunterStrength','humanDD','epicHunterDD','humanST','epicHunterST','useCustomFamilyBonuses','epicPredictionPanel','expectedLifetimeDamage','rawGoldRevival','damagePerThousandGold','predictionMeta','predictionRows','customFamilyBonusFields','optimizeArmy','optimizeHelp','optimizerModal','optimizerProgressHeadline','optimizerProgressTrack','optimizerProgressBar','optimizerProgressPercent','optimizerProgressEvaluations','optimizerProgressDetail','optimizerProgressCurrentEld','optimizerProgressBestEld','optimizerElapsedTime','cancelOptimization','useCustomHealthInputs','classicBattleDetails','classicBattleMeta','classicBattleRows','includeMercenariesInOptimization','battleBetaPanel','battleContextNote','battleMethodNote','battleTypeSelect','battleMethodSelect','pvpEnemyUnitField','pvpEnemyUnitSelect','strengthAgainstEpicField','pvpHealthField','pvpHealth','pvpStrengthField','pvpStrength','pvpCpDetailsPanel','pvpCpLifetimeDamage','pvpCpFullGold','pvpCpEnemyName','pvpCpDetailsMeta','pvpCpDetailsRows','templeLevel','templeMultiplier','pvpCpFullSilver','setupStepNumber','selectionStepNumber','minimumSeparation','fixedSeparationControl','resetCustomOrderDefault'].forEach(id=>els[id]=document.getElementById(id));}
function parseNumber(value){const x=Number(String(value??'').replace(/[%,$\s]/g,'').replace(/,/g,''));return Number.isFinite(x)?x:0;}
function formatInteger(value){return Math.round(parseNumber(value)).toLocaleString('en-US');}
function formatFieldInteger(el){const n=parseNumber(el.value);el.value=n?Math.round(n).toLocaleString('en-US'):'';}
function formatFillPercent(el){const n=parseNumber(el.value);el.value=Number.isFinite(n)?n.toFixed(2):'0.00';}
const TIER_COLORS={9:'#69b85a',8:'#9aa4ad',7:'#d8ad42',6:'#d96858',5:'#d7974b',4:'#9673c8',3:'#55a6cf',2:'#7eae59',1:'#8f9892'};
function hexToRgb(hex){const s=hex.replace('#','');return[parseInt(s.slice(0,2),16),parseInt(s.slice(2,4),16),parseInt(s.slice(4,6),16)];}
function mixHex(hex1,hex2,amount){const a=hexToRgb(hex1),b=hexToRgb(hex2),c=a.map((v,i)=>Math.round(v+(b[i]-v)*amount));return`#${c.map(v=>v.toString(16).padStart(2,'0')).join('')}`;}
function tierNumber(level){const m=String(level||'').match(/\d+/);return m?Number(m[0]):0;}
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
function escapeHtml(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
function iconFallback(img){img.onerror=()=>{if(img.dataset.fallback)return;img.dataset.fallback='1';img.src='assets/unit-icons/missing-icon.svg';img.classList.add('missing-icon');};}

function legacyUnitFromCanonical(unit){
  const capacityField=unit.category==='troop'?'leadershipEach':unit.category==='monster'?'dominanceEach':'authorityEach';
  const mercGroupMap={COM:'COMMON',MNST:'MONSTER',SPCL:'SPECIALIST',GRD:'GUARDSMAN',EMH:'EPIC - HUNTER',EX:'EPIC - EVENT',ARNE:'ARACHNE',ENG:'ENGINEER'};
  const tierSubtype=String(unit.tier||'').toUpperCase().split('-').slice(1).join('-');
  const legacyClass=unit.category==='mercenary'?(mercGroupMap[tierSubtype]||unit.unitClass):unit.unitClass;
  return{
    id:unit.id,
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
  const sources=['/data/army-v2.json?v=130','data/army-v2.json?v=130'];
  let lastError=null;
  for(const source of sources){
    try{
      const r=await fetch(source,{cache:'no-store'});
      if(!r.ok)throw new Error(`Army database request failed (${r.status})`);
      const data=await r.json();
      if(!Array.isArray(data)||!data.length)throw new Error('Army database is empty or invalid');
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
function loadSavedState(){
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
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
        state.modes.battle.activeBattleType=b.activeBattleType||'epic_standard';
        state.modes.battle.activeBattleMethod=b.activeBattleMethod||'basic';

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
        const method=b.inputs?.battleMethod||'basic';
        state.modes.battle.activeBattleType=type;
        state.modes.battle.activeBattleMethod=method;
        state.modes.battle.workspaces[battleWorkspaceKey(type)]=makeBattleWorkspace(type,b);
      }

      ensureBattleWorkspace();
      return;
    }
  }catch(error){
    console.warn('Could not restore saved calculator state.',error);
  }
  ensureBattleWorkspace();
}
function saveState(){localStorage.setItem(STORAGE_KEY,JSON.stringify({activeMode,preferences:state.preferences,modes:state.modes}));}
function optimizerResultStorageKey(){
  return activeMode==='battle'
    ?`tbtoolkit.battleCalculator.optimizerResult.v2.${battleWorkspaceKey(state.modes.battle.activeBattleType)}`
    :OPTIMIZER_RESULT_KEY;
}
function loadSavedOptimizerResult(){
  try{
    lastOptimizedEpicPayload=null;lastOptimizedEpicSignature='';lastEpicRunDiagnostics=null;
    let saved=JSON.parse(localStorage.getItem(optimizerResultStorageKey())||'null');
    if(activeMode==='battle'&&!saved)saved=currentBattleWorkspace().resultCache||null;
    if(!saved?.payload||!saved?.signature)return;
    lastOptimizedEpicPayload=saved.payload;
    lastOptimizedEpicSignature=saved.signature;
    lastEpicRunDiagnostics=saved.runDiagnostics??null;
    if(activeMode==='battle')currentBattleWorkspace().resultCache=saved;
  }catch(error){console.warn('Could not restore saved optimizer result.',error);}
}
function saveOptimizerResult(){
  try{
    if(!lastOptimizedEpicPayload||!lastOptimizedEpicSignature)return;
    const saved={payload:lastOptimizedEpicPayload,signature:lastOptimizedEpicSignature,runDiagnostics:lastEpicRunDiagnostics,savedAt:Date.now()};
    localStorage.setItem(optimizerResultStorageKey(),JSON.stringify(saved));
    if(activeMode==='battle')currentBattleWorkspace().resultCache=saved;
    saveState();
  }catch(error){console.warn('Could not save optimizer result.',error);}
}
function clearSavedOptimizerResult(){
  lastOptimizedEpicPayload=null;lastOptimizedEpicSignature='';lastEpicRunDiagnostics=null;
  localStorage.removeItem(optimizerResultStorageKey());
  if(activeMode==='battle')currentBattleWorkspace().resultCache=null;
}
function updateRankSeparationDisplay(){const max=1;const v=Math.min(max,Math.max(0,parseNumber(els.rankSeparation?.value)));if(els.rankSeparationValue)els.rankSeparationValue.value=`${v.toFixed(2)}%`;}

function setDerivedField(id,value,readonly=true){
  if(!els[id])return;
  els[id].value=Number.isFinite(Number(value))?String(Math.max(0,Number(value))):'0';
  els[id].readOnly=readonly;
  els[id].disabled=readonly;
  els[id].tabIndex=readonly?-1:0;
  els[id].setAttribute('aria-readonly',String(readonly));
}
function syncDerivedHealthInputs(){syncDerivedEpicBonuses();}
function syncDerivedEpicBonuses(){
  const custom=!!els.useCustomFamilyBonuses?.checked;if(els.customFamilyBonusFields)els.customFamilyBonusFields.hidden=!custom;
  const mh=parseNumber(els.monsterHealth?.value),ms=parseNumber(els.monsterStrength?.value),dd=parseNumber(els.monsterDD?.value),st=parseNumber(els.monsterST?.value);
  if(!custom){setDerivedField('humanHealth',Math.max(0,mh-100),true);setDerivedField('epicHunterHealth',Math.max(0,mh-741),true);setDerivedField('humanStrength',Math.max(0,ms-100),true);setDerivedField('epicHunterStrength',Math.max(0,ms-741),true);setDerivedField('humanDD',dd,true);setDerivedField('epicHunterDD',dd,true);setDerivedField('humanST',Math.max(0,st-5),true);setDerivedField('epicHunterST',Math.max(0,st-5),true);}
  else for(const id of ['humanHealth','epicHunterHealth','humanStrength','epicHunterStrength','humanDD','epicHunterDD','humanST','epicHunterST']){if(!els[id])continue;els[id].readOnly=false;els[id].disabled=false;els[id].tabIndex=0;els[id].setAttribute('aria-readonly','false');}
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
    includeMercenariesInOptimization:!!i.includeMercenariesInOptimization,
    useCustomFamilyBonuses:!!i.useCustomFamilyBonuses,
    customFamilyBonuses:{
      humanHealthPct:parseNumber(i.humanHealth),
      epicHunterHealthPct:parseNumber(i.epicHunterHealth),
      humanStrengthPct:parseNumber(i.humanStrength),
      epicHunterStrengthPct:parseNumber(i.epicHunterStrength),
      humanDDPct:parseNumber(i.humanDD),
      epicHunterDDPct:parseNumber(i.epicHunterDD),
      humanSTPct:parseNumber(i.humanST),
      epicHunterSTPct:parseNumber(i.epicHunterST)
    }
  };
}
function fixedStandardMercenaryQuantitiesForOptimizer(){
  const i=modeState().inputs;
  if(i.includeMercenariesInOptimization)return {};
  const selected=[...(modeState().selectedIds.mercenary||[])];
  if(!selected.length)return {};

  const inputs=baseEngineInputs();
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
    rankSeparation:parseNumber(i.rankSeparation),
    arachne:activeMode!=='custom'&&!!i.arachne,
    monsterHealth:parseNumber(i.monsterHealth),
    humanHealth:parseNumber(i.humanHealth),
    epicHunterHealth:parseNumber(i.epicHunterHealth),
    monsterStrength:parseNumber(i.monsterStrength),
    humanStrength:parseNumber(i.humanStrength),
    epicHunterStrength:parseNumber(i.epicHunterStrength),
    strengthAgainstEpic:parseNumber(i.strengthAgainstEpic),
    monsterDD:parseNumber(i.monsterDD),
    humanDD:parseNumber(i.humanDD),
    epicHunterDD:parseNumber(i.epicHunterDD),
    monsterST:parseNumber(i.monsterST),
    humanST:parseNumber(i.humanST),
    epicHunterST:parseNumber(i.epicHunterST)
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
  if(els.optimizerProgressCurrentEld)els.optimizerProgressCurrentEld.textContent='—';
  if(els.optimizerProgressBestEld)els.optimizerProgressBestEld.textContent='—';
  if(!els.optimizerModal)return;
  els.optimizerModal.hidden=false;
  document.body.classList.add('optimizer-modal-open');
  updateOptimizerProgress({phase:'loading',progressPct:0,evaluations:0});
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
  if(progress.phase==='finalizing')return 'Finalizing quantities and battle predictions…';
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
  const currentEld=Number(progress.expectedLifetimeDamage);
  if(Number.isFinite(currentEld)&&currentEld>0){
    optimizerBestEldSoFar=Math.max(optimizerBestEldSoFar,currentEld);
    if(els.optimizerProgressCurrentEld)els.optimizerProgressCurrentEld.textContent=formatDamage(currentEld);
    if(els.optimizerProgressBestEld)els.optimizerProgressBestEld.textContent=formatDamage(optimizerBestEldSoFar);
  }
}
function formatDamage(value){
  const n=Number(value)||0;
  if(n>=1e12)return`${(n/1e12).toFixed(3)}T`;
  if(n>=1e9)return`${(n/1e9).toFixed(3)}B`;
  if(n>=1e6)return`${(n/1e6).toFixed(3)}M`;
  return Math.round(n).toLocaleString('en-US');
}
function clearPrediction(){
  if(els.epicPredictionPanel)els.epicPredictionPanel.hidden=true;
  if(els.predictionRows)els.predictionRows.innerHTML='';
}
function renderPrediction(opt){
  if(!opt?.result){clearPrediction();return;}const r=opt.result;els.epicPredictionPanel.hidden=false;els.expectedLifetimeDamage.textContent=formatDamage(r.expectedTotalLifetimeDamage);const revivalRaw=(r.squads??[]).reduce((sum,s)=>sum+rawSquadRevival({id:s.id,quantity:s.quantity},'gold'),0);const actualGold=actualRevivalCost(revivalRaw);els.rawGoldRevival.textContent=Math.round(actualGold).toLocaleString('en-US');const perThousand=actualGold>0?r.expectedTotalLifetimeDamage/actualGold*1000:0;els.damagePerThousandGold.textContent=formatDamage(perThousand);const minSep=r.separationSummary?.minPct;const templeText=` · 90% attacking losses revivable · Temple ${templeLevel()} (${templeRevivalDivisor().toFixed(2)}× revival divisor)`;
  const optimizerContext=isAnyEpicOptimizeMode();
  const isArachneBattle=activeMode==='battle'
    ? state.modes.battle.activeBattleType==='epic_arachne'
    : !!modeState().inputs.arachne;
  if(optimizerContext){const improvement=opt.diagnostics?.improvementPct,run=lastEpicRunDiagnostics,elapsedMs=Number(opt.diagnostics?.optimizationElapsedMs??run?.optimizationElapsedMs),timeText=Number.isFinite(elapsedMs)&&elapsedMs>=0?` · Optimization time: ${formatElapsed(elapsedMs)}`:'',buildText=run?` · Optimizer ${run.optimizerBuild} · Engine ${run.engineBuild} · ${run.armyDatabase}`:'',mercText=modeState().inputs.includeMercenariesInOptimization?' · Mercenaries included':' · Mercenaries excluded from optimization',epicTypeText=isArachneBattle?' · Arachne: 8 enemy squads':' · Standard Epic: 4 enemy squads',evalCount=opt.diagnostics?.totalEvaluations??opt.diagnostics?.evaluations,practicalLoss=Number(opt.diagnostics?.practicalTieBreakLossPct),practicalText=opt.diagnostics?.practicalTieBreakApplied?` · Practical near-optimal tie-break used (${practicalLoss<.001?'<'+'0.001':practicalLoss.toFixed(3)}% ELD below maximum)`:'';els.predictionMeta.textContent=`Two-initiative average · ${Number.isFinite(improvement)?`Optimizer gain vs best starting population: ${improvement.toFixed(2)}% · `:''}${Number.isFinite(minSep)?`Closest health spacing: ${minSep.toFixed(4)}% · `:''}${evalCount?.toLocaleString('en-US')??'—'} candidates evaluated · Multi-seed global search · Dynamic death & attack order${epicTypeText}${mercText}${practicalText}${timeText}${templeText}${buildText}`;}
  else{const label=activeMode==='epic'?'Epic Stacker':'Custom Stacker',epicTypeText=activeMode==='epic'&&modeState().inputs.arachne?' · Arachne: 8 enemy squads':' · Standard Epic: 4 enemy squads';els.predictionMeta.textContent=`${label} · Two-initiative average${Number.isFinite(minSep)?` · Closest health spacing: ${minSep.toFixed(4)}%`:''}${epicTypeText}${templeText} · Full battle simulation using the displayed quantities.`;}
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
    const flag=note?` <button class="sacrifice-flag" type="button" data-sacrifice-id="${escapeHtml(String(s.id))}" aria-label="Explain unusual early death for ${escapeHtml(s.name)}" title="Why does this squad die early?">?</button>`:'';
    return `<tr><td>${escapeHtml(s.tier)} · ${escapeHtml(s.name)}${flag}</td><td>${formatInteger(s.quantity)}</td><td>${s.predictedDeathPosition??'—'}</td><td>${Number(s.averageAttackOpportunities||0).toFixed(1)}</td><td>${Math.round(actualRevivalCost(rawSquadRevival({id:s.id,quantity:s.quantity},'gold'))).toLocaleString('en-US')}</td><td>${formatDamage(s.expectedDamagePerOpportunity)}</td><td>${formatDamage(s.expectedLifetimeDamage)}</td></tr>`;
  }).join('');
  if(optimizerContext&&unusualMap.size){
    els.predictionRows.querySelectorAll('[data-sacrifice-id]').forEach(button=>button.addEventListener('click',()=>openSacrificeHelp(unusualMap.get(String(button.dataset.sacrificeId)))));
  }
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
      const absPct=Math.abs(deltaPct);
      const pctText=absPct<.001?'<0.001':absPct<.01?absPct.toFixed(3):absPct<.1?absPct.toFixed(2):absPct.toFixed(1);
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

  return{
    ...opt,
    quantities:combinedQuantities,
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
  opt=liveStandardMercenaryOptimizerPayload(opt);
  const result=convertEpicV2Result(opt);
  renderResultRows('mercenary',result.categories.mercenary.results);
  renderResultRows('monster',result.categories.monster.results);
  renderResultRows('troop',result.categories.troop.results);
  updateCapacity(result);
  renderLayerHealthChart(result);
  renderPrediction(opt);
  const count=result.categories.troop.results.length+result.categories.monster.results.length+result.categories.mercenary.results.length;
  els.resultStatus.classList.remove('optimizing-status');
  els.resultStatus.textContent=activeMode==='battle'
    ?`${count} optimized squad${count===1?'':'s'} · Battle Calculator Beta · mobile entry order`
    :`${count} optimized squad${count===1?'':'s'} · mobile entry order`;
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
    epicWorker=new Worker('js/epic-optimizer-worker.js?v=159');
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
        updateOptimizerProgress({phase:'finalizing',progressPct:100,evaluations:msg.payload?.diagnostics?.evaluations});
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
  let step=4;
  document.querySelectorAll('.battle-sequenced-section').forEach(section=>{
    const style=getComputedStyle(section);
    if(section.hidden||style.display==='none'||style.visibility==='hidden')return;
    const badge=section.querySelector('.managed-step-number, .section-kicker');
    if(!badge)return;
    badge.textContent=String(step++);
  });
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
    ?'Choose a battle type and calculation method. Enter your army limits and combat bonuses, then select the units you want to use. The Battle Calculator can calculate a standard stack, follow a custom death order, or optimize supported Epic battles. PvP calculations include PvP health, strength, matchup bonuses, and revival costs when they apply.'
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
  if(els.setupStepNumber)els.setupStepNumber.textContent=battle?'2':'1';
  if(els.selectionStepNumber&&!battle)els.selectionStepNumber.textContent='2';
  if(battle){
    const type=state.modes.battle.activeBattleType||'epic_standard';
    const method=state.modes.battle.activeBattleMethod||'basic';
    if(els.battleTypeSelect)els.battleTypeSelect.value=type;
    if(els.battleMethodSelect){
      const optimizeOption=els.battleMethodSelect.querySelector('option[value="optimize"]');
      if(optimizeOption)optimizeOption.disabled=type.startsWith('pvp_');
      if(type.startsWith('pvp_')&&state.modes.battle.activeBattleMethod==='optimize'){
        state.modes.battle.activeBattleMethod='basic';ensureBattleWorkspace(type,'basic');
      }
      els.battleMethodSelect.value=state.modes.battle.activeBattleMethod||'basic';
    }
    modeState().inputs.arachne=type==='epic_arachne';
    const isPvp=type.startsWith('pvp_');
    const optimizeOption=document.getElementById('battleMethodOptimizeOption');
    if(optimizeOption){
      optimizeOption.hidden=isPvp;
      optimizeOption.disabled=isPvp;
    }
    if(isPvp&&state.modes.battle.activeBattleMethod==='optimize'){
      state.modes.battle.activeBattleMethod='basic';
      if(els.battleMethodSelect)els.battleMethodSelect.value='basic';
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
      type==='epic_standard'?'Epic Monster: standard Epic battle with 4 enemy squads.'
      :type==='epic_arachne'?'Epic Arachne: Epic battle with 8 enemy squads.'
      :type==='pvp_unknown'?'PvP: enemy squad count and composition are unknown. Damage value is averaged across valid PvP target archetypes.'
      :'PvP — 1 enemy squad: the calculator builds a stack for a battle against one selected enemy squad.';
    const activeMethod=state.modes.battle.activeBattleMethod||'basic';
    if(els.battleMethodNote)els.battleMethodNote.textContent=
      activeMethod==='optimize'
        ?'Optimize: searches many possible army structures and death orders. It uses simulated battles to find the army with the highest expected lifetime damage.'
        :activeMethod==='custom'
          ?'Custom Order: you choose the death order. The calculator determines the squad quantities needed for that order.'
          :type==='pvp_single_cp'
            ?'Standard: calculates squad quantities and death order automatically. Lower revival cost is prioritized, while stronger squads are preserved when revival costs are similar.'
            :type==='pvp_unknown'
              ?'Standard: calculates squad quantities and death order automatically. Lower revival cost is prioritized, while stronger average PvP damage across possible enemy types is preserved when revival costs are similar.'
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
  updateVisibleStepNumbers();
  setOptimizeButtonState();
}
function applyStateToInputs(){
  const i=modeState().inputs;
  for(const id of ['leadership','authority','dominance','monsterHealth','humanHealth','epicHunterHealth','pvpHealth','monsterStrength','strengthAgainstEpic','pvpStrength','monsterDD','monsterST','humanStrength','epicHunterStrength','humanDD','epicHunterDD','humanST','epicHunterST']){
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
  els.arachne.checked=!!i.arachne;
  els.useCustomFamilyBonuses.checked=!!i.useCustomFamilyBonuses;
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
  for(const id of ['leadership','authority','dominance','monsterHealth','humanHealth','epicHunterHealth','pvpHealth','monsterStrength','strengthAgainstEpic','pvpStrength','monsterDD','monsterST','humanStrength','epicHunterStrength','humanDD','epicHunterDD','humanST','epicHunterST']){
    if(els[id])i[id]=String(parseNumber(els[id].value));
  }
  i.rankSeparation=String(parseNumber(els.rankSeparation.value));
  i.minimumSeparation=!!els.minimumSeparation?.checked;
  if(activeMode==='battle'&&els.pvpEnemyUnitSelect)i.enemyUnitId=els.pvpEnemyUnitSelect.value||'troop-g9-flying-corax-2';
  for(const id of ['autoLeadership','autoAuthority','autoDominance'])i[id]=els[id].checked;
  for(const [cat,meta] of Object.entries(CAPACITY_META)){
    if(!i[meta.auto])i[meta.fill]=String(parseNumber(els[meta.fill].value));
  }
  i.arachne=els.arachne.checked;
  i.useCustomFamilyBonuses=!!els.useCustomFamilyBonuses?.checked;
  i.includeMercenariesInOptimization=!!els.includeMercenariesInOptimization?.checked;
  saveState();
}
function updateSeparationModeUI(){const minimum=!isAnyEpicOptimizeMode()&&modeState().inputs.minimumSeparation!==false;if(els.minimumSeparation)els.minimumSeparation.checked=minimum;if(els.fixedSeparationControl)els.fixedSeparationControl.hidden=minimum;const t=els.minimumSeparation?.closest('.minimum-separation-toggle');if(t)t.hidden=isAnyEpicOptimizeMode();}
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
    (type==='epic_standard'||type==='epic_arachne');
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
  return chosen.slice().sort((a,b)=>customInternalRank(a,units[category])-customInternalRank(b,units[category])||a.displayOrder-b.displayOrder).map(u=>u.id);
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
 updateSquadOrderRanks(target);
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
 return bestCombat+bonus('epic')+(battleType==='epic_arachne'?bonus('arachne'):0);
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
function customOrderV2DefaultFlatOrder(category,stateRef=activeOrderState()){
 const selected=new Set(selectedIdsFor(category));
 const battleType=activeMode==='battle'?state.modes.battle.activeBattleType:'epic_standard';
 // PvP keeps the established battle-specific default generator.
 if(String(battleType).startsWith('pvp_'))return legacyDefaultFlatOrder(category,stateRef);
 return units[category].filter(u=>selected.has(u.id)).slice().sort((a,b)=>{
   const av=customOrderMatchupValue(a),bv=customOrderMatchupValue(b);
   if(Math.abs(av-bv)>1e-12)return av-bv;
   const at=customOrderTierNumber(a),bt=customOrderTierNumber(b);
   if(at!==bt)return at-bt;
   return Number(a.displayOrder||0)-Number(b.displayOrder||0);
 }).map(u=>u.id);
}
function updateSquadOrderRanks(target){
 [...target.querySelectorAll(':scope > .squad-order-item')].forEach((row,index)=>{
   const rank=row.querySelector('.squad-order-rank');if(rank)rank.textContent=String(index+1);
 });
}
function renderOrderView(){
 syncCustomOrders();const ids={troop:'troopOrderList',monster:'monsterOrderList',mercenary:'mercenaryOrderList'},st=activeOrderState();
 for(const category of ['troop','monster','mercenary']){
  const target=els[ids[category]],order=st.squadOrder?.[category]||[],selected=new Set(selectedIdsFor(category)),unitMap=new Map(units[category].filter(u=>selected.has(u.id)).map(u=>[u.id,u]));
  target.innerHTML='';
  if(!order.length){target.innerHTML='<div class="order-empty">Select units to create an order.</div>';continue;}
  order.filter(id=>unitMap.has(id)).forEach((id,index)=>{
   const u=unitMap.get(id),row=document.createElement('div'),col=orderRowColors(category,u.level);row.className='squad-order-item';row.draggable=true;row.dataset.unitId=id;
   row.style.setProperty('--order-row-color',col.rowColor);row.style.setProperty('--order-accent',col.accent);
   row.innerHTML=`<div class="squad-order-drag" title="Drag to reorder">☰</div><div class="squad-order-rank" title="Death order">${index+1}</div><div class="squad-order-icon-wrap"><img class="squad-order-icon" src="${escapeHtml(u.icon||'assets/unit-icons/missing-icon.svg')}" alt=""/></div><div class="squad-order-copy"><strong>${escapeHtml(u.name)}</strong><span>${escapeHtml(u.level)} · ${escapeHtml(u.type)}</span></div><div class="squad-order-bonus">${escapeHtml(customOrderMatchupText(u))}</div><button class="squad-order-move" type="button" aria-label="Move up">↑</button><button class="squad-order-move" type="button" aria-label="Move down">↓</button>`;
   const img=row.querySelector('.squad-order-icon');if(img)iconFallback(img);
   const buttons=row.querySelectorAll('.squad-order-move');buttons[0].onclick=()=>moveSquadOrderItem(category,index,-1);buttons[1].onclick=()=>moveSquadOrderItem(category,index,1);
   row.ondragstart=ev=>{row.classList.add('dragging');ev.dataTransfer.effectAllowed='move';ev.dataTransfer.setData('text/plain',id)};
   row.ondragend=()=>{row.classList.remove('dragging');target.classList.remove('drag-active');updateSquadOrderRanks(target);commitSquadOrderFromDom(category,target)};
   target.append(row);
  });
  target.ondragover=ev=>{const dragging=target.querySelector('.squad-order-item.dragging');if(!dragging)return;ev.preventDefault();target.classList.add('drag-active');let before=null;for(const x of target.querySelectorAll(':scope > .squad-order-item:not(.dragging)')){const r=x.getBoundingClientRect();if(ev.clientY<r.top+r.height/2){before=x;break}}before?target.insertBefore(dragging,before):target.append(dragging);updateSquadOrderRanks(target)};
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
      for(const unit of units[category])if(String(unit.level)===String(level))next[category].add(unit.id);
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
    arachne:(activeMode==='epic'&&!!i.arachne)||(activeMode==='battle'&&i.battleType==='epic_arachne'),
    healthInputs:{
      MONSTER:parseNumber(i.monsterHealth)+pvpHealth,
      HUMAN:parseNumber(i.humanHealth)+pvpHealth,
      EPIC_HUNTER:parseNumber(i.epicHunterHealth)+pvpHealth
    },
    monsterStrengthPct:parseNumber(i.monsterStrength)+pvpStrength,
    humanStrengthPct:parseNumber(i.humanStrength)+pvpStrength,
    epicHunterStrengthPct:parseNumber(i.epicHunterStrength)+pvpStrength,
    pvpHealthPct:pvpHealth,pvpStrengthPct:pvpStrength,
    monsterDDPct:parseNumber(i.monsterDD),humanDDPct:parseNumber(i.humanDD),epicHunterDDPct:parseNumber(i.epicHunterDD),
    monsterSTPct:parseNumber(i.monsterST),humanSTPct:parseNumber(i.humanST),epicHunterSTPct:parseNumber(i.epicHunterST),
    enemyUnitId:i.enemyUnitId||'troop-g9-flying-corax-2',
    minimumSeparation:!!i.minimumSeparation,
    rankSeparation:parseNumber(i.rankSeparation)/100,layerSeparation:parseNumber(i.rankSeparation)/100
  };
}
function categoryProbe(category,fill,inputs){
  const meta=CAPACITY_META[category],probeInputs={...inputs,[meta.fill]:fill};
  if(isCustomOrderMode()){
    syncCustomOrders();
    if(activeMode==='battle'&&state.modes.battle.activeBattleType==='pvp_single_cp'){
      return calculatePvpCustomCategory({
        category,units:units[category],selectedIds:selectedIdsFor(category),
        inputs:probeInputs,order:activeOrderState().orders[category],
        unitOrder:activeOrderState().squadOrder?.[category]||[],
        enemy:selectedPvpEnemy()
      });
    }
    return calculateCustomCategory({
      category,units:units[category],selectedIds:selectedIdsFor(category),
      inputs:probeInputs,order:activeOrderState().orders[category],
      unitOrder:(activeOrderState().orders[category]||[]).flatMap(level=>activeOrderState().unitOrders?.[category]?.[level]||[])
    });
  }
  if(activeMode==='battle'&&String(state.modes.battle.activeBattleType||'').startsWith('pvp_'))
    return calculateBattleCategory({category,units:units[category],selectedIds:selectedIdsFor(category),inputs:probeInputs,battleType:state.modes.battle.activeBattleType});
  return calculateCategory({category,units:units[category],selectedIds:selectedIdsFor(category),inputs:probeInputs});
}
function findMaxSafeFill(category,inputs){const meta=CAPACITY_META[category],limit=inputs[meta.limit];if(!modeState().selectedIds[category].length||!(limit>0))return 1;const full=categoryProbe(category,1,inputs);if(full.totalCapacity<=limit)return 1;let low=0,high=1;for(let i=0;i<55;i++){const mid=(low+high)/2;const r=categoryProbe(category,mid,inputs);if(r.totalCapacity<=limit)low=mid;else high=mid;}return low;}
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
    if(parseNumber(modeState().inputs.epicHunterHealth)<0)errors.push('Derived Epic Hunter Health is below 0%. Use custom family bonuses.');
  }
  if(activeMode!=='optimizer'){
    if(!(inp.healthInputs.MONSTER>0))errors.push('Enter Monster Health.');
    if(!(inp.healthInputs.HUMAN>0))errors.push('Enter Human Health.');
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
    div.innerHTML=`<div class="result-label"><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.level)} · ${escapeHtml(row.type)}</span></div><span class="result-leader" aria-hidden="true"></span><div class="result-qty">${formatInteger(row.qty)}</div>`;
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

function chartUnitLabel(category,row){
  if(category==='mercenary')return row.level;
  return row.level;
}

function overlapStatus(upperRows,lowerRows){
  if(!upperRows.length||!lowerRows.length)return{kind:'neutral',text:'Not enough data'};
  const upperMin=Math.min(...upperRows.map(r=>r.squadHealth));
  const lowerMax=Math.max(...lowerRows.map(r=>r.squadHealth));
  const margin=upperMin-lowerMax;
  if(margin>0)return{kind:'separated',text:`Separated · ${compactHealth(margin)} gap`};
  return{kind:'overlap',text:`Overlap · ${compactHealth(Math.abs(margin))}`};
}

function renderOverlapSummary(result){
  const chips=els.overlapSummary?.querySelectorAll('.overlap-chip');
  if(!chips?.length)return;
  const troop=result?.categories?.troop?.results??[];
  const monster=result?.categories?.monster?.results??[];
  const merc=result?.categories?.mercenary?.results??[];
  const statuses=[overlapStatus(troop,monster),overlapStatus(monster,merc)];
  chips.forEach((chip,i)=>{
    chip.classList.remove('neutral','separated','overlap');
    chip.classList.add(statuses[i].kind);
    chip.querySelector('strong').textContent=statuses[i].text;
  });
}

function clearLayerChart(){
  if(els.layerHealthChart)els.layerHealthChart.innerHTML='';
  if(els.layerChartScroll)els.layerChartScroll.hidden=true;
  if(els.layerChartEmpty)els.layerChartEmpty.hidden=false;
  if(els.layerChartTooltip)els.layerChartTooltip.hidden=true;
  const chips=els.overlapSummary?.querySelectorAll('.overlap-chip');
  chips?.forEach(chip=>{
    chip.classList.remove('separated','overlap');
    chip.classList.add('neutral');
    chip.querySelector('strong').textContent='—';
  });
}

function svgEl(name,attrs={}){
  const el=document.createElementNS('http://www.w3.org/2000/svg',name);
  for(const [key,val] of Object.entries(attrs))el.setAttribute(key,String(val));
  return el;
}

function renderLayerHealthChart(result){
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

  renderOverlapSummary(result);
  els.layerChartEmpty.hidden=true;
  els.layerChartScroll.hidden=false;

  const svg=els.layerHealthChart;
  svg.innerHTML='';
  const width=900;
  const height=430;
  const margin={top:34,right:35,bottom:48,left:78};
  const plotW=width-margin.left-margin.right;
  const plotH=height-margin.top-margin.bottom;
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio','none');

  const vals=all.map(r=>r.squadHealth).filter(Number.isFinite);
  let min=0,max=Math.max(...vals);
  const span=Math.max(max,1);
  max=max+span*.08;

  const y=v=>margin.top+(max-v)/(max-min)*plotH;
  const x=(i,count)=>{
    if(count<=1)return margin.left+plotW*.5;
    return margin.left+(i/(count-1))*plotW;
  };

  // Highlight actual overlap health bands, without judging them.
  const bands=[];
  const t=source.troop,m=source.monster,q=source.mercenary;
  if(t.length&&m.length){
    const low=Math.max(Math.min(...t.map(r=>r.squadHealth)),Math.min(...m.map(r=>r.squadHealth)));
    const high=Math.min(Math.max(...t.map(r=>r.squadHealth)),Math.max(...m.map(r=>r.squadHealth)));
    if(high>=low)bands.push({low,high});
  }
  if(m.length&&q.length){
    const low=Math.max(Math.min(...m.map(r=>r.squadHealth)),Math.min(...q.map(r=>r.squadHealth)));
    const high=Math.min(Math.max(...m.map(r=>r.squadHealth)),Math.max(...q.map(r=>r.squadHealth)));
    if(high>=low)bands.push({low,high});
  }
  for(const band of bands){
    const y1=y(band.high),y2=y(band.low);
    svg.appendChild(svgEl('rect',{x:margin.left,y:y1,width:plotW,height:Math.max(2,y2-y1),class:'chart-overlap-band'}));
    svg.appendChild(svgEl('line',{x1:margin.left,x2:margin.left+plotW,y1:y1,y2:y1,class:'chart-overlap-edge'}));
    svg.appendChild(svgEl('line',{x1:margin.left,x2:margin.left+plotW,y1:y2,y2:y2,class:'chart-overlap-edge'}));
  }

  // Y grid / labels.
  const ticks=6;
  for(let i=0;i<ticks;i++){
    const value=max-(i/(ticks-1))*(max-min);
    const yy=y(value);
    svg.appendChild(svgEl('line',{x1:margin.left,x2:margin.left+plotW,y1:yy,y2:yy,class:'chart-grid-line'}));
    const label=svgEl('text',{x:margin.left-10,y:yy+4,'text-anchor':'end',class:'chart-axis-label'});
    label.textContent=compactHealth(value);
    svg.appendChild(label);
  }
  const yTitle=svgEl('text',{x:15,y:height/2,transform:`rotate(-90 15 ${height/2})`,'text-anchor':'middle',class:'chart-y-title'});
  yTitle.textContent='Squad Health';
  svg.appendChild(yTitle);

  // Direction labels.
  const first=svgEl('text',{x:margin.left,y:height-15,class:'chart-axis-label'});
  first.textContent='Higher squad health';
  svg.appendChild(first);
  const last=svgEl('text',{x:margin.left+plotW,y:height-15,'text-anchor':'end',class:'chart-axis-label'});
  last.textContent='Lower squad health';
  svg.appendChild(last);

  for(const [category,rows] of Object.entries(source)){
    if(!rows.length)continue;
    const meta=CHART_SERIES[category];
    const points=rows.map((row,i)=>({row,x:x(i,rows.length),y:y(row.squadHealth)}));
    const path=svgEl('polyline',{
      points:points.map(p=>`${p.x},${p.y}`).join(' '),
      class:'chart-series-line',
      stroke:meta.color
    });
    svg.appendChild(path);

    points.forEach((p,i)=>{
      const g=svgEl('g');
      const c=svgEl('circle',{cx:p.x,cy:p.y,r:5.3,fill:meta.color,class:'chart-point',tabindex:'0'});
      const label=svgEl('text',{
        x:p.x,
        y:p.y+(category==='mercenary'?18:-11),
        fill:meta.color,
        class:'chart-point-label'
      });
      label.textContent=chartUnitLabel(category,p.row);
      g.appendChild(c);
      g.appendChild(label);
      svg.appendChild(g);

      const showTip=(evt)=>{
        const tip=els.layerChartTooltip;
        tip.innerHTML=`<img src="${escapeHtml(p.row.icon)}" alt=""><div class="tooltip-copy"><strong>${escapeHtml(p.row.level)} · ${escapeHtml(p.row.type)}</strong><span>${escapeHtml(p.row.name)}</span><span>Quantity: ${formatInteger(p.row.qty)}</span><span>Squad Health: ${Math.round(p.row.squadHealth).toLocaleString('en-US')}</span><span>Position in ${meta.label}: ${i+1} of ${rows.length}</span></div>`;
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
  if(!result||!modeState().inputs.minimumSeparation||isAnyEpicOptimizeMode())return;
  const map={troop:'leadershipFill',mercenary:'authorityFill',monster:'dominanceFill'};
  for(const [category,fieldId] of Object.entries(map)){
    const meta=CAPACITY_META[category];
    if(!modeState().inputs[meta.auto])continue;
    const pct=Number(result?.categories?.[category]?.capacityPercent);
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
    ?`Projected Lifetime Damage is a comparison metric that assumes every friendly squad receives its predicted attack opportunities. Unknown-enemy damage gives equal weight to each valid combat-type and species archetype found in the army database. Flying, Mounted, Melee, and Ranged bonuses can stack with Human, Beast, Dragon, Giant, or Elemental bonuses when both apply. Revival costs use 90% of each attacking squad, rounded down to whole units, then apply Temple Level ${templeLevel()} (${templeRevivalDivisor().toFixed(2)}× divisor). Standard treats revival costs within 5% as economically equivalent and preserves stronger average PvP damage.`
    :`Projected Lifetime Damage assumes the single enemy squad survives long enough to defeat every friendly squad. Revival costs use 90% of each attacking squad, rounded down to whole units, then apply Temple Level ${templeLevel()} (${templeRevivalDivisor().toFixed(2)}× divisor). Expected Damage includes applicable matchup bonuses, Specialist 2× PvP strength, Double Damage, and Strike Twice. Standard treats revival costs within 5% as economically equivalent and preserves the stronger PvP damage.`;

  const rows=[
    ...result.categories.troop.results,
    ...result.categories.monster.results,
    ...result.categories.mercenary.results
  ].slice().sort((a,b)=>(a.predictedDeathIndex??999)-(b.predictedDeathIndex??999)||a.displayOrder-b.displayOrder);
  const actualFullGold=actualRevivalCost(rows.reduce((sum,row)=>sum+rawSquadRevival(row,'gold'),0));
  const actualFullSilver=actualRevivalCost(rows.reduce((sum,row)=>sum+rawSquadRevival(row,'silver'),0));
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
      <td>${Math.round(actualRevivalCost(rawSquadRevival(r,'gold'))).toLocaleString('en-US')}</td>
      <td>${Math.round(actualRevivalCost(rawSquadRevival(r,'silver'))).toLocaleString('en-US')}</td>
      <td>${compactNumber(r.expectedPvpDamage)}</td>
      <td>${escapeHtml(reasonFor(r))}</td>
    </tr>`).join('');
}
const liveDamagePrevious=new Map();
function liveDamageKey(){return activeMode==='battle'?`${state.modes.battle.activeBattleType}|${state.modes.battle.activeBattleMethod}`:activeMode;}
function updateLiveDamageMetric(value,isPvp){
 const slots=document.querySelectorAll('.live-damage-slot'),method=activeMode==='battle'?state.modes.battle.activeBattleMethod:'';
 if(method==='optimize'||!Number.isFinite(Number(value))||Number(value)<=0){slots.forEach(x=>x.innerHTML='');return;}
 const key=liveDamageKey(),n=Number(value),prev=liveDamagePrevious.get(key);let delta='';
 if(Number.isFinite(prev)&&prev>0){const pct=(n/prev-1)*100;delta=Math.abs(pct)<0.0005?'<span class="live-damage-change neutral">— 0.000%</span>':`<span class="live-damage-change ${pct>0?'up':'down'}">${pct>0?'▲':'▼'} ${Math.abs(pct).toFixed(3)}%</span>`;}
 liveDamagePrevious.set(key,n);const label=isPvp?'PLD':'ELD',markup=`<span class="live-damage-label">${label}</span><strong>${isPvp?compactNumber(n):formatDamage(n)}</strong>${delta}`;slots.forEach(x=>x.innerHTML=markup);
}
function recalculate(){
  readInputs();
  syncDerivedEpicBonuses();
  readInputs();

  const any=Object.values(modeState().selectedIds).some(a=>a.length);

  if(isAnyEpicOptimizeMode()){
    if(epicWorker){epicWorker.terminate();epicWorker=null;closeOptimizerModal();}
    const errors=any?validate():[];showValidation(errors);const sig=!errors.length&&any?currentEpicEffectiveSignature():'';
    if(lastOptimizedEpicPayload&&lastOptimizedEpicSignature&&sig===lastOptimizedEpicSignature){epicResultCurrent=true;renderEpicOptimizedResult(lastOptimizedEpicPayload);setOptimizeButtonState();return;}
    epicResultCurrent=false;clearPrediction();
    els.resultGroups.hidden=true;
    els.resultEmpty.hidden=false;
    els.resultEmpty.textContent=any&&!errors.length?'Click Optimize Army to calculate quantities.':'Quantities appear in Total Battle mobile-entry order.';
    els.resultStatus.classList.remove('optimizing-status');
    els.resultStatus.textContent=!any?'Select units to build your stack.':errors.length?'Complete the required inputs.':'Ready to optimize.';
    resetCapacityRows();
    resetLayerHealthChart();
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
      const method=state.modes.battle.activeBattleMethod||'basic';
      if(method==='custom'){
        syncCustomOrders();
        if(battleType==='pvp_single_cp'){
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
      }else if(battleType==='epic_standard'||battleType==='epic_arachne'){
        result=calculateEpicStack({
          troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,
          selectedIds:modeState().selectedIds,inputs:{...inputs,arachne:battleType==='epic_arachne'}
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
    const canEpicScore=activeMode!=='battle'||bt==='epic_standard'||bt==='epic_arachne';
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
    els.resultStatus.textContent=activeMode==='battle'?`${count} calculated squad${count===1?'':'s'} · Battle Calculator Beta · mobile entry order`:`${count} calculated squad${count===1?'':'s'} · mobile entry order`;
    els.resultEmpty.hidden=true;els.resultGroups.hidden=false;
  }catch(error){
    console.error(error);showValidation([error.message||'The calculator could not complete the stack.']);clearResults('Calculation error.');
  }
}
function resetCalculator(){
  if(!confirm(`Reset all ${activeMode==='epic'?'Epic Stacker':activeMode==='optimizer'?'Epic Optimizer':activeMode==='battle'?'Battle Calculator Beta':'Custom Stacker'} inputs and selections on this device?`))return;
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
function resetAdvancedSettings(){const defaults=defaultInputs(activeMode),i=modeState().inputs;for(const id of ['monsterHealth','pvpHealth','monsterStrength','strengthAgainstEpic','pvpStrength','monsterDD','monsterST'])i[id]=defaults[id];i.useCustomFamilyBonuses=false;els.useCustomFamilyBonuses.checked=false;for(const id of ['monsterHealth','pvpHealth','monsterStrength','strengthAgainstEpic','pvpStrength','monsterDD','monsterST'])if(els[id])els[id].value=i[id];if(!isAnyEpicOptimizeMode()){i.rankSeparation=defaults.rankSeparation;els.rankSeparation.value=i.rankSeparation;updateRankSeparationDisplay();}syncDerivedEpicBonuses();saveState();recalculate();}
const STAT_HELP_BASE='assets/images/stat-help/';
const STAT_HELP={
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
function openStatHelp(key,trigger){
  const help=STAT_HELP[key],modal=document.getElementById('statHelpModal');if(!help||!modal)return;
  statHelpReturnFocus=trigger||document.activeElement;
  document.getElementById('statHelpTitle').textContent=help.title;
  document.getElementById('statHelpText').textContent=help.text;
  document.getElementById('statHelpGallery').innerHTML=help.images.map(([src,caption])=>`<figure class="stat-help-figure"><img alt="${escapeHtml(caption)}" loading="lazy" src="${STAT_HELP_BASE}${encodeURIComponent(src)}"/><figcaption>${escapeHtml(caption)}</figcaption></figure>`).join('');
  modal.hidden=false;document.body.classList.add('stat-help-modal-open');
  requestAnimationFrame(()=>modal.querySelector('.stat-help-close')?.focus());
}
function closeStatHelp(){
  const modal=document.getElementById('statHelpModal');if(!modal||modal.hidden)return;
  modal.hidden=true;document.body.classList.remove('stat-help-modal-open');
  const target=statHelpReturnFocus;statHelpReturnFocus=null;if(target&&typeof target.focus==='function')target.focus();
}
function wireStatHelp(){
  document.querySelectorAll('[data-stat-help]').forEach(button=>button.addEventListener('click',e=>{e.preventDefault();openStatHelp(button.dataset.statHelp,button);}));
  document.querySelectorAll('[data-stat-help-close]').forEach(button=>button.addEventListener('click',closeStatHelp));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.getElementById('statHelpModal')?.hidden)closeStatHelp();});
  document.querySelectorAll('[data-sacrifice-help-close]').forEach(el=>el.addEventListener('click',closeSacrificeHelp));
  document.getElementById('sacrificeHelpModal')?.querySelector('.sacrifice-help-backdrop')?.addEventListener('click',closeSacrificeHelp);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.getElementById('sacrificeHelpModal')?.hidden)closeSacrificeHelp();});
}

function wireEvents(){
  wireStatHelp();
  document.querySelectorAll('.mode-button').forEach(b=>b.addEventListener('click',()=>switchMode(b.dataset.mode)));
  els.clearAllSelections.addEventListener('click',clearAllSelections);
  els.resetCalculator.addEventListener('click',resetCalculator);

  const armyGroup=['leadership','authority','dominance'];
  for(const id of armyGroup){
    const input=els[id];
    input.addEventListener('focus',()=>{input.value=String(parseNumber(input.value)||'');requestAnimationFrame(()=>input.select());});
    input.addEventListener('pointerup',e=>{e.preventDefault();input.select();});
    input.addEventListener('keydown',e=>{
      if(e.key!=='Tab'&&e.key!=='Enter')return;
      e.preventDefault();
      const index=armyGroup.indexOf(id),step=e.shiftKey&&e.key==='Tab'?-1:1;
      const next=els[armyGroup[(index+step+armyGroup.length)%armyGroup.length]];
      next.focus();requestAnimationFrame(()=>next.select());
    });
    input.addEventListener('blur',()=>formatFieldInteger(input));
    input.addEventListener('input',()=>{
      if(id==='authority'&&isAnyEpicOptimizeMode()&&!modeState().inputs.includeMercenariesInOptimization){
        readInputs();
        recalculateAfterMercenaryOnlyChange();
        return;
      }
      recalculate();
    });
  }

  if(els.battleTypeSelect)els.battleTypeSelect.addEventListener('change',()=>{
    if(activeMode!=='battle')return;
    readInputs();saveState();
    const type=els.battleTypeSelect.value;
    let method=state.modes.battle.activeBattleMethod||'basic';
    if(type.startsWith('pvp_')&&method==='optimize')method='basic';
    state.modes.battle.activeBattleType=type;
    state.modes.battle.activeBattleMethod=method;
    ensureBattleWorkspace(type,method);
    loadSavedOptimizerResult();
    refreshActiveMode();
  });
  if(els.templeLevel)els.templeLevel.addEventListener('change',()=>{
    state.preferences.templeLevel=Math.max(1,Math.min(45,Number(els.templeLevel.value)||45));
    populateTempleLevel();
    saveState();
    // Temple does not change stack quantities or optimizer search. It changes
    // only the displayed revival costs, so a normal recalculation is enough.
    if(appInitialized)recalculate();
  });
  if(els.pvpEnemyUnitSelect)els.pvpEnemyUnitSelect.addEventListener('change',()=>{
    if(activeMode!=='battle'||state.modes.battle.activeBattleType!=='pvp_single_cp')return;
    modeState().inputs.enemyUnitId=els.pvpEnemyUnitSelect.value||'troop-g9-flying-corax-2';
    saveState();
    recalculate();
  });
  if(els.battleMethodSelect)els.battleMethodSelect.addEventListener('change',()=>{
    if(activeMode!=='battle')return;
    readInputs();saveState();
    const type=state.modes.battle.activeBattleType||'epic_standard';
    let method=els.battleMethodSelect.value;
    if(method==='optimize'&&type.startsWith('pvp_'))method='basic';
    state.modes.battle.activeBattleMethod=method;
    els.battleMethodSelect.value=method;
    ensureBattleWorkspace(type,method);
    loadSavedOptimizerResult();
    refreshActiveMode();
  });
  const advancedIds=[
    'monsterHealth','humanHealth','epicHunterHealth','pvpHealth',
    'monsterStrength','strengthAgainstEpic','pvpStrength','monsterDD','monsterST',
    'humanStrength','epicHunterStrength','humanDD','epicHunterDD','humanST','epicHunterST'
  ];
  const editableAdvancedOrder=()=>advancedIds.filter(id=>{
    const input=els[id];
    if(!input||input.disabled||input.readOnly||input.tabIndex<0)return false;
    const field=input.closest('.help-input-field');
    if(field?.hidden)return false;
    return input.offsetParent!==null;
  });
  for(const id of advancedIds){
    const input=els[id];if(!input)continue;
    input.addEventListener('focus',()=>requestAnimationFrame(()=>input.select()));
    input.addEventListener('pointerup',e=>{if(input.disabled||input.readOnly)return;e.preventDefault();input.select();});
    input.addEventListener('keydown',e=>{
      if((e.key!=='Tab'&&e.key!=='Enter')||input.disabled||input.readOnly)return;
      const order=editableAdvancedOrder();
      const index=order.indexOf(id);
      if(index<0||order.length<2)return;
      e.preventDefault();
      const step=e.shiftKey&&e.key==='Tab'?-1:1;
      const next=els[order[(index+step+order.length)%order.length]];
      next.focus();requestAnimationFrame(()=>next.select());
    });
    input.addEventListener('input',()=>{
      if(['monsterHealth','monsterStrength','monsterDD','monsterST'].includes(id))syncDerivedEpicBonuses();
      recalculate();
      // Persist the battle-type workspace immediately. This is especially
      // important for PvP-only fields because the browser may close without
      // ever firing blur/change.
      readInputs();
      saveState();
    });
    if(['pvpHealth','pvpStrength'].includes(id)){
      input.addEventListener('blur',()=>{
        input.value=String(parseNumber(input.value));
        readInputs();saveState();recalculate();
      });
    }
  }

  els.useCustomFamilyBonuses.addEventListener('change',()=>{
    if(activeMode!=='optimizer'){
      modeState().inputs.useCustomFamilyBonuses=els.useCustomFamilyBonuses.checked;
      syncDerivedEpicBonuses();
      recalculate();
      return;
    }

    // Capture the values actually used by the optimizer before changing
    // between derived/manual entry modes.
    readInputs();
    const before=currentEpicEffectiveSignature();

    modeState().inputs.useCustomFamilyBonuses=els.useCustomFamilyBonuses.checked;
    syncDerivedEpicBonuses();
    readInputs();
    saveState();

    const after=currentEpicEffectiveSignature();

    // Merely opening/closing the custom-family controls is not a calculation
    // change. Preserve the current optimized output when the effective values
    // are unchanged.
    if(before===after){
      if(lastOptimizedEpicSignature && after===lastOptimizedEpicSignature){
        epicResultCurrent=true;
      }
      setOptimizeButtonState();
      return;
    }

    recalculate();
  });

  for(const id of ['leadershipFill','authorityFill','dominanceFill']){
    els[id].addEventListener('input',()=>{
      if(id==='authorityFill'&&isAnyEpicOptimizeMode()&&!modeState().inputs.includeMercenariesInOptimization){
        readInputs();
        recalculateAfterMercenaryOnlyChange();
        return;
      }
      recalculate();
    });
    els[id].addEventListener('blur',()=>{
      formatFillPercent(els[id]);readInputs();
      if(id==='authorityFill'&&isAnyEpicOptimizeMode()&&!modeState().inputs.includeMercenariesInOptimization){
        recalculateAfterMercenaryOnlyChange();
        return;
      }
      recalculate();
    });
  }
  els.resetCustomOrderDefault?.addEventListener('click',resetCustomOrderToDefault);
  els.rankSeparation.addEventListener('input',()=>{updateRankSeparationDisplay();recalculate();});
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
  loadSavedState();
  if(activeMode==='battle')ensureBattleWorkspace();
  loadSavedOptimizerResult();
  applyStateToInputs();
  wireEvents();

  // Only an actual database request/parse failure should produce the
  // "unit database could not be loaded" message.
  try{
    await loadData();
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
