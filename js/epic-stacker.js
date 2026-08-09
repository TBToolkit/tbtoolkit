import { calculateEpicStack, calculateCategory, calculateCustomStack, calculateCustomCategory } from './epic-engine.mjs?v=24';

const STORAGE_KEY='tbtoolkit.stackingCalculator.v17';
const LEGACY_EPIC_KEY='tbtoolkit.epicStacker.v2';
const DATA_URLS={troop:'data/troops.json',monster:'data/monsters.json',mercenary:'data/mercenaries.json'};
const CAPACITY_META={troop:{limit:'leadership',fill:'leadershipFill',auto:'autoLeadership'},mercenary:{limit:'authority',fill:'authorityFill',auto:'autoAuthority'},monster:{limit:'dominance',fill:'dominanceFill',auto:'autoDominance'}};
const units={troop:[],monster:[],mercenary:[]};const els={};let activeCategory='troop';let activeMode='epic';let activeView='troop';let resolvedFills={troop:1,monster:1,mercenary:1};
function defaultInputs(mode){return{leadership:'',leadershipFill:'99.99',autoLeadership:true,authority:'',authorityFill:'10.00',autoAuthority:false,dominance:'',dominanceFill:'99.99',autoDominance:true,monsterHealth:'',humanHealth:'',epicHunterHealth:'',arachne:false,rankSeparation:mode==='epic'?'0.40':'2.50'};}
const state={modes:{epic:{selectedIds:{troop:[],monster:[],mercenary:[]},inputs:defaultInputs('epic')},custom:{selectedIds:{troop:[],monster:[],mercenary:[]},inputs:defaultInputs('custom'),orders:{troop:[],monster:[],mercenary:[]}}}};
function modeState(){return state.modes[activeMode];}
function cacheElements(){['leadership','leadershipFill','autoLeadership','authority','authorityFill','autoAuthority','dominance','dominanceFill','autoDominance','monsterHealth','humanHealth','epicHunterHealth','arachne','arachneRow','rankSeparation','rankSeparationValue','resetRankSeparation','resetCalculator','modeDescription','separationLabel','separationMin','separationMid','separationMax','orderTab','orderView','troopOrderList','monsterOrderList','mercenaryOrderList','unitSelectGrid','selectionContent','categoryToolbar','clearCategory','troopCount','monsterCount','mercenaryCount','validationBox','resultsView','resultStatus','resultEmpty','resultGroups','troopResults','monsterResults','mercenaryResults','leadershipBar','authorityBar','dominanceBar','leadershipActual','authorityActual','dominanceActual','layerChartPanel','overlapSummary','layerChartEmpty','layerChartScroll','layerHealthChart','layerChartTooltip'].forEach(id=>els[id]=document.getElementById(id));}
function parseNumber(value){const x=Number(String(value??'').replace(/[%,$\s]/g,'').replace(/,/g,''));return Number.isFinite(x)?x:0;}
function formatInteger(value){return Math.round(parseNumber(value)).toLocaleString('en-US');}
function formatFieldInteger(el){const n=parseNumber(el.value);el.value=n?Math.round(n).toLocaleString('en-US'):'';}
function formatFillPercent(el){const n=parseNumber(el.value);el.value=Number.isFinite(n)?n.toFixed(2):'0.00';}
const TIER_COLORS={9:'#365f2e',8:'#4e5960',7:'#8c681f',6:'#87382e',5:'#865426',4:'#533d73',3:'#315f78',2:'#4e6d32',1:'#626863'};
function hexToRgb(hex){const s=hex.replace('#','');return[parseInt(s.slice(0,2),16),parseInt(s.slice(2,4),16),parseInt(s.slice(4,6),16)];}
function mixHex(hex1,hex2,amount){const a=hexToRgb(hex1),b=hexToRgb(hex2),c=a.map((v,i)=>Math.round(v+(b[i]-v)*amount));return`#${c.map(v=>v.toString(16).padStart(2,'0')).join('')}`;}
function tierNumber(level){const m=String(level||'').match(/\d+/);return m?Number(m[0]):0;}
const MERC_SUBTYPE_LIGHTEN={MNST:0,COM:.06,SPCL:.12,GRD:.18,EMH:.24,EX:.30,ARNE:.36,ENG:.42};
function mercSubtype(level){const parts=String(level||'').toUpperCase().split('-');return parts.length>1?parts.slice(1).join('-'):'';}
function outputRowColors(category,row){const tier=tierNumber(row.level);let base=TIER_COLORS[tier]||'#34495a';if(category==='troop'){const meta=units.troop.find(u=>u.id===row.id),cls=String(meta?.class||'').toUpperCase(),lighten=cls==='SPECIALIST'?.16:cls==='ENGINEER'?.30:0;base=mixHex(base,'#ffffff',lighten);}else if(category==='mercenary'){const subtype=mercSubtype(row.level),lighten=MERC_SUBTYPE_LIGHTEN[subtype]??0;base=mixHex(base,'#ffffff',lighten);}const rowColor=mixHex(base,'#061725',.42),accent=mixHex(base,'#ffffff',.22);return{rowColor,accent};}

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
function escapeHtml(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
function iconFallback(img){img.onerror=()=>{if(img.dataset.fallback)return;img.dataset.fallback='1';img.src='assets/unit-icons/missing-icon.svg';img.classList.add('missing-icon');};}

async function loadData(){const entries=await Promise.all(Object.entries(DATA_URLS).map(async([k,url])=>{const r=await fetch(url,{cache:'no-cache'});if(!r.ok)throw new Error(`Could not load ${url}`);return[k,await r.json()];}));entries.forEach(([k,v])=>units[k]=v);}
function loadSavedState(){try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(saved?.modes){activeMode=saved.activeMode==='custom'?'custom':'epic';for(const mode of ['epic','custom']){Object.assign(state.modes[mode].inputs,saved.modes[mode]?.inputs||{});for(const c of ['troop','monster','mercenary']){if(Array.isArray(saved.modes[mode]?.selectedIds?.[c]))state.modes[mode].selectedIds[c]=saved.modes[mode].selectedIds[c];if(mode==='custom'&&Array.isArray(saved.modes.custom?.orders?.[c]))state.modes.custom.orders[c]=saved.modes.custom.orders[c];}}return;}const legacy=JSON.parse(localStorage.getItem(LEGACY_EPIC_KEY)||'null');if(legacy){Object.assign(state.modes.epic.inputs,legacy.inputs||{});for(const c of ['troop','monster','mercenary'])if(Array.isArray(legacy.selectedIds?.[c]))state.modes.epic.selectedIds[c]=legacy.selectedIds[c];}}catch(_){}}
function saveState(){localStorage.setItem(STORAGE_KEY,JSON.stringify({activeMode,modes:state.modes}));}
function updateRankSeparationDisplay(){const max=activeMode==='epic'?1:5;const v=Math.min(max,Math.max(0,parseNumber(els.rankSeparation?.value)));if(els.rankSeparationValue)els.rankSeparationValue.value=`${v.toFixed(2)}%`;}
function configureModeUI(){const epic=activeMode==='epic';document.querySelectorAll('.mode-button').forEach(b=>{const on=b.dataset.mode===activeMode;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});els.modeDescription.textContent=epic?'Automatically orders selected squads for Epic battles.':'You control the layer dying order; unit-type order inside each layer remains automatic.';els.orderTab.hidden=epic;els.arachneRow.hidden=!epic;els.separationLabel.textContent=epic?'Squad Separation':'Layer Separation';els.rankSeparation.min='0';els.rankSeparation.max=epic?'1':'5';els.rankSeparation.step=epic?'0.01':'0.05';els.separationMin.textContent='0%';els.separationMid.textContent=epic?'0.50%':'2.50%';els.separationMax.textContent=epic?'1.00%':'5.00%';}
function applyStateToInputs(){for(const id of ['leadership','authority','dominance','monsterHealth','humanHealth','epicHunterHealth']){els[id].value=modeState().inputs[id]||'';formatFieldInteger(els[id]);}for(const id of ['leadershipFill','authorityFill','dominanceFill']){els[id].value=modeState().inputs[id]??'';formatFillPercent(els[id]);}const sepMax=activeMode==='epic'?1:5;els.rankSeparation.value=String(Math.min(sepMax,Math.max(0,parseNumber(modeState().inputs.rankSeparation??(activeMode==='epic'?'0.40':'2.50')))));for(const id of ['autoLeadership','autoAuthority','autoDominance'])els[id].checked=!!modeState().inputs[id];els.arachne.checked=!!modeState().inputs.arachne;configureModeUI();updateRankSeparationDisplay();updateFillFieldStates();}
function readInputs(){for(const id of ['leadership','authority','dominance','monsterHealth','humanHealth','epicHunterHealth'])modeState().inputs[id]=String(parseNumber(els[id].value)||'');for(const id of ['rankSeparation'])modeState().inputs[id]=String(parseNumber(els[id].value));for(const id of ['autoLeadership','autoAuthority','autoDominance'])modeState().inputs[id]=els[id].checked;for(const [cat,meta] of Object.entries(CAPACITY_META)){if(!modeState().inputs[meta.auto])modeState().inputs[meta.fill]=String(parseNumber(els[meta.fill].value));}modeState().inputs.arachne=els.arachne.checked;saveState();}
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
function updateCounts(){for(const c of ['troop','monster','mercenary'])els[`${c}Count`].textContent=modeState().selectedIds[c].length;}
function renderSelectionGrid(){const selected=selectedSet(activeCategory);els.unitSelectGrid.innerHTML='';for(const group of getLevelRows(activeCategory)){const wrap=document.createElement('section');wrap.className='unit-level-row';const allSelected=group.rows.length&&group.rows.every(u=>selected.has(u.id));const someSelected=group.rows.some(u=>selected.has(u.id));const side=document.createElement('label');side.className='level-selector';side.innerHTML=`<input type="checkbox" ${allSelected?'checked':''}><div><strong>${escapeHtml(group.level)}</strong><span>Select all</span></div>`;const cb=side.querySelector('input');cb.indeterminate=!allSelected&&someSelected;cb.addEventListener('change',()=>toggleLevel(group.rows,cb.checked));wrap.appendChild(side);const cards=document.createElement('div');cards.className='level-cards';for(const unit of group.rows){const label=document.createElement('label');const isSelected=selected.has(unit.id);label.className=`unit-option${isSelected?' selected':''}`;label.innerHTML=`<input type="checkbox" ${isSelected?'checked':''}><img src="${escapeHtml(unit.icon)}" alt=""><div class="unit-copy"><div class="unit-type">${escapeHtml(unit.type)}</div><div class="unit-name" title="${escapeHtml(unit.name)}">${escapeHtml(unit.name)}</div><div class="unit-strength">Strength/EA ${formatInteger(unit.strengthEach)}</div></div>`;iconFallback(label.querySelector('img'));label.querySelector('input').addEventListener('change',e=>toggleUnit(unit.id,e.target.checked));cards.appendChild(label);}wrap.appendChild(cards);els.unitSelectGrid.appendChild(wrap);}}
function toggleUnit(id,checked){const set=selectedSet(activeCategory);checked?set.add(id):set.delete(id);modeState().selectedIds[activeCategory]=[...set];syncCustomOrders();saveState();updateCounts();renderSelectionGrid();if(activeMode==='custom'&&activeView==='order')renderOrderView();recalculate();}
function toggleLevel(rows,checked){const set=selectedSet(activeCategory);for(const u of rows)checked?set.add(u.id):set.delete(u.id);modeState().selectedIds[activeCategory]=[...set];syncCustomOrders();saveState();updateCounts();renderSelectionGrid();if(activeMode==='custom'&&activeView==='order')renderOrderView();recalculate();}
function clearCurrent(){modeState().selectedIds[activeCategory]=[];syncCustomOrders();saveState();updateCounts();renderSelectionGrid();if(activeMode==='custom'&&activeView==='order')renderOrderView();recalculate();}
function setView(view){const unitView=['troop','monster','mercenary'].includes(view);if(view==='order'&&activeMode!=='custom')view='troop';activeView=view;if(unitView)activeCategory=view;document.querySelectorAll('.category-tab[data-view]').forEach(b=>{const active=b.dataset.view===view;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));});els.selectionContent.hidden=!unitView;els.orderView.hidden=view!=='order';els.resultsView.hidden=view!=='results';els.layerChartPanel.hidden=view!=='visual';if(unitView)renderSelectionGrid();if(view==='order')renderOrderView();}


function baseEngineInputs(){const i=modeState().inputs;return{leadership:parseNumber(i.leadership),leadershipFill:parseNumber(i.leadershipFill)/100,authority:parseNumber(i.authority),authorityFill:parseNumber(i.authorityFill)/100,dominance:parseNumber(i.dominance),dominanceFill:parseNumber(i.dominanceFill)/100,arachne:activeMode==='epic'&&!!i.arachne,healthInputs:{MONSTER:parseNumber(i.monsterHealth),HUMAN:parseNumber(i.humanHealth),EPIC_HUNTER:parseNumber(i.epicHunterHealth)},rankSeparation:parseNumber(i.rankSeparation)/100,layerSeparation:parseNumber(i.rankSeparation)/100};}
function categoryProbe(category,fill,inputs){const meta=CAPACITY_META[category],probeInputs={...inputs,[meta.fill]:fill};if(activeMode==='custom'){syncCustomOrders();return calculateCustomCategory({category,units:units[category],selectedIds:selectedIdsFor(category),inputs:probeInputs,order:state.modes.custom.orders[category]});}return calculateCategory({category,units:units[category],selectedIds:selectedIdsFor(category),inputs:probeInputs});}
function findMaxSafeFill(category,inputs){const meta=CAPACITY_META[category],limit=inputs[meta.limit];if(!modeState().selectedIds[category].length||!(limit>0))return 1;const full=categoryProbe(category,1,inputs);if(full.totalCapacity<=limit)return 1;let low=0,high=1;for(let i=0;i<55;i++){const mid=(low+high)/2;const r=categoryProbe(category,mid,inputs);if(r.totalCapacity<=limit)low=mid;else high=mid;}return low;}
function resolveAutoFills(inputs){for(const [cat,meta] of Object.entries(CAPACITY_META)){if(modeState().inputs[meta.auto]){resolvedFills[cat]=findMaxSafeFill(cat,inputs);inputs[meta.fill]=resolvedFills[cat];els[meta.fill].value=(resolvedFills[cat]*100).toFixed(2);}else resolvedFills[cat]=inputs[meta.fill];}return inputs;}
function validate(){const errors=[],hasAny=Object.values(modeState().selectedIds).some(a=>a.length);if(!hasAny)return errors;const inp=baseEngineInputs();if(!(inp.healthInputs.MONSTER>0))errors.push('Enter Monster Health.');if(!(inp.healthInputs.HUMAN>0))errors.push('Enter Human Health.');if(!(inp.healthInputs.EPIC_HUNTER>0))errors.push('Enter Epic Hunter Health.');if(modeState().selectedIds.troop.length&&!(inp.leadership>0))errors.push('Enter Leadership for selected Troops.');if(modeState().selectedIds.monster.length&&!(inp.dominance>0))errors.push('Enter Dominance for selected Monsters.');if(modeState().selectedIds.mercenary.length&&!(inp.authority>0))errors.push('Enter Authority for selected Mercenaries.');for(const [cat,meta] of Object.entries(CAPACITY_META)){if(!modeState().inputs[meta.auto]){const v=parseNumber(modeState().inputs[meta.fill]);if(v<0||v>100)errors.push(`${meta.fill.replace('Fill','')} fill must be between 0% and 100%.`);}}const sep=parseNumber(modeState().inputs.rankSeparation),sepMax=activeMode==='epic'?1:5;if(sep<0||sep>sepMax)errors.push(`${activeMode==='epic'?'Squad':'Layer'} separation must be between 0% and ${sepMax}%.`);return errors;}
function showValidation(errors){if(!errors.length){els.validationBox.classList.remove('show');els.validationBox.innerHTML='';return;}els.validationBox.innerHTML=`<strong>Check these inputs:</strong><br>${errors.map(escapeHtml).join('<br>')}`;els.validationBox.classList.add('show');}
function clearResults(message='Enter your values and select units.'){els.resultEmpty.hidden=false;els.resultGroups.hidden=true;els.resultStatus.textContent=message;for(const id of ['troopResults','monsterResults','mercenaryResults'])els[id].innerHTML='';updateCapacity(null);clearLayerChart();}
function renderResultRows(category,rows){const target=els[`${category}Results`];target.innerHTML='';if(!rows.length){target.innerHTML='<div class="result-empty" style="padding:16px">None selected.</div>';return;}for(const row of rows){const div=document.createElement('div');div.className='result-row';const colors=outputRowColors(category,row);div.style.setProperty('--row-color',colors.rowColor);div.style.setProperty('--row-accent',colors.accent);div.innerHTML=`<img src="${escapeHtml(row.icon)}" alt=""><div class="result-unit"><strong>${escapeHtml(row.level)} · ${escapeHtml(row.type)}</strong><span>${escapeHtml(row.name)}</span></div><div class="result-qty">${formatInteger(row.qty)}<small>Qty</small></div>`;iconFallback(div.querySelector('img'));target.appendChild(div);}}

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
function recalculate(){readInputs();const any=Object.values(modeState().selectedIds).some(a=>a.length);if(!any){showValidation([]);clearResults('Select units to build your stack.');return;}const errors=validate();showValidation(errors);if(errors.length){clearResults('Complete the required inputs.');return;}try{const inputs=resolveAutoFills(baseEngineInputs());syncCustomOrders();const result=activeMode==='custom'?calculateCustomStack({troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,selectedIds:modeState().selectedIds,orders:state.modes.custom.orders,inputs}):calculateEpicStack({troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,selectedIds:modeState().selectedIds,inputs});renderResultRows('mercenary',result.categories.mercenary.results);renderResultRows('monster',result.categories.monster.results);renderResultRows('troop',result.categories.troop.results);updateCapacity(result);renderLayerHealthChart(result);const count=result.categories.troop.results.length+result.categories.monster.results.length+result.categories.mercenary.results.length;els.resultStatus.textContent=`${count} calculated unit layer${count===1?'':'s'} · mobile entry order`;els.resultEmpty.hidden=true;els.resultGroups.hidden=false;}catch(error){console.error(error);showValidation([error.message||'The calculator could not complete the stack.']);clearResults('Calculation error.');}}
function resetCalculator(){if(!confirm(`Reset all ${activeMode==='epic'?'Epic':'Custom'} Stacker inputs and selections on this device?`))return;state.modes[activeMode].selectedIds={troop:[],monster:[],mercenary:[]};state.modes[activeMode].inputs=defaultInputs(activeMode);if(activeMode==='custom')state.modes.custom.orders={troop:[],monster:[],mercenary:[]};saveState();applyStateToInputs();syncCustomOrders();updateCounts();setView(activeView);clearResults();}
function switchMode(mode){if(mode===activeMode)return;readInputs();activeMode=mode;configureModeUI();applyStateToInputs();syncCustomOrders();updateCounts();if(activeView==='order'&&mode==='epic')activeView='troop';setView(activeView);saveState();recalculate();}
function wireEvents(){document.querySelectorAll('.mode-button').forEach(b=>b.addEventListener('click',()=>switchMode(b.dataset.mode)));document.querySelectorAll('.category-tab[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));els.clearCategory.addEventListener('click',clearCurrent);els.resetCalculator.addEventListener('click',resetCalculator);for(const id of ['leadership','authority','dominance','monsterHealth','humanHealth','epicHunterHealth']){els[id].addEventListener('focus',()=>{els[id].value=String(parseNumber(els[id].value)||'');});els[id].addEventListener('blur',()=>formatFieldInteger(els[id]));els[id].addEventListener('input',recalculate);}for(const id of ['leadershipFill','authorityFill','dominanceFill']){
  els[id].addEventListener('input',recalculate);
  els[id].addEventListener('blur',()=>{formatFillPercent(els[id]);readInputs();recalculate();});
}els.rankSeparation.addEventListener('input',()=>{updateRankSeparationDisplay();recalculate();});els.resetRankSeparation.addEventListener('click',()=>{const d=activeMode==='epic'?'0.40':'2.50';els.rankSeparation.value=d;modeState().inputs.rankSeparation=d;updateRankSeparationDisplay();saveState();recalculate();});for(const id of ['autoLeadership','autoAuthority','autoDominance'])els[id].addEventListener('change',()=>{readInputs();updateFillFieldStates();recalculate();});els.arachne.addEventListener('change',recalculate);}
async function init(){cacheElements();loadSavedState();applyStateToInputs();wireEvents();try{await loadData();configureModeUI();applyStateToInputs();syncCustomOrders();updateCounts();setView('troop');recalculate();}catch(error){console.error(error);showValidation(['The unit database could not be loaded. Refresh the page and try again.']);}}
init();
