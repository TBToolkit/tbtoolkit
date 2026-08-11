(() => {
const $=id=>document.getElementById(id);
let payload={records:[],fields:[]},records=[],filtered=[];
const fixedKeys=['type','chest'];
const numberFormat=new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
const resourceKeys=[
  'clanWealth','gold','potion','talentReset','cityTeleport','epicTar','rareTar','commonTar',
  'silver','wood','iron','stone','food','speedupDays','clanSpeedupDays','dragonCoins','summonsScroll','marchSpeed50'
];

const labels={
  clanWealth:'Clan Wealth',gold:'Gold',potion:'Potion',talentReset:'Talent Reset',
  cityTeleport:'City Teleport',epicTar:'Epic Tar',rareTar:'Rare Tar',commonTar:'Common Tar',
  silver:'Silver',wood:'Wood',iron:'Iron',stone:'Stone',food:'Food',
  speedupDays:'Speedup (days)',clanSpeedupDays:'Clan Speedup (days)',
  dragonCoins:'Dragon Coins',summonsScroll:'Summons Scroll',marchSpeed50:'50% March Speed'
};

const isDayKey=k=>k==='speedupDays'||k==='clanSpeedupDays';

function fmt(value,key){
  if(value===null||value===undefined||value==='')return '—';
  if(isDayKey(key)){
    const n=Number(value);
    return `${n.toLocaleString('en-US',{minimumFractionDigits:n<1?2:0,maximumFractionDigits:3})}`;
  }
  return Number(value).toLocaleString('en-US',{maximumFractionDigits:2});
}

const selectedRewards=new Set();

function rewardOptionLabel(key){return labels[key]||key;}

function updateRewardButton(){
  const text=$('rewardFilterButtonText');
  if(selectedRewards.size===0){
    text.textContent='All rewards';
  }else if(selectedRewards.size===1){
    text.textContent=rewardOptionLabel([...selectedRewards][0]);
  }else if(selectedRewards.size<=3){
    text.textContent=[...selectedRewards].map(rewardOptionLabel).join(', ');
  }else{
    text.textContent=`${selectedRewards.size} rewards selected`;
  }
}

function populateFilters(){
  [...new Set(records.map(r=>r.type))].sort().forEach(v=>{
    const o=document.createElement('option');o.value=v;o.textContent=v;$('chestTypeFilter').appendChild(o);
  });

  $('rewardFilterOptions').innerHTML=resourceKeys.map(k=>`
    <label class="reward-option">
      <input type="checkbox" value="${k}">
      <span>${labels[k]}</span>
    </label>`).join('');

  $('rewardFilterOptions').querySelectorAll('input[type="checkbox"]').forEach(box=>{
    box.addEventListener('change',()=>{
      if(box.checked)selectedRewards.add(box.value);
      else selectedRewards.delete(box.value);
      updateRewardButton();
      apply();
    });
  });
}

function getVisibleKeys(){
  return selectedRewards.size ? [...fixedKeys,...resourceKeys.filter(k=>selectedRewards.has(k))] : [...fixedKeys,...resourceKeys];
}

function formatChestValue(value,key){
  if(value===null||value===undefined||value==='')return '—';
  const n=Number(value);
  if(isDayKey(key)){
    return n>10
      ? n.toLocaleString('en-US',{maximumFractionDigits:0})
      : n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  }
  return n>10
    ? n.toLocaleString('en-US',{maximumFractionDigits:0})
    : n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}

function apply(){
  const q=$('chestSearch').value.trim().toLowerCase();
  const type=$('chestTypeFilter').value;

  filtered=records.filter(r=>{
    if(q && !`${r.type} ${r.chest}`.toLowerCase().includes(q))return false;
    if(type && r.type!==type)return false;
    if(selectedRewards.size){
      // Include a chest only if it has data for every selected reward.
      for(const key of selectedRewards){
        if(r[key]===null||r[key]===undefined)return false;
      }
    }
    return true;
  });

  const sort=$('chestSort').value;
  if(sort==='name')filtered.sort((a,b)=>a.chest.localeCompare(b.chest));
  else if(sort==='type')filtered.sort((a,b)=>a.type.localeCompare(b.type)||a.chest.localeCompare(b.chest));

  render();
}

function render(){
  $('visibleChestCount').textContent=filtered.length.toLocaleString('en-US');
  $('visibleTypeCount').textContent=new Set(filtered.map(r=>r.type)).size;
  $('clearChestSearch').hidden=!$('chestSearch').value;
  $('chestEmpty').hidden=filtered.length!==0;
  $('chestTableShell').hidden=filtered.length===0;

  const keys=getVisibleKeys();

  if(selectedRewards.size===0){
    $('activeRewardSummary').textContent='Showing all compiled rewards';
  }else{
    const names=[...selectedRewards].map(rewardOptionLabel);
    $('activeRewardSummary').textContent=`Showing chests with ${names.join(', ')}`;
  }

  $('chestTableHead').innerHTML=`<tr>${keys.map(k=>`<th>${k==='type'?'Type':k==='chest'?'Chest':labels[k]}</th>`).join('')}</tr>`;
  $('chestTableBody').innerHTML=filtered.map(r=>`<tr>${keys.map(k=>{
    const val=r[k];
    const cls=[
      k==='type'?'type-cell':'',
      k==='chest'?'chest-cell':'',
      val===null||val===undefined?'blank':'',
      isDayKey(k)?'days':'',
      selectedRewards.has(k)?'reward-highlight':''
    ].filter(Boolean).join(' ');
    return `<td class="${cls}">${k==='type'||k==='chest'?String(val??'—'):formatChestValue(val,k)}</td>`;
  }).join('')}</tr>`).join('');
}

function reset(){
  $('chestSearch').value='';
  $('chestTypeFilter').value='';
  $('chestSort').value='source';
  selectedRewards.clear();
  $('rewardFilterOptions').querySelectorAll('input').forEach(b=>b.checked=false);
  updateRewardButton();
  apply();
}

async function init(){
  try{
    const res=await fetch('data/chest-data.json?v=33',{cache:'no-store'});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    payload=await res.json();records=payload.records||[];
    populateFilters();apply();
  }catch(err){
    console.error(err);
    $('chestTableShell').innerHTML='<div class="chest-empty"><h2>Chest data could not be loaded.</h2><p>Refresh the page and try again.</p></div>';
  }
}
$('chestSearch').addEventListener('input',apply);
['chestTypeFilter','chestSort'].forEach(id=>$(id).addEventListener('change',apply));

$('rewardFilterButton').addEventListener('click',()=>{
  const menu=$('rewardFilterMenu');
  const open=menu.hidden;
  menu.hidden=!open;
  $('rewardFilterButton').setAttribute('aria-expanded',String(open));
});

$('selectAllRewards').addEventListener('click',()=>{
  resourceKeys.forEach(k=>selectedRewards.add(k));
  $('rewardFilterOptions').querySelectorAll('input').forEach(b=>b.checked=true);
  updateRewardButton();
  apply();
});

$('clearAllRewards').addEventListener('click',()=>{
  selectedRewards.clear();
  $('rewardFilterOptions').querySelectorAll('input').forEach(b=>b.checked=false);
  updateRewardButton();
  apply();
});

document.addEventListener('pointerdown',evt=>{
  const menu=$('rewardFilterMenu');
  const button=$('rewardFilterButton');
  if(menu.hidden)return;
  if(menu.contains(evt.target)||button.contains(evt.target))return;
  menu.hidden=true;
  button.setAttribute('aria-expanded','false');
});

$('clearChestSearch').addEventListener('click',()=>{$('chestSearch').value='';apply();$('chestSearch').focus();});
$('resetChestFilters').addEventListener('click',reset);
init();
})();