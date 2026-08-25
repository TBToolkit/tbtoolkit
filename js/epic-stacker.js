import { calculateEpicStack, calculateCategory, calculateCustomStack, calculateCustomCategory } from './epic-engine.mjs?v=91';
import { scoreEpicArmy } from './epic-combat-engine-v2.mjs?v=74';

const STORAGE_KEY='tbtoolkit.stackingCalculator.v17';
const LEGACY_EPIC_KEY='tbtoolkit.epicStacker.v2';
const OPTIMIZER_RESULT_KEY='tbtoolkit.epicOptimizer.lastResult.v1';
const CAPACITY_META={troop:{limit:'leadership',fill:'leadershipFill',auto:'autoLeadership'},mercenary:{limit:'authority',fill:'authorityFill',auto:'autoAuthority'},monster:{limit:'dominance',fill:'dominanceFill',auto:'autoDominance'}};
const units={troop:[],monster:[],mercenary:[]};let armyV2=[];const els={};let activeCategory='troop';let activeMode='epic';let activeView='troop';let resolvedFills={troop:1,monster:1,mercenary:1};
let epicWorker=null;let epicRequestId=0;let epicResultCurrent=false;let lastOptimizedEpicSignature='';let lastEpicRunDiagnostics=null;let lastOptimizedEpicPayload=null;
let appInitialized=false;let optimizerBestEldSoFar=0;
function defaultInputs(mode){return{
leadership:'',leadershipFill:'99.99',autoLeadership:true,
authority:'',authorityFill:'10.00',autoAuthority:false,
dominance:'',dominanceFill:'99.99',autoDominance:true,
monsterHealth:'1600',humanHealth:'1500',epicHunterHealth:'859',
monsterStrength:'2299.5',strengthAgainstEpic:'3225',monsterDD:'12',monsterST:'12',
humanStrength:'2199.5',epicHunterStrength:'1558.5',
humanDD:'12',epicHunterDD:'12',humanST:'7',epicHunterST:'7',
useCustomFamilyBonuses:false,useCustomHealthInputs:false,includeMercenariesInOptimization:false,
arachne:false,rankSeparation:mode==='optimizer'?'0.10':'0.05'};}
const state={modes:{
epic:{selectedIds:{troop:[],monster:[],mercenary:[]},inputs:defaultInputs('epic')},
optimizer:{selectedIds:{troop:[],monster:[],mercenary:[]},inputs:defaultInputs('optimizer')},
custom:{selectedIds:{troop:[],monster:[],mercenary:[]},inputs:defaultInputs('custom'),orders:{troop:[],monster:[],mercenary:[]}}
}};
function modeState(){return state.modes[activeMode];}
function cacheElements(){['leadership','leadershipFill','autoLeadership','authority','authorityFill','autoAuthority','dominance','dominanceFill','autoDominance','monsterHealth','humanHealth','epicHunterHealth','arachne','arachneRow','rankSeparation','rankSeparationValue','resetAdvancedSettings','resetCalculator','modeDescription','separationLabel','separationMin','separationMid','separationMax','orderView','troopOrderList','monsterOrderList','mercenaryOrderList','clearAllSelections','guardsmanSelection','specialistSelection','engineerSelection','monsterSelection','mercenarySelection','guardsmanCount','specialistCount','engineerCount','monsterCardCount','mercenaryCardCount','guardsmanMaster','specialistMaster','engineerMaster','monsterMaster','mercenaryMaster','validationBox','resultsView','resultStatus','resultEmpty','resultGroups','troopResults','monsterResults','mercenaryResults','leadershipBar','authorityBar','dominanceBar','leadershipActual','authorityActual','dominanceActual','layerChartPanel','overlapSummary','layerChartEmpty','layerChartScroll','layerHealthChart','layerChartTooltip','monsterStrength','strengthAgainstEpic','monsterDD','monsterST','humanStrength','epicHunterStrength','humanDD','epicHunterDD','humanST','epicHunterST','useCustomFamilyBonuses','epicPredictionPanel','expectedLifetimeDamage','rawGoldRevival','damagePerThousandGold','predictionMeta','predictionRows','customFamilyBonusFields','optimizeArmy','optimizeHelp','optimizerModal','optimizerProgressHeadline','optimizerProgressTrack','optimizerProgressBar','optimizerProgressPercent','optimizerProgressEvaluations','optimizerProgressDetail','optimizerProgressCurrentEld','optimizerProgressBestEld','cancelOptimization','useCustomHealthInputs','classicBattleDetails','classicBattleMeta','classicBattleRows','includeMercenariesInOptimization'].forEach(id=>els[id]=document.getElementById(id));}
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
    bonuses:{...(unit.bonuses||{})}
  };
}
async function loadData(){
  // Use a root-relative URL first so the database loads correctly even when
  // the calculator is reached through a clean/mobile route. Fall back to the
  // document-relative URL for static/local hosting.
  const sources=['/data/army-v2.json?v=94','data/army-v2.json?v=94'];
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
      return;
    }catch(error){lastError=error;}
  }
  throw lastError||new Error('Could not load canonical army database');
}
function loadSavedState(){
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if(saved?.modes){
      if(saved.modes.optimizer){
        activeMode=['epic','optimizer','custom'].includes(saved.activeMode)?saved.activeMode:'epic';
        for(const mode of ['epic','optimizer','custom']){
          Object.assign(state.modes[mode].inputs,saved.modes[mode]?.inputs||{});
          for(const c of ['troop','monster','mercenary']){
            if(Array.isArray(saved.modes[mode]?.selectedIds?.[c]))state.modes[mode].selectedIds[c]=saved.modes[mode].selectedIds[c];
            if(mode==='custom'&&Array.isArray(saved.modes.custom?.orders?.[c]))state.modes.custom.orders[c]=saved.modes.custom.orders[c];
          }
        }
        return;
      }

      // v56-v61 stored Epic Optimizer state under "epic".
      const previousOptimizer=saved.modes.epic;
      Object.assign(state.modes.optimizer.inputs,previousOptimizer?.inputs||{});
      for(const c of ['troop','monster','mercenary']){
        if(Array.isArray(previousOptimizer?.selectedIds?.[c])){
          state.modes.optimizer.selectedIds[c]=[...previousOptimizer.selectedIds[c]];
          state.modes.epic.selectedIds[c]=[...previousOptimizer.selectedIds[c]];
        }
      }

      // Seed classic Epic with the common player values but restore 0.40%.
      for(const key of ['leadership','leadershipFill','autoLeadership','authority','authorityFill','autoAuthority','dominance','dominanceFill','autoDominance','monsterHealth','humanHealth','epicHunterHealth','arachne']){
        if(previousOptimizer?.inputs?.[key]!==undefined)state.modes.epic.inputs[key]=previousOptimizer.inputs[key];
      }
      state.modes.epic.inputs.rankSeparation='0.05';

      Object.assign(state.modes.custom.inputs,saved.modes.custom?.inputs||{});
      for(const c of ['troop','monster','mercenary']){
        if(Array.isArray(saved.modes.custom?.selectedIds?.[c]))state.modes.custom.selectedIds[c]=saved.modes.custom.selectedIds[c];
        if(Array.isArray(saved.modes.custom?.orders?.[c]))state.modes.custom.orders[c]=saved.modes.custom.orders[c];
      }
      activeMode=saved.activeMode==='custom'?'custom':'optimizer';
      return;
    }

    const legacy=JSON.parse(localStorage.getItem(LEGACY_EPIC_KEY)||'null');
    if(legacy){
      Object.assign(state.modes.epic.inputs,legacy.inputs||{});
      for(const c of ['troop','monster','mercenary'])
        if(Array.isArray(legacy.selectedIds?.[c]))state.modes.epic.selectedIds[c]=legacy.selectedIds[c];
    }
  }catch(_){}
}
function saveState(){localStorage.setItem(STORAGE_KEY,JSON.stringify({activeMode,modes:state.modes}));}
function loadSavedOptimizerResult(){try{const saved=JSON.parse(localStorage.getItem(OPTIMIZER_RESULT_KEY)||'null');if(!saved?.payload||!saved?.signature)return;lastOptimizedEpicPayload=saved.payload;lastOptimizedEpicSignature=saved.signature;lastEpicRunDiagnostics=saved.runDiagnostics??null;}catch(error){console.warn('Could not restore saved Epic Optimizer result.',error);}}
function saveOptimizerResult(){try{if(!lastOptimizedEpicPayload||!lastOptimizedEpicSignature)return;localStorage.setItem(OPTIMIZER_RESULT_KEY,JSON.stringify({payload:lastOptimizedEpicPayload,signature:lastOptimizedEpicSignature,runDiagnostics:lastEpicRunDiagnostics,savedAt:Date.now()}));}catch(error){console.warn('Could not save Epic Optimizer result.',error);}}
function clearSavedOptimizerResult(){lastOptimizedEpicPayload=null;lastOptimizedEpicSignature='';lastEpicRunDiagnostics=null;localStorage.removeItem(OPTIMIZER_RESULT_KEY);}
function updateRankSeparationDisplay(){const max=.5;const v=Math.min(max,Math.max(0,parseNumber(els.rankSeparation?.value)));if(els.rankSeparationValue)els.rankSeparationValue.value=`${v.toFixed(2)}%`;}

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
  if(activeMode!=='optimizer')return'';
  const i=modeState().inputs;
  const selected={
    troop:[...(modeState().selectedIds.troop||[])].sort(),
    monster:[...(modeState().selectedIds.monster||[])].sort(),
    mercenary:i.includeMercenariesInOptimization?[...(modeState().selectedIds.mercenary||[])].sort():[]
  };
  const effective={
    selected,
    leadership:parseNumber(i.leadership),
    authority:parseNumber(i.authority),
    dominance:parseNumber(i.dominance),
    autoLeadership:!!i.autoLeadership,
    autoAuthority:!!i.autoAuthority,
    autoDominance:!!i.autoDominance,
    leadershipFill:parseNumber(i.leadershipFill),
    authorityFill:parseNumber(i.authorityFill),
    dominanceFill:parseNumber(i.dominanceFill),
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
  if(!els.optimizeArmy||activeMode!=='optimizer')return;
  if(!appInitialized){
    els.optimizeArmy.disabled=true;
    els.optimizeArmy.textContent='Optimize Army';
    els.optimizeHelp.textContent='Loading calculator data…';
    return;
  }
  const any=Object.values(modeState().selectedIds).some(a=>a.length);
  const errors=any?validate():[];
  els.optimizeArmy.disabled=!any||errors.length>0||!!epicWorker;
  els.optimizeArmy.textContent=epicResultCurrent?'Re-optimize Army':'Optimize Army';
  if(!any)els.optimizeHelp.textContent='Select the units you want to include.';
  else if(errors.length)els.optimizeHelp.textContent='Complete the required inputs before optimizing.';
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
  if(n>=1e12)return`${(n/1e12).toFixed(2)}T`;
  if(n>=1e9)return`${(n/1e9).toFixed(2)}B`;
  if(n>=1e6)return`${(n/1e6).toFixed(2)}M`;
  return Math.round(n).toLocaleString('en-US');
}
function clearPrediction(){
  if(els.epicPredictionPanel)els.epicPredictionPanel.hidden=true;
  if(els.predictionRows)els.predictionRows.innerHTML='';
}
function renderPrediction(opt){
  if(!opt?.result){clearPrediction();return;}const r=opt.result;els.epicPredictionPanel.hidden=false;els.expectedLifetimeDamage.textContent=formatDamage(r.expectedTotalLifetimeDamage);els.rawGoldRevival.textContent=Math.round(r.rawGoldRevivalCost).toLocaleString('en-US');const perThousand=r.rawGoldRevivalCost>0?r.expectedTotalLifetimeDamage/r.rawGoldRevivalCost*1000:0;els.damagePerThousandGold.textContent=formatDamage(perThousand);const minSep=r.separationSummary?.minPct;
  if(activeMode==='optimizer'){const improvement=opt.diagnostics?.improvementPct,run=lastEpicRunDiagnostics,buildText=run?` · Optimizer ${run.optimizerBuild} · Engine ${run.engineBuild} · ${run.armyDatabase}`:'',mercText=modeState().inputs.includeMercenariesInOptimization?' · Mercenaries included':' · Mercenaries excluded from optimization',epicTypeText=modeState().inputs.arachne?' · Arachne: 8 enemy squads':' · Standard Epic: 4 enemy squads',evalCount=opt.diagnostics?.totalEvaluations??opt.diagnostics?.evaluations,practicalLoss=Number(opt.diagnostics?.practicalTieBreakLossPct),practicalText=opt.diagnostics?.practicalTieBreakApplied?` · Practical near-optimal tie-break used (${practicalLoss<.001?'<'+'0.001':practicalLoss.toFixed(3)}% ELD below maximum)`:'';els.predictionMeta.textContent=`Two-initiative average · ${Number.isFinite(improvement)?`Optimizer gain vs best starting population: ${improvement.toFixed(2)}% · `:''}${Number.isFinite(minSep)?`Closest health spacing: ${minSep.toFixed(4)}% · `:''}${evalCount?.toLocaleString('en-US')??'—'} candidates evaluated · Multi-seed global search · Dynamic death & attack order${epicTypeText}${mercText}${practicalText}${buildText}`;}
  else{const label=activeMode==='epic'?'Epic Stacker':'Custom Stacker',epicTypeText=activeMode==='epic'&&modeState().inputs.arachne?' · Arachne: 8 enemy squads':' · Standard Epic: 4 enemy squads';els.predictionMeta.textContent=`${label} · Two-initiative average${Number.isFinite(minSep)?` · Closest health spacing: ${minSep.toFixed(4)}%`:''}${epicTypeText} · Full battle simulation using the displayed quantities.`;}
  const diagnosticNotes=new Map((opt.diagnostics?.unusualSacrifices??[]).map(n=>[String(n.id),n]));
  const rows=[...(r.squads??[])].sort((a,b)=>(a.predictedDeathPosition??999)-(b.predictedDeathPosition??999)||a.displayOrder-b.displayOrder);

  // Detection and counterfactual attribution are intentionally separate.
  // A productive squad can be visibly unusual even when the small final
  // counterfactual pass cannot find a feasible later-position comparison.
  const productive=rows.filter(s=>Number(s.expectedLifetimeDamage||0)>0&&Number(s.averageAttackOpportunities||0)>0);
  const damageValues=productive.map(s=>Number(s.expectedDamagePerOpportunity||0)).sort((a,b)=>a-b);
  const damageMedian=damageValues.length?damageValues[Math.floor(damageValues.length/2)]:0;
  const unusualMap=new Map();
  if(activeMode==='optimizer'){
    for(const s of rows){
      const death=Number(s.predictedDeathPosition??999);
      const productiveEarly=death<=4&&Number(s.expectedLifetimeDamage||0)>0&&Number(s.averageAttackOpportunities||0)>0;
      const meaningfulDamage=Number(s.expectedDamagePerOpportunity||0)>=damageMedian*.72;
      const normalSacrifice=String(s.combatType||'').toUpperCase()==='SIEGE';
      if(!productiveEarly||!meaningfulDamage||normalSacrifice)continue;
      const diagnostic=diagnosticNotes.get(String(s.id));
      unusualMap.set(String(s.id),diagnostic??{
        id:String(s.id),name:s.name,tier:s.tier,originalDeath:death,
        penaltyPct:null,classification:'unknown'
      });
    }
  }

  els.predictionRows.innerHTML=rows.map(s=>{
    const note=activeMode==='optimizer'?unusualMap.get(String(s.id)):null;
    const flag=note?` <button class="sacrifice-flag" type="button" data-sacrifice-id="${escapeHtml(String(s.id))}" aria-label="Explain unusual early death for ${escapeHtml(s.name)}" title="Why does this squad die early?">?</button>`:'';
    return `<tr><td>${escapeHtml(s.tier)} · ${escapeHtml(s.name)}${flag}</td><td>${formatInteger(s.quantity)}</td><td>${s.predictedDeathPosition??'—'}</td><td>${Number(s.averageAttackOpportunities||0).toFixed(1)}</td><td>${formatDamage(s.expectedDamagePerOpportunity)}</td><td>${formatDamage(s.expectedLifetimeDamage)}</td></tr>`;
  }).join('');
  if(activeMode==='optimizer'&&unusualMap.size){
    els.predictionRows.querySelectorAll('[data-sacrifice-id]').forEach(button=>button.addEventListener('click',()=>openSacrificeHelp(unusualMap.get(String(button.dataset.sacrificeId)))));
  }
}

function openSacrificeHelp(note){
  if(!note)return;
  const modal=document.getElementById('sacrificeHelpModal');if(!modal)return;
  const penalty=Number(note.penaltyPct);
  document.getElementById('sacrificeHelpTitle').textContent=`Why does ${note.tier} ${note.name} die early?`;
  let text='The optimizer compares expected damage from the whole army, not the survival of each squad by itself. Keeping this squad alive longer changes the death order and can reduce attack opportunities for other squads.';
  if(Number.isFinite(penalty)){
    const prefix=` A later death position was also tested. Moving this squad from death #${note.originalDeath} to about #${note.alternativeDeath}`;
    if(penalty<=0){
      text+=`${prefix} produced no measurable change in total expected lifetime damage.`;
    }else if(penalty<.001){
      text+=`${prefix} reduced total expected lifetime damage by less than 0.001%.`;
    }else{
      const pct=penalty<.01?penalty.toFixed(3):penalty<.1?penalty.toFixed(2):penalty.toFixed(1);
      if(note.classification==='marginal')text+=`${prefix} reduced total expected lifetime damage by only ${pct}%.`;
      else text+=`${prefix} reduced total expected lifetime damage by about ${pct}%.`;
    }
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
function renderEpicOptimizedResult(opt){
  const result=convertEpicV2Result(opt);
  renderResultRows('mercenary',result.categories.mercenary.results);
  renderResultRows('monster',result.categories.monster.results);
  renderResultRows('troop',result.categories.troop.results);
  updateCapacity(result);
  renderLayerHealthChart(result);
  renderPrediction(opt);
  const count=result.categories.troop.results.length+result.categories.monster.results.length+result.categories.mercenary.results.length;
  els.resultStatus.classList.remove('optimizing-status');
  els.resultStatus.textContent=`${count} optimized squad${count===1?'':'s'} · mobile entry order`;
  els.resultEmpty.hidden=true;
  els.resultGroups.hidden=false;
}
function startEpicOptimization(){
  if(activeMode!=='optimizer'||epicWorker)return;
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

  try{
    epicWorker=new Worker('js/epic-optimizer-worker.js?v=103');
  }catch(error){
    console.error(error);
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
        lastEpicRunDiagnostics=msg.diagnostics??null;
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
    closeOptimizerModal();
    els.resultStatus.classList.remove('optimizing-status');
    showValidation(['The Epic optimizer worker encountered an error.']);
    clearResults('Optimization error.');
    epicResultCurrent=false;
    setOptimizeButtonState();
  };
  epicWorker.postMessage({
    type:'optimize',requestId,
    selectedIds:[...modeState().selectedIds.troop,...modeState().selectedIds.monster,...(modeState().inputs.includeMercenariesInOptimization?modeState().selectedIds.mercenary:[])],
    bonuses:epicBonusPayload(),
    capacityLimits:effectiveEpicCapacityLimits()
  });
}
function configureModeUI(){
  const classic=activeMode==='epic';
  const optimizer=activeMode==='optimizer';
  const custom=activeMode==='custom';

  document.querySelectorAll('.mode-button').forEach(b=>{
    const on=b.dataset.mode===activeMode;
    b.classList.toggle('active',on);
    b.setAttribute('aria-pressed',String(on));
  });

  els.modeDescription.textContent=classic
    ?'Automatically orders selected squads for Epic battles using the Squad Separation setting.'
    : optimizer
      ?'Epic Optimizer calculates stack quantities for the units you select. It searches many possible army structures and uses simulated Epic battles to find the army with the highest expected lifetime damage. The optimizer considers unit health, strength, combat bonuses, Double Damage, Strike Twice, death order, attack order, and available army capacity.'
      :'You choose the death order by level. The calculator automatically orders unit types within each level.';

  els.orderView.hidden=!custom;
  els.arachneRow.hidden=custom;
  document.querySelectorAll('.optimizer-only').forEach(el=>el.hidden=!optimizer);
  document.querySelectorAll('.separation-mode-only').forEach(el=>el.hidden=optimizer);


  if(classic||custom){
    els.separationLabel.textContent='Squad Separation';
    els.rankSeparation.min='0';els.rankSeparation.max='0.5';els.rankSeparation.step='0.01';
    els.separationMin.textContent='0%';els.separationMid.textContent='0.25%';els.separationMax.textContent='0.50%';
  }

  const nums=document.querySelectorAll('.output-section-number');
  if(nums[0])nums[0].textContent=custom?'4':optimizer?'4':'3';
  if(nums[1])nums[1].textContent=custom?'5':optimizer?'5':'4';

  syncDerivedEpicBonuses();
  setOptimizeButtonState();
}
function applyStateToInputs(){
  const i=modeState().inputs;
  for(const id of ['leadership','authority','dominance','monsterHealth','humanHealth','epicHunterHealth','monsterStrength','strengthAgainstEpic','monsterDD','monsterST','humanStrength','epicHunterStrength','humanDD','epicHunterDD','humanST','epicHunterST']){
    if(!els[id])continue;
    els[id].value=i[id]??defaultInputs(activeMode)[id]??'';
  }
  for(const id of ['leadership','authority','dominance'])formatFieldInteger(els[id]);
  for(const id of ['leadershipFill','authorityFill','dominanceFill']){
    els[id].value=i[id]??'';
    formatFillPercent(els[id]);
  }
  els.rankSeparation.value=String(Math.min(.5,Math.max(0,parseNumber(i.rankSeparation??'0.05'))));
  for(const id of ['autoLeadership','autoAuthority','autoDominance'])els[id].checked=!!i[id];
  els.arachne.checked=!!i.arachne;
  els.useCustomFamilyBonuses.checked=!!i.useCustomFamilyBonuses;
  els.includeMercenariesInOptimization.checked=!!i.includeMercenariesInOptimization;
  configureModeUI();
  updateRankSeparationDisplay();
  updateFillFieldStates();
}
function readInputs(){
  const i=modeState().inputs;
  for(const id of ['leadership','authority','dominance','monsterHealth','humanHealth','epicHunterHealth','monsterStrength','strengthAgainstEpic','monsterDD','monsterST','humanStrength','epicHunterStrength','humanDD','epicHunterDD','humanST','epicHunterST']){
    if(els[id])i[id]=String(parseNumber(els[id].value));
  }
  i.rankSeparation=String(parseNumber(els.rankSeparation.value));
  for(const id of ['autoLeadership','autoAuthority','autoDominance'])i[id]=els[id].checked;
  for(const [cat,meta] of Object.entries(CAPACITY_META)){
    if(!i[meta.auto])i[meta.fill]=String(parseNumber(els[meta.fill].value));
  }
  i.arachne=els.arachne.checked;
  i.useCustomFamilyBonuses=!!els.useCustomFamilyBonuses?.checked;
  i.includeMercenariesInOptimization=!!els.includeMercenariesInOptimization?.checked;
  saveState();
}
function updateFillFieldStates(){for(const [cat,meta] of Object.entries(CAPACITY_META)){const auto=!!modeState().inputs[meta.auto];els[meta.fill].disabled=auto;if(!auto)els[meta.fill].value=modeState().inputs[meta.fill]??'99.99';}}

function troopLevelCompare(a,b){const ma=/^([GSE])(\d+)$/.exec(a),mb=/^([GSE])(\d+)$/.exec(b);if(!ma||!mb)return a.localeCompare(b);const tier=Number(mb[2])-Number(ma[2]);if(tier)return tier;return({G:0,S:1,E:2}[ma[1]]??9)-({G:0,S:1,E:2}[mb[1]]??9);}
function monsterLevelCompare(a,b){return parseInt(b.slice(1))-parseInt(a.slice(1));}
function mercLevelCompare(a,b){const [na,ca]=a.split('-'),[nb,cb]=b.split('-');const tierOrder=[2,7,6,5];const ia=tierOrder.indexOf(Number(na)),ib=tierOrder.indexOf(Number(nb));if(ia!==ib)return (ia<0?99:ia)-(ib<0?99:ib);const classOrder=['COM','MNST','SPCL','GRD','EMH','EX','ARNE','ENG'];return classOrder.indexOf(ca)-classOrder.indexOf(cb);}
function getLevelRows(category){const map=new Map();for(const u of units[category]){if(!map.has(u.level))map.set(u.level,[]);map.get(u.level).push(u);}let levels=[...map.keys()];levels.sort(category==='troop'?troopLevelCompare:category==='monster'?monsterLevelCompare:mercLevelCompare);return levels.map(level=>({level,rows:map.get(level).sort((a,b)=>b.strengthEach-a.strengthEach||a.name.localeCompare(b.name))}));}
function selectedSet(category){return new Set(modeState().selectedIds[category]);}
function selectedIdsFor(category){return modeState().selectedIds[category];}
function selectedLevels(category){const ids=new Set(selectedIdsFor(category)),levels=[];for(const group of getLevelRows(category))if(group.rows.some(u=>ids.has(u.id)))levels.push(group.level);return levels;}
function syncCustomOrders(){const c=state.modes.custom;for(const category of ['troop','monster','mercenary']){const sel=selectedLevels(category),set=new Set(sel),next=(c.orders[category]||[]).filter(l=>set.has(l));for(const l of sel)if(!next.includes(l))next.push(l);c.orders[category]=next;}}
function moveOrderItem(category,index,delta){const a=state.modes.custom.orders[category],j=index+delta;if(j<0||j>=a.length)return;[a[index],a[j]]=[a[j],a[index]];saveState();renderOrderView();recalculate();}
function reorderByDrop(category,from,to){const a=state.modes.custom.orders[category];if(from===to||from<0||to<0)return;const[item]=a.splice(from,1);a.splice(to,0,item);saveState();renderOrderView();recalculate();}
function commitOrderFromDom(category,target){
  const levels=[...target.querySelectorAll('.order-item')].map(el=>el.dataset.level);
  state.modes.custom.orders[category]=levels;
  saveState();
  recalculate();
}

function renderOrderView(){
  syncCustomOrders();
  const ids={troop:'troopOrderList',monster:'monsterOrderList',mercenary:'mercenaryOrderList'};

  for(const category of ['troop','monster','mercenary']){
    const target=els[ids[category]];
    const order=state.modes.custom.orders[category];
    const selected=new Set(state.modes.custom.selectedIds[category]);
    target.innerHTML='';

    if(!order.length){
      target.innerHTML='<div class="order-empty">Select units to create an order.</div>';
      continue;
    }

    order.forEach((level,index)=>{
      const count=units[category].filter(u=>u.level===level&&selected.has(u.id)).length;
      const row=document.createElement('div');
      row.className='order-item';
      row.draggable=true;
      row.dataset.level=level;

      const colors=orderRowColors(category,level);
      row.style.setProperty('--order-row-color',colors.rowColor);
      row.style.setProperty('--order-accent',colors.accent);

      row.innerHTML=`<div class="drag-handle" title="Drag to reorder">☰</div>
        <div class="order-copy"><strong>${escapeHtml(level)}</strong><span>${count} selected unit${count===1?'':'s'}</span></div>
        <button class="order-move" type="button" aria-label="Move ${escapeHtml(level)} up">↑</button>
        <button class="order-move" type="button" aria-label="Move ${escapeHtml(level)} down">↓</button>`;

      const btn=row.querySelectorAll('button');
      btn[0].addEventListener('click',()=>moveOrderItem(category,index,-1));
      btn[1].addEventListener('click',()=>moveOrderItem(category,index,1));

      row.addEventListener('dragstart',e=>{
        row.classList.add('dragging');
        target.classList.add('drag-active');
        e.dataTransfer.effectAllowed='move';
        e.dataTransfer.setData('text/plain',level);
      });

      row.addEventListener('dragend',()=>{
        row.classList.remove('dragging');
        target.classList.remove('drag-active');
        target.querySelectorAll('.order-item').forEach(el=>el.classList.remove('drag-over'));
        commitOrderFromDom(category,target);
      });

      target.appendChild(row);
    });

    target.addEventListener('dragover',e=>{
      e.preventDefault();
      const dragging=target.querySelector('.order-item.dragging');
      if(!dragging)return;

      const siblings=[...target.querySelectorAll('.order-item:not(.dragging)')];
      siblings.forEach(el=>el.classList.remove('drag-over'));

      let insertBefore=null;
      for(const sibling of siblings){
        const rect=sibling.getBoundingClientRect();
        const midpoint=rect.top+rect.height/2;
        if(e.clientY<midpoint){
          insertBefore=sibling;
          sibling.classList.add('drag-over');
          break;
        }
      }

      if(insertBefore){
        if(dragging.nextSibling!==insertBefore)target.insertBefore(dragging,insertBefore);
      }else{
        target.appendChild(dragging);
      }
    });
  }
}
const expandedSelectionSections=new Set();
const MERC_LEVEL_LABEL={2:'II',7:'VII',6:'VI',5:'V'};
const MERC_GROUP_ORDER=['COMMON','MONSTER','SPECIALIST','GUARDSMAN','EPIC - HUNTER','EPIC - EVENT','ARACHNE','ENGINEER'];
const MERC_GROUP_LABEL={'COMMON':'Common','MONSTER':'Monsters','SPECIALIST':'Specialists','GUARDSMAN':'Guardsmen','EPIC - HUNTER':'Epic Hunters','EPIC - EVENT':'Epic Event','ARACHNE':'Arachne','ENGINEER':'Engineers'};

function setSelection(category,rows,checked){
  const set=selectedSet(category);
  for(const unit of rows)checked?set.add(unit.id):set.delete(unit.id);
  modeState().selectedIds[category]=[...set];
  syncCustomOrders();saveState();updateCounts();renderAllSelections();
  if(activeMode==='custom')renderOrderView();
  recalculate();
}
function setOneSelection(category,id,checked){
  const set=selectedSet(category);checked?set.add(id):set.delete(id);
  modeState().selectedIds[category]=[...set];
  syncCustomOrders();saveState();updateCounts();renderAllSelections();
  if(activeMode==='custom')renderOrderView();
  recalculate();
}
function clearAllSelections(){
  modeState().selectedIds={troop:[],monster:[],mercenary:[]};
  if(activeMode==='custom')state.modes.custom.orders={troop:[],monster:[],mercenary:[]};
  saveState();updateCounts();renderAllSelections();if(activeMode==='custom')renderOrderView();recalculate();
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
    if(activeMode==='custom')renderOrderView();
  }
  return changed;
}
function refreshAfterBrowserRestore(){
  if(!appInitialized)return;
  reconcileSelectionsFromRenderedUI();
  recalculate();
  setOptimizeButtonState();
}


function baseEngineInputs(){const i=modeState().inputs;return{leadership:parseNumber(i.leadership),leadershipFill:parseNumber(i.leadershipFill)/100,authority:parseNumber(i.authority),authorityFill:parseNumber(i.authorityFill)/100,dominance:parseNumber(i.dominance),dominanceFill:parseNumber(i.dominanceFill)/100,arachne:activeMode==='epic'&&!!i.arachne,healthInputs:{MONSTER:parseNumber(i.monsterHealth),HUMAN:parseNumber(i.humanHealth),EPIC_HUNTER:parseNumber(i.epicHunterHealth)},rankSeparation:parseNumber(i.rankSeparation)/100,layerSeparation:parseNumber(i.rankSeparation)/100};}
function categoryProbe(category,fill,inputs){const meta=CAPACITY_META[category],probeInputs={...inputs,[meta.fill]:fill};if(activeMode==='custom'){syncCustomOrders();return calculateCustomCategory({category,units:units[category],selectedIds:selectedIdsFor(category),inputs:probeInputs,order:state.modes.custom.orders[category]});}return calculateCategory({category,units:units[category],selectedIds:selectedIdsFor(category),inputs:probeInputs});}
function findMaxSafeFill(category,inputs){const meta=CAPACITY_META[category],limit=inputs[meta.limit];if(!modeState().selectedIds[category].length||!(limit>0))return 1;const full=categoryProbe(category,1,inputs);if(full.totalCapacity<=limit)return 1;let low=0,high=1;for(let i=0;i<55;i++){const mid=(low+high)/2;const r=categoryProbe(category,mid,inputs);if(r.totalCapacity<=limit)low=mid;else high=mid;}return low;}
function resolveAutoFills(inputs){
  for(const [cat,meta] of Object.entries(CAPACITY_META)){
    if(modeState().inputs[meta.auto]){
      if(activeMode==='optimizer'){
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
    for(const [key,label] of [['monsterStrength','Monster Strength'],['strengthAgainstEpic','Strength Against Epic']]){
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
    const sep=parseNumber(modeState().inputs.rankSeparation);
    const maxSep=.5;
    if(sep<0||sep>maxSep)errors.push(`Squad separation must be between 0% and ${maxSep}%.`);
  }

  if(modeState().selectedIds.troop.length&&!(inp.leadership>0))errors.push('Enter Leadership for selected Troops.');
  if(modeState().selectedIds.monster.length&&!(inp.dominance>0))errors.push('Enter Dominance for selected Monsters.');
  if(modeState().selectedIds.mercenary.length&&(activeMode!=='optimizer'||modeState().inputs.includeMercenariesInOptimization)&&!(inp.authority>0))errors.push('Enter Authority for selected Mercenaries.');

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
}
function renderClassicBattleDetails(result){
  if(activeMode==='optimizer'||!els.classicBattleDetails){clearClassicBattleDetails();return;}
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

  els.classicBattleMeta.textContent=activeMode==='epic'
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
function updateCapacity(result){for(const [name,actual,limit] of [['leadership',result?.totals.leadership,parseNumber(modeState().inputs.leadership)],['authority',result?.totals.authority,parseNumber(modeState().inputs.authority)],['dominance',result?.totals.dominance,parseNumber(modeState().inputs.dominance)]]){const bar=els[`${name}Bar`],fill=bar.querySelector('i'),pct=limit>0&&Number.isFinite(actual)?actual/limit:0;fill.style.width=`${Math.min(Math.max(pct*100,0),100)}%`;bar.classList.toggle('over',pct>1);els[`${name}Actual`].textContent=actual==null?'—':`${formatInteger(actual)} / ${limit?formatInteger(limit):'—'}${limit?` · ${(pct*100).toFixed(2)}%`:''}`;}}
function recalculate(){
  readInputs();
  syncDerivedEpicBonuses();
  readInputs();

  const any=Object.values(modeState().selectedIds).some(a=>a.length);

  if(activeMode==='optimizer'){
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

  if(!any){showValidation([]);clearResults('Select units to build your stack.');return;}
  const errors=validate();showValidation(errors);
  if(errors.length){clearResults('Complete the required inputs.');return;}
  cancelEpicOptimization();

  try{
    const inputs=resolveAutoFills(baseEngineInputs());
    let result;

    if(activeMode==='epic'){
      result=calculateEpicStack({
        troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,
        selectedIds:modeState().selectedIds,inputs
      });
    }else{
      syncCustomOrders();
      result=calculateCustomStack({
        troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,
        selectedIds:modeState().selectedIds,orders:state.modes.custom.orders,inputs
      });
    }

    renderResultRows('mercenary',result.categories.mercenary.results);
    renderResultRows('monster',result.categories.monster.results);
    renderResultRows('troop',result.categories.troop.results);
    updateCapacity(result);const scored=scoreClassicResult(result);if(scored){renderLayerHealthChart(convertEpicV2Result(scored));renderPrediction(scored);}else{renderLayerHealthChart(result);clearPrediction();}

    const count=result.categories.troop.results.length+result.categories.monster.results.length+result.categories.mercenary.results.length;
    els.resultStatus.textContent=`${count} calculated squad${count===1?'':'s'} · mobile entry order`;
    els.resultEmpty.hidden=true;els.resultGroups.hidden=false;
  }catch(error){
    console.error(error);showValidation([error.message||'The calculator could not complete the stack.']);clearResults('Calculation error.');
  }
}
function resetCalculator(){if(!confirm(`Reset all ${activeMode==='epic'?'Epic Stacker':activeMode==='optimizer'?'Epic Optimizer':'Custom Stacker'} inputs and selections on this device?`))return;if(activeMode==='optimizer')clearSavedOptimizerResult();state.modes[activeMode].selectedIds={troop:[],monster:[],mercenary:[]};state.modes[activeMode].inputs=defaultInputs(activeMode);if(activeMode==='custom')state.modes.custom.orders={troop:[],monster:[],mercenary:[]};saveState();applyStateToInputs();syncCustomOrders();renderAllSelections();if(activeMode==='custom')renderOrderView();clearResults();}
function refreshActiveMode({save=true}={}){
  configureModeUI();
  applyStateToInputs();
  syncCustomOrders();
  renderAllSelections();
  if(activeMode==='custom')renderOrderView();
  syncDerivedEpicBonuses();
  readInputs();
  if(save)saveState();

  if(activeMode==='optimizer'){
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
  readInputs();
  activeMode=mode;
  refreshActiveMode();
}
function resetAdvancedSettings(){const defaults=defaultInputs(activeMode),i=modeState().inputs;for(const id of ['monsterHealth','monsterStrength','strengthAgainstEpic','monsterDD','monsterST'])i[id]=defaults[id];i.useCustomFamilyBonuses=false;els.useCustomFamilyBonuses.checked=false;for(const id of ['monsterHealth','monsterStrength','strengthAgainstEpic','monsterDD','monsterST'])els[id].value=i[id];if(activeMode!=='optimizer'){i.rankSeparation=defaults.rankSeparation;els.rankSeparation.value=i.rankSeparation;updateRankSeparationDisplay();}syncDerivedEpicBonuses();saveState();recalculate();}
const STAT_HELP_BASE='assets/images/stat-help/';
const STAT_HELP={
  monsterHealth:{title:'Monster Health',text:'Open one of your Monster squads, then copy the Health percentage shown in the Bonuses section.',images:[['monster-click.webp','1. Open a Monster squad.'],['monster-health.webp','2. Copy the Health value.']]},
  humanHealth:{title:'Human Health',text:'Open one of your Human troops, then copy the Health percentage shown in the Bonuses section.',images:[['human-click.webp','1. Open a Human troop.'],['human-health.webp','2. Copy the Health value.']]},
  epicHunterHealth:{title:'Epic Hunter Health',text:'Open your Superior Epic Monster Hunter, then copy the Health percentage shown in the Bonuses section.',images:[['epic-hunter-click.webp','1. Open the Epic Hunter squad.'],['epic-hunter-health.webp','2. Copy the Health value.']]},
  monsterStrength:{title:'Monster Strength',text:'Open one of your Monster squads, then copy the Strength percentage shown in the Bonuses section.',images:[['monster-click.webp','1. Open a Monster squad.'],['monster-strength.webp','2. Copy the Strength value.']]},
  strengthAgainstEpic:{title:'Strength Against Epic',text:'Copy “Strength of your entire army against epic monsters.” It is an entire-army bonus, so the same value appears on Monster, Human, and Epic Hunter detail screens.',images:[['monster-epic-strength.webp','Monster example'],['human-epic-strength.webp','Human example'],['epic-hunter-epic-strength.webp','Epic Hunter example']]},
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
    input.addEventListener('input',recalculate);
  }

  const advancedIds=['monsterHealth','humanHealth','epicHunterHealth','monsterStrength','strengthAgainstEpic','monsterDD','monsterST','humanStrength','epicHunterStrength','humanDD','epicHunterDD','humanST','epicHunterST'];
  const editableAdvancedOrder=()=>advancedIds.filter(id=>els[id]&&!els[id].disabled&&!els[id].readOnly&&els[id].offsetParent!==null);
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
    });
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
    els[id].addEventListener('input',recalculate);
    els[id].addEventListener('blur',()=>{formatFillPercent(els[id]);readInputs();recalculate();});
  }
  els.rankSeparation.addEventListener('input',()=>{updateRankSeparationDisplay();recalculate();});
  els.resetAdvancedSettings.addEventListener('click',resetAdvancedSettings);
  for(const id of ['autoLeadership','autoAuthority','autoDominance']){
    els[id].addEventListener('change',()=>{readInputs();updateFillFieldStates();recalculate();});
  }
  els.arachne.addEventListener('change',recalculate);
  els.includeMercenariesInOptimization.addEventListener('change',()=>{
    modeState().inputs.includeMercenariesInOptimization=els.includeMercenariesInOptimization.checked;
    saveState();recalculate();
  });
  els.optimizeArmy.addEventListener('click',startEpicOptimization);
  els.cancelOptimization.addEventListener('click',()=>{
    if(epicWorker){epicWorker.terminate();epicWorker=null;}
    closeOptimizerModal();
    els.resultStatus.classList.remove('optimizing-status');
    els.resultStatus.textContent='Optimization cancelled.';
    epicResultCurrent=false;
    setOptimizeButtonState();
  });
}
async function init(){
  cacheElements();
  loadSavedState();
  loadSavedOptimizerResult();
  applyStateToInputs();
  wireEvents();
  try{
    await loadData();
    appInitialized=true;

    // Use the exact same synchronization path on first load that is used
    // after a calculator-mode change. This prevents startup-only state drift.
    refreshActiveMode({save:false});

    // Some mobile browsers restore form/control state after the first script
    // pass. Reassert the active calculator state after the first rendered
    // frame, then once more shortly afterward as a defensive fallback.
    requestAnimationFrame(()=>{
      if(!appInitialized)return;
      refreshAfterBrowserRestore();
      setTimeout(refreshAfterBrowserRestore,150);
      setTimeout(refreshAfterBrowserRestore,600);
    });
  }catch(error){
    console.error(error);
    appInitialized=false;
    setOptimizeButtonState();
    showValidation(['The unit database could not be loaded. Refresh the page and try again.']);
  }
}
window.addEventListener('pageshow',()=>{
  requestAnimationFrame(()=>{
    refreshAfterBrowserRestore();
    setTimeout(refreshAfterBrowserRestore,150);
  });
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible')setTimeout(refreshAfterBrowserRestore,0);
});
init();
