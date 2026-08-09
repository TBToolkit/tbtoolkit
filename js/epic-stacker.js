import { calculateEpicStack, calculateCategory } from './epic-engine.mjs';

const STORAGE_KEY='tbtoolkit.epicStacker.v2';
const LEGACY_STORAGE_KEY='tbtoolkit.epicStacker.v1';
const DATA_URLS={troop:'data/troops.json',monster:'data/monsters.json',mercenary:'data/mercenaries.json'};
const CAPACITY_META={
  troop:{limit:'leadership',fill:'leadershipFill',auto:'autoLeadership'},
  mercenary:{limit:'authority',fill:'authorityFill',auto:'autoAuthority'},
  monster:{limit:'dominance',fill:'dominanceFill',auto:'autoDominance'},
};
const units={troop:[],monster:[],mercenary:[]};
const els={};
let activeCategory='troop';
let resolvedFills={troop:1,monster:1,mercenary:1};
const state={
  selectedIds:{troop:[],monster:[],mercenary:[]},
  inputs:{
    leadership:'',leadershipFill:'99.99',autoLeadership:true,
    authority:'',authorityFill:'99.99',autoAuthority:false,
    dominance:'',dominanceFill:'99.99',autoDominance:true,
    monsterHealth:'',humanHealth:'',epicHunterHealth:'',arachne:false,rankSeparation:'0.40'
  }
};

function cacheElements(){['leadership','leadershipFill','autoLeadership','authority','authorityFill','autoAuthority','dominance','dominanceFill','autoDominance','monsterHealth','humanHealth','epicHunterHealth','arachne','rankSeparation','rankSeparationValue','resetRankSeparation','resetCalculator','unitSelectGrid','clearCategory','troopCount','monsterCount','mercenaryCount','validationBox','resultStatus','resultEmpty','resultGroups','troopResults','monsterResults','mercenaryResults','leadershipBar','authorityBar','dominanceBar','leadershipActual','authorityActual','dominanceActual','layerChartPanel','overlapSummary','layerChartEmpty','layerChartScroll','layerHealthChart','layerChartTooltip'].forEach(id=>els[id]=document.getElementById(id));}
function parseNumber(value){const x=Number(String(value??'').replace(/[%,$\s]/g,'').replace(/,/g,''));return Number.isFinite(x)?x:0;}
function formatInteger(value){return Math.round(parseNumber(value)).toLocaleString('en-US');}
function formatFieldInteger(el){const n=parseNumber(el.value);el.value=n?Math.round(n).toLocaleString('en-US'):'';}
const TIER_COLORS={9:'#365f2e',8:'#4e5960',7:'#8c681f',6:'#87382e',5:'#865426',4:'#533d73',3:'#315f78',2:'#4e6d32',1:'#626863'};
function hexToRgb(hex){const s=hex.replace('#','');return[parseInt(s.slice(0,2),16),parseInt(s.slice(2,4),16),parseInt(s.slice(4,6),16)];}
function mixHex(hex1,hex2,amount){const a=hexToRgb(hex1),b=hexToRgb(hex2),c=a.map((v,i)=>Math.round(v+(b[i]-v)*amount));return`#${c.map(v=>v.toString(16).padStart(2,'0')).join('')}`;}
function tierNumber(level){const m=String(level||'').match(/\d+/);return m?Number(m[0]):0;}
const MERC_SUBTYPE_LIGHTEN={MNST:0,COM:.06,SPCL:.12,GRD:.18,EMH:.24,EX:.30,ARNE:.36,ENG:.42};
function mercSubtype(level){const parts=String(level||'').toUpperCase().split('-');return parts.length>1?parts.slice(1).join('-'):'';}
function outputRowColors(category,row){const tier=tierNumber(row.level);let base=TIER_COLORS[tier]||'#34495a';if(category==='troop'){const meta=units.troop.find(u=>u.id===row.id),cls=String(meta?.class||'').toUpperCase(),lighten=cls==='SPECIALIST'?.16:cls==='ENGINEER'?.30:0;base=mixHex(base,'#ffffff',lighten);}else if(category==='mercenary'){const subtype=mercSubtype(row.level),lighten=MERC_SUBTYPE_LIGHTEN[subtype]??0;base=mixHex(base,'#ffffff',lighten);}const rowColor=mixHex(base,'#061725',.42),accent=mixHex(base,'#ffffff',.22);return{rowColor,accent};}
function escapeHtml(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
function iconFallback(img){img.onerror=()=>{if(img.dataset.fallback)return;img.dataset.fallback='1';img.src='assets/unit-icons/missing-icon.svg';img.classList.add('missing-icon');};}

async function loadData(){const entries=await Promise.all(Object.entries(DATA_URLS).map(async([k,url])=>{const r=await fetch(url,{cache:'no-cache'});if(!r.ok)throw new Error(`Could not load ${url}`);return[k,await r.json()];}));entries.forEach(([k,v])=>units[k]=v);}
function loadSavedState(){try{let saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(!saved){const legacy=JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY)||'null');if(legacy)saved={inputs:legacy.inputs||{},legacySelectedKeys:legacy.selectedKeys||{}};}if(!saved)return;Object.assign(state.inputs,saved.inputs||{});for(const c of Object.keys(state.selectedIds)){if(Array.isArray(saved.selectedIds?.[c]))state.selectedIds[c]=saved.selectedIds[c];}state.legacySelectedKeys=saved.legacySelectedKeys;}catch(_){}}
function migrateLegacySelections(){if(!state.legacySelectedKeys)return;for(const c of Object.keys(state.selectedIds)){if(state.selectedIds[c].length)continue;const keys=new Set(state.legacySelectedKeys[c]||[]);state.selectedIds[c]=units[c].filter(u=>keys.has(u.selectionKey)).map(u=>u.id);}delete state.legacySelectedKeys;saveState();}
function saveState(){localStorage.setItem(STORAGE_KEY,JSON.stringify({selectedIds:state.selectedIds,inputs:state.inputs}));}
function updateRankSeparationDisplay(){const v=Math.min(1,Math.max(0,parseNumber(els.rankSeparation?.value)));if(els.rankSeparationValue)els.rankSeparationValue.value=`${v.toFixed(2)}%`;}
function applyStateToInputs(){for(const id of ['leadership','authority','dominance','monsterHealth','humanHealth','epicHunterHealth']){els[id].value=state.inputs[id]||'';formatFieldInteger(els[id]);}for(const id of ['leadershipFill','authorityFill','dominanceFill'])els[id].value=state.inputs[id]??'';els.rankSeparation.value=String(Math.min(1,Math.max(0,parseNumber(state.inputs.rankSeparation??'0.40'))));for(const id of ['autoLeadership','autoAuthority','autoDominance'])els[id].checked=!!state.inputs[id];els.arachne.checked=!!state.inputs.arachne;updateRankSeparationDisplay();updateFillFieldStates();}
function readInputs(){for(const id of ['leadership','authority','dominance','monsterHealth','humanHealth','epicHunterHealth'])state.inputs[id]=String(parseNumber(els[id].value)||'');for(const id of ['rankSeparation'])state.inputs[id]=String(parseNumber(els[id].value));for(const id of ['autoLeadership','autoAuthority','autoDominance'])state.inputs[id]=els[id].checked;for(const [cat,meta] of Object.entries(CAPACITY_META)){if(!state.inputs[meta.auto])state.inputs[meta.fill]=String(parseNumber(els[meta.fill].value));}state.inputs.arachne=els.arachne.checked;saveState();}
function updateFillFieldStates(){for(const [cat,meta] of Object.entries(CAPACITY_META)){const auto=!!state.inputs[meta.auto];els[meta.fill].disabled=auto;if(!auto)els[meta.fill].value=state.inputs[meta.fill]??'99.99';}}

function troopLevelCompare(a,b){const ma=/^([GSE])(\d+)$/.exec(a),mb=/^([GSE])(\d+)$/.exec(b);if(!ma||!mb)return a.localeCompare(b);const tier=Number(mb[2])-Number(ma[2]);if(tier)return tier;return({G:0,S:1,E:2}[ma[1]]??9)-({G:0,S:1,E:2}[mb[1]]??9);}
function monsterLevelCompare(a,b){return parseInt(b.slice(1))-parseInt(a.slice(1));}
function mercLevelCompare(a,b){const [na,ca]=a.split('-'),[nb,cb]=b.split('-');const tierOrder=[2,7,6,5];const ia=tierOrder.indexOf(Number(na)),ib=tierOrder.indexOf(Number(nb));if(ia!==ib)return (ia<0?99:ia)-(ib<0?99:ib);const classOrder=['COM','MNST','SPCL','GRD','EMH','EX','ARNE','ENG'];return classOrder.indexOf(ca)-classOrder.indexOf(cb);}
function getLevelRows(category){const map=new Map();for(const u of units[category]){if(!map.has(u.level))map.set(u.level,[]);map.get(u.level).push(u);}let levels=[...map.keys()];levels.sort(category==='troop'?troopLevelCompare:category==='monster'?monsterLevelCompare:mercLevelCompare);return levels.map(level=>({level,rows:map.get(level).sort((a,b)=>b.strengthEach-a.strengthEach||a.name.localeCompare(b.name))}));}
function selectedSet(category){return new Set(state.selectedIds[category]);}
function updateCounts(){for(const c of ['troop','monster','mercenary'])els[`${c}Count`].textContent=state.selectedIds[c].length;}
function renderSelectionGrid(){const selected=selectedSet(activeCategory);els.unitSelectGrid.innerHTML='';for(const group of getLevelRows(activeCategory)){const wrap=document.createElement('section');wrap.className='unit-level-row';const allSelected=group.rows.length&&group.rows.every(u=>selected.has(u.id));const someSelected=group.rows.some(u=>selected.has(u.id));const side=document.createElement('label');side.className='level-selector';side.innerHTML=`<input type="checkbox" ${allSelected?'checked':''}><div><strong>${escapeHtml(group.level)}</strong><span>Select all</span></div>`;const cb=side.querySelector('input');cb.indeterminate=!allSelected&&someSelected;cb.addEventListener('change',()=>toggleLevel(group.rows,cb.checked));wrap.appendChild(side);const cards=document.createElement('div');cards.className='level-cards';for(const unit of group.rows){const label=document.createElement('label');const isSelected=selected.has(unit.id);label.className=`unit-option${isSelected?' selected':''}`;label.innerHTML=`<input type="checkbox" ${isSelected?'checked':''}><img src="${escapeHtml(unit.icon)}" alt=""><div class="unit-copy"><div class="unit-type">${escapeHtml(unit.type)}</div><div class="unit-name" title="${escapeHtml(unit.name)}">${escapeHtml(unit.name)}</div><div class="unit-strength">Strength/EA ${formatInteger(unit.strengthEach)}</div></div>`;iconFallback(label.querySelector('img'));label.querySelector('input').addEventListener('change',e=>toggleUnit(unit.id,e.target.checked));cards.appendChild(label);}wrap.appendChild(cards);els.unitSelectGrid.appendChild(wrap);}}
function toggleUnit(id,checked){const set=selectedSet(activeCategory);checked?set.add(id):set.delete(id);state.selectedIds[activeCategory]=[...set];saveState();updateCounts();renderSelectionGrid();recalculate();}
function toggleLevel(rows,checked){const set=selectedSet(activeCategory);for(const u of rows)checked?set.add(u.id):set.delete(u.id);state.selectedIds[activeCategory]=[...set];saveState();updateCounts();renderSelectionGrid();recalculate();}
function clearCurrent(){state.selectedIds[activeCategory]=[];saveState();updateCounts();renderSelectionGrid();recalculate();}
function setCategory(category){activeCategory=category;document.querySelectorAll('.category-tab').forEach(b=>b.classList.toggle('active',b.dataset.category===category));renderSelectionGrid();}

function baseEngineInputs(){return{leadership:parseNumber(state.inputs.leadership),leadershipFill:parseNumber(state.inputs.leadershipFill)/100,authority:parseNumber(state.inputs.authority),authorityFill:parseNumber(state.inputs.authorityFill)/100,dominance:parseNumber(state.inputs.dominance),dominanceFill:parseNumber(state.inputs.dominanceFill)/100,arachne:!!state.inputs.arachne,healthInputs:{MONSTER:parseNumber(state.inputs.monsterHealth),HUMAN:parseNumber(state.inputs.humanHealth),EPIC_HUNTER:parseNumber(state.inputs.epicHunterHealth)},rankSeparation:parseNumber(state.inputs.rankSeparation)/100};}
function categoryProbe(category,fill,inputs){const meta=CAPACITY_META[category];const probeInputs={...inputs,[meta.fill]:fill};return calculateCategory({category,units:units[category],selectedIds:state.selectedIds[category],inputs:probeInputs});}
function findMaxSafeFill(category,inputs){const meta=CAPACITY_META[category],limit=inputs[meta.limit];if(!state.selectedIds[category].length||!(limit>0))return 1;const full=categoryProbe(category,1,inputs);if(full.totalCapacity<=limit)return 1;let low=0,high=1;for(let i=0;i<55;i++){const mid=(low+high)/2;const r=categoryProbe(category,mid,inputs);if(r.totalCapacity<=limit)low=mid;else high=mid;}return low;}
function resolveAutoFills(inputs){for(const [cat,meta] of Object.entries(CAPACITY_META)){if(state.inputs[meta.auto]){resolvedFills[cat]=findMaxSafeFill(cat,inputs);inputs[meta.fill]=resolvedFills[cat];els[meta.fill].value=(resolvedFills[cat]*100).toFixed(resolvedFills[cat]===1?2:4).replace(/0+$/,'').replace(/\.$/,'');}else resolvedFills[cat]=inputs[meta.fill];}return inputs;}
function validate(){const errors=[],hasAny=Object.values(state.selectedIds).some(a=>a.length);if(!hasAny)return errors;const inp=baseEngineInputs();if(!(inp.healthInputs.MONSTER>0))errors.push('Enter Monster Health.');if(!(inp.healthInputs.HUMAN>0))errors.push('Enter Human Health.');if(!(inp.healthInputs.EPIC_HUNTER>0))errors.push('Enter Epic Hunter Health.');if(state.selectedIds.troop.length&&!(inp.leadership>0))errors.push('Enter Leadership for selected Troops.');if(state.selectedIds.monster.length&&!(inp.dominance>0))errors.push('Enter Dominance for selected Monsters.');if(state.selectedIds.mercenary.length&&!(inp.authority>0))errors.push('Enter Authority for selected Mercenaries.');for(const [cat,meta] of Object.entries(CAPACITY_META)){if(!state.inputs[meta.auto]){const v=parseNumber(state.inputs[meta.fill]);if(v<0||v>100)errors.push(`${meta.fill.replace('Fill','')} fill must be between 0% and 100%.`);}}if(parseNumber(state.inputs.rankSeparation)<0||parseNumber(state.inputs.rankSeparation)>1)errors.push('Layer separation must be between 0% and 1%.');return errors;}
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
      const hideTip=()=>{els.layerChartTooltip.hidden=true;};
      c.addEventListener('mouseenter',showTip);
      c.addEventListener('mouseleave',hideTip);
      c.addEventListener('focus',showTip);
      c.addEventListener('blur',hideTip);
      c.addEventListener('click',showTip);
    });
  }
}
function updateCapacity(result){for(const [name,actual,limit] of [['leadership',result?.totals.leadership,parseNumber(state.inputs.leadership)],['authority',result?.totals.authority,parseNumber(state.inputs.authority)],['dominance',result?.totals.dominance,parseNumber(state.inputs.dominance)]]){const bar=els[`${name}Bar`],fill=bar.querySelector('i'),pct=limit>0&&Number.isFinite(actual)?actual/limit:0;fill.style.width=`${Math.min(Math.max(pct*100,0),100)}%`;bar.classList.toggle('over',pct>1);els[`${name}Actual`].textContent=actual==null?'—':`${formatInteger(actual)} / ${limit?formatInteger(limit):'—'}${limit?` · ${(pct*100).toFixed(2)}%`:''}`;}}
function recalculate(){readInputs();const any=Object.values(state.selectedIds).some(a=>a.length);if(!any){showValidation([]);clearResults('Select units to build your stack.');return;}const errors=validate();showValidation(errors);if(errors.length){clearResults('Complete the required inputs.');return;}try{const inputs=resolveAutoFills(baseEngineInputs());const result=calculateEpicStack({troops:units.troop,monsters:units.monster,mercenaries:units.mercenary,selectedIds:state.selectedIds,inputs});renderResultRows('mercenary',result.categories.mercenary.results);renderResultRows('monster',result.categories.monster.results);renderResultRows('troop',result.categories.troop.results);updateCapacity(result);renderLayerHealthChart(result);const count=result.categories.troop.results.length+result.categories.monster.results.length+result.categories.mercenary.results.length;els.resultStatus.textContent=`${count} calculated unit layer${count===1?'':'s'} · mobile entry order`;els.resultEmpty.hidden=true;els.resultGroups.hidden=false;}catch(error){console.error(error);showValidation([error.message||'The calculator could not complete the stack.']);clearResults('Calculation error.');}}
function resetCalculator(){if(!confirm('Reset all Epic Stacker inputs and selections on this device?'))return;localStorage.removeItem(STORAGE_KEY);state.selectedIds={troop:[],monster:[],mercenary:[]};Object.assign(state.inputs,{leadership:'',leadershipFill:'99.99',autoLeadership:true,authority:'',authorityFill:'99.99',autoAuthority:false,dominance:'',dominanceFill:'99.99',autoDominance:true,monsterHealth:'',humanHealth:'',epicHunterHealth:'',arachne:false,rankSeparation:'0.40'});applyStateToInputs();updateCounts();renderSelectionGrid();clearResults();}
function wireEvents(){document.querySelectorAll('.category-tab').forEach(b=>b.addEventListener('click',()=>setCategory(b.dataset.category)));els.clearCategory.addEventListener('click',clearCurrent);els.resetCalculator.addEventListener('click',resetCalculator);for(const id of ['leadership','authority','dominance','monsterHealth','humanHealth','epicHunterHealth']){els[id].addEventListener('focus',()=>{els[id].value=String(parseNumber(els[id].value)||'');});els[id].addEventListener('blur',()=>formatFieldInteger(els[id]));els[id].addEventListener('input',recalculate);}for(const id of ['leadershipFill','authorityFill','dominanceFill'])els[id].addEventListener('input',recalculate);els.rankSeparation.addEventListener('input',()=>{updateRankSeparationDisplay();recalculate();});els.resetRankSeparation.addEventListener('click',()=>{els.rankSeparation.value='0.40';state.inputs.rankSeparation='0.40';updateRankSeparationDisplay();saveState();recalculate();});for(const id of ['autoLeadership','autoAuthority','autoDominance'])els[id].addEventListener('change',()=>{readInputs();updateFillFieldStates();recalculate();});els.arachne.addEventListener('change',recalculate);}
async function init(){cacheElements();loadSavedState();applyStateToInputs();wireEvents();try{await loadData();migrateLegacySelections();updateCounts();renderSelectionGrid();recalculate();}catch(error){console.error(error);showValidation(['The unit database could not be loaded. Refresh the page and try again.']);}}
init();
