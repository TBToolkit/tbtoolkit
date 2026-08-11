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

function populateFilters(){
  [...new Set(records.map(r=>r.type))].sort().forEach(v=>{
    const o=document.createElement('option');o.value=v;o.textContent=v;$('chestTypeFilter').appendChild(o);
  });
  resourceKeys.forEach(k=>{
    const o=document.createElement('option');o.value=k;o.textContent=labels[k];$('rewardFilter').appendChild(o);
  });
}

function getVisibleKeys(){
  const reward=$('rewardFilter').value;
  return reward ? [...fixedKeys,reward] : [...fixedKeys,...resourceKeys];
}

function apply(){
  const q=$('chestSearch').value.trim().toLowerCase();
  const type=$('chestTypeFilter').value;
  const reward=$('rewardFilter').value;
  filtered=records.filter(r=>{
    if(q && !`${r.type} ${r.chest}`.toLowerCase().includes(q))return false;
    if(type && r.type!==type)return false;
    if(reward && (r[reward]===null||r[reward]===undefined))return false;
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
  const reward=$('rewardFilter').value;
  $('activeRewardSummary').textContent=reward?`Showing chests with ${labels[reward]} data`:'Showing all compiled rewards';

  $('chestTableHead').innerHTML=`<tr>${keys.map(k=>`<th>${k==='type'?'Type':k==='chest'?'Chest':labels[k]}</th>`).join('')}</tr>`;
  $('chestTableBody').innerHTML=filtered.map(r=>`<tr>${keys.map(k=>{
    const val=r[k];
    const cls=[
      k==='type'?'type-cell':'',
      k==='chest'?'chest-cell':'',
      val===null||val===undefined?'blank':'',
      isDayKey(k)?'days':'',
      reward&&k===reward?'reward-highlight':''
    ].filter(Boolean).join(' ');
    return `<td class="${cls}">${k==='type'||k==='chest'?String(val??'—'):fmt(val,k)}</td>`;
  }).join('')}</tr>`).join('');
}

function reset(){
  $('chestSearch').value='';$('chestTypeFilter').value='';$('rewardFilter').value='';$('chestSort').value='source';apply();
}

async function init(){
  try{
    const res=await fetch('data/chest-data.json?v=32',{cache:'no-store'});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    payload=await res.json();records=payload.records||[];
    populateFilters();apply();
  }catch(err){
    console.error(err);
    $('chestTableShell').innerHTML='<div class="chest-empty"><h2>Chest data could not be loaded.</h2><p>Refresh the page and try again.</p></div>';
  }
}
$('chestSearch').addEventListener('input',apply);
['chestTypeFilter','rewardFilter','chestSort'].forEach(id=>$(id).addEventListener('change',apply));
$('clearChestSearch').addEventListener('click',()=>{$('chestSearch').value='';apply();$('chestSearch').focus();});
$('resetChestFilters').addEventListener('click',reset);
init();
})();