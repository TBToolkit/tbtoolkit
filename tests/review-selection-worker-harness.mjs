const cases={
  Doomsday:{capacityLimits:{LEADERSHIP:407082,DOMINANCE:76212,AUTHORITY:0},bonuses:{monsterHealthPct:1637.5,monsterStrengthPct:2032,strengthAgainstEpicPct:3877,monsterDDPct:12,monsterSTPct:18,arachne:false,enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED'],includeMercenariesInOptimization:false,useCustomFamilyBonuses:false}},
  Arachne:{capacityLimits:{LEADERSHIP:1326786,DOMINANCE:270245,AUTHORITY:0},bonuses:{monsterHealthPct:2438.5,monsterStrengthPct:5300.5,strengthAgainstEpicPct:6181,monsterDDPct:32,monsterSTPct:30,arachne:true,enemySquadTypes:['FLYING','FLYING','MOUNTED','MOUNTED','MELEE','MELEE','RANGED','RANGED'],includeMercenariesInOptimization:false,useCustomFamilyBonuses:false}}
};
const elements=Object.fromEntries(['case','budget','run','cancel','status','output'].map(id=>[id,document.getElementById(id)]));
let worker=null,started=0;
const army=await fetch('../data/army-v2.json').then(response=>response.json());
const currentIds=army.filter(unit=>(unit.category==='troop'&&['G9','G8','G7','S9','S8','S7','E9','E8','E7'].includes(unit.tier))||(unit.category==='monster'&&['M9','M8','M7'].includes(unit.tier))).map(unit=>unit.id);
function stop(){if(worker)worker.terminate();worker=null;elements.run.disabled=false;elements.cancel.disabled=true;}
elements.cancel.onclick=()=>{const elapsed=performance.now()-started;stop();elements.status.textContent=`Cancelled after ${(elapsed/1000).toFixed(1)} seconds. No selection was changed.`;elements.status.className='error';};
elements.run.onclick=()=>{
  stop();elements.output.textContent='';elements.status.className='';elements.run.disabled=true;elements.cancel.disabled=false;started=performance.now();
  worker=new Worker('../js/epic-review-worker.mjs',{type:'module'});const requestId=crypto.randomUUID();
  worker.onmessage=event=>{const message=event.data??{};if(message.requestId!==requestId)return;if(message.type==='progress'){const p=message.payload;elements.status.textContent=`${p.phase} · ${p.progressPct}%${p.candidateCount?` · candidate ${p.candidate}/${p.candidateCount}`:''} · ${(performance.now()-started).toFixed(0)} ms`;return;}if(message.type==='result'){elements.status.textContent=`Completed in ${(message.payload.elapsedMs/1000).toFixed(1)} seconds.`;elements.status.className='ok';elements.output.textContent=JSON.stringify(message,null,2);stop();return;}if(message.type==='error'){const elapsed=(performance.now()-started)/1000;elements.status.textContent=`${message.message} (${elapsed.toFixed(1)} seconds)`;elements.status.className='error';elements.output.textContent=JSON.stringify(message,null,2);stop();}};
  worker.onerror=event=>{elements.status.textContent=event.message||'Worker failed.';elements.status.className='error';stop();};
  worker.postMessage({type:'review',requestId,payload:{...cases[elements.case.value],currentIds,timeBudgetMs:Number(elements.budget.value)}});
};
