(() => {
const PAGE_SIZE=80;
let data=[],filtered=[],shown=PAGE_SIZE;
const $=id=>document.getElementById(id);

const CATEGORY_ICONS={
  'Guardsmen I':'guardsmen-i',
  'Specialists I':'specialists-i',
  'Engineer Corps I':'engineer-corps-i',
  'Monsters I':'monsters-i',
  'Archeology':'archeology',
  'Blacksmithing':'blacksmithing',
  'Guardsmen II':'guardsmen-ii',
  'Specialists II':'specialists-ii',
  'Engineer Corps II':'engineer-corps-ii',
  'Monsters II':'monsters-ii',
  'Army Modernization':'army-modernization',
  'Economy':'economy',
  'Monster Boost':'monster-boost',
  'Logistics':'logistics'
};
const categoryIcon=category=>`assets/images/research/${CATEGORY_ICONS[category]||'archeology'}.webp`;
const pointIcon=currency=>currency==='Conquest Points'
  ?'assets/images/research/conquest-points.webp'
  :'assets/images/research/valor-points.webp';

const fmt=n=>{
  if(n==null)return '—';
  return Number(n).toLocaleString('en-US');
};
const compact=n=>{
  if(n>=1e12)return `${(n/1e12).toFixed(n>=1e13?1:2).replace(/\.0+$/,'')}T`;
  if(n>=1e9)return `${(n/1e9).toFixed(n>=1e10?1:2).replace(/\.0+$/,'')}B`;
  if(n>=1e6)return `${(n/1e6).toFixed(n>=1e8?1:2).replace(/\.0+$/,'')}M`;
  if(n>=1e3)return `${(n/1e3).toFixed(n>=1e5?0:1).replace(/\.0+$/,'')}K`;
  return fmt(n);
};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function populateCategories(){
  [...new Set(data.map(r=>r.category))].forEach(c=>{
    const o=document.createElement('option');o.value=c;o.textContent=c;$('categoryFilter').appendChild(o);
  });
}
function apply(){
  const q=$('researchSearch').value.trim().toLowerCase();
  const cat=$('categoryFilter').value;
  const cur=$('currencyFilter').value;
  const lv=$('levelFilter').value;
  filtered=data.filter(r=>{
    if(q&&!`${r.research} ${r.category}`.toLowerCase().includes(q))return false;
    if(cat&&r.category!==cat)return false;
    if(cur&&r.currency!==cur)return false;
    if(lv==='1'&&r.levelCount!==1)return false;
    if(lv==='multi'&&r.levelCount<=1)return false;
    return true;
  });
  const sort=$('researchSort').value;
  if(sort==='name')filtered.sort((a,b)=>a.research.localeCompare(b.research));
  else if(sort==='totalAsc')filtered.sort((a,b)=>a.totalCost-b.totalCost||a.sourceOrder-b.sourceOrder);
  else if(sort==='totalDesc')filtered.sort((a,b)=>b.totalCost-a.totalCost||a.sourceOrder-b.sourceOrder);
  else filtered.sort((a,b)=>a.sourceOrder-b.sourceOrder);
  shown=PAGE_SIZE;render();
}
function render(){
  $('visibleResearchCount').textContent=filtered.length.toLocaleString('en-US');
  $('visibleCategoryCount').textContent=new Set(filtered.map(r=>r.category)).size;
  $('clearResearchSearch').hidden=!$('researchSearch').value;
  $('researchEmpty').hidden=filtered.length!==0;
  $('researchResults').hidden=filtered.length===0;

  const rows=filtered.slice(0,shown);
  let lastCat=null,html='';
  for(const r of rows){
    if(r.category!==lastCat){
      const count=filtered.filter(x=>x.category===r.category).length;
      html+=`<div class="research-category-heading">
        <img class="research-category-heading-icon" src="${categoryIcon(r.category)}" alt="" aria-hidden="true">
        <div><h2>${esc(r.category)}</h2><span>${count} item${count===1?'':'s'}</span></div>
      </div>`;
      lastCat=r.category;
    }
    const badge=r.currency==='Conquest Points'?'conquest':'valor';
    const levels=r.levelCosts.map((cost,i)=>`<div class="level-cost ${cost==null?'empty':''}"><span class="level">Level ${i+1}</span><span class="cost">${cost==null?'—':fmt(cost)}</span></div>`).join('');
    html+=`<details class="research-item">
      <summary>
        <img class="research-item-icon" src="${categoryIcon(r.category)}" alt="" aria-hidden="true">
        <div class="research-name">
          <strong>${esc(r.research)}</strong>
          <span>${r.levelCount===1?'Unlock / single level':`${r.levelCount} research levels`}</span>
        </div>
        <span class="point-badge ${badge}">
          <img src="${pointIcon(r.currency)}" alt="" aria-hidden="true">
          <span>${esc(r.currency)}</span>
        </span>
        <div class="research-total"><strong>${compact(r.totalCost)}</strong><span>Total ${esc(r.currency)}</span></div>
        <span class="research-chevron">›</span>
      </summary>
      <div class="research-details">
        <div class="level-cost-grid">${levels}</div>
        <div class="research-details-footer"><span><b>Total:</b> ${fmt(r.totalCost)} ${esc(r.currency)}</span><span>${esc(r.category)}</span></div>
      </div>
    </details>`;
  }
  $('researchResults').innerHTML=html;
  $('researchLoadMoreWrap').hidden=shown>=filtered.length;
  $('researchLoadMore').textContent=`Show more (${Math.min(PAGE_SIZE,filtered.length-shown).toLocaleString('en-US')})`;
}
function reset(){
  $('researchSearch').value='';$('categoryFilter').value='';$('currencyFilter').value='';$('levelFilter').value='';$('researchSort').value='source';apply();
}
async function init(){
  try{
    const res=await fetch('data/research-data.json?v=26',{cache:'no-store'});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const payload=await res.json();data=payload.records||[];
    populateCategories();apply();
  }catch(err){
    console.error(err);
    $('researchResults').innerHTML='<div class="research-empty card"><h2>Research data could not be loaded.</h2><p>Refresh the page and try again.</p></div>';
  }
}
$('researchSearch').addEventListener('input',apply);
['categoryFilter','currencyFilter','levelFilter','researchSort'].forEach(id=>$(id).addEventListener('change',apply));
$('clearResearchSearch').addEventListener('click',()=>{$('researchSearch').value='';apply();$('researchSearch').focus();});
$('resetResearchFilters').addEventListener('click',reset);
$('researchLoadMore').addEventListener('click',()=>{shown+=PAGE_SIZE;render();});
init();
})();