(() => {
const manifest={
  all:{label:'All TB Toolkit Data',records:0,xlsx:'downloads/data/all-data.xlsx',csv:'downloads/data/all-data-csv.zip',json:'downloads/data/all-data.json'},
  research:{label:'Research',records:0,xlsx:'downloads/data/research.xlsx',csv:'downloads/data/research.csv',json:'downloads/data/research.json'},
  chests:{label:'Chest Data',records:0,xlsx:'downloads/data/chests.xlsx',csv:'downloads/data/chests.csv',json:'downloads/data/chests.json'},
  troops:{label:'Troops',records:0,xlsx:'downloads/data/troops.xlsx',csv:'downloads/data/troops.csv',json:'downloads/data/troops.json'},
  monsters:{label:'Monsters',records:0,xlsx:'downloads/data/monsters.xlsx',csv:'downloads/data/monsters.csv',json:'downloads/data/monsters.json'},
  mercenaries:{label:'Mercenaries',records:0,xlsx:'downloads/data/mercenaries.xlsx',csv:'downloads/data/mercenaries.csv',json:'downloads/data/mercenaries.json'}
};
const dataset=document.getElementById('dataExportDataset');
const format=document.getElementById('dataExportFormat');
const button=document.getElementById('dataExportDownload');
const summary=document.getElementById('dataExportSummary');

async function loadManifest(){
  try{
    const r=await fetch('downloads/data/export-manifest.json?v=38',{cache:'no-store'});
    if(!r.ok)return;
    Object.assign(manifest,await r.json());
  }catch(_){}
  update();
}
function update(){
  const item=manifest[dataset.value];
  const count=item.records?`${Number(item.records).toLocaleString('en-US')} records`:'Public dataset';
  const formatText=format.value==='xlsx'?'Excel workbook':format.value==='csv'?(dataset.value==='all'?'ZIP of CSV files':'CSV file'):'JSON file';
  summary.innerHTML=`<strong>${item.label}</strong><span>${count} · ${formatText}</span>`;
}
button.addEventListener('click',()=>{
  const item=manifest[dataset.value];
  window.location.href=item[format.value];
});
dataset.addEventListener('change',update);
format.addEventListener('change',update);
loadManifest();
})();