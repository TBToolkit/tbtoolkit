const output=document.getElementById('output');
const army=await fetch('../data/army-v2.json').then(response=>response.json());
const tiers=new Set(['G9','G8','S9','S8','E9','M9','M8','M7']);
const selectedIds=army.filter(unit=>tiers.has(unit.tier)&&unit.id!=='monster-m7-flying-black-dragon').map(unit=>unit.id);
const worker=new Worker('../js/epic-optimizer-worker.js?v=194');
worker.onmessage=event=>{
  const message=event.data??{};
  if(message.type==='progress')return;
  if(message.type==='error'){output.textContent=JSON.stringify(message,null,2);return;}
  const result=message.payload;
  const diagnostics=result?.diagnostics??{};
  const opening=(result?.result?.squads??[]).filter(row=>Number(row.predictedDeathPosition)<=8);
  const s9FlyingOpens=opening.some(row=>row.tier==='S9'&&String(row.combatType||'').toUpperCase()==='FLYING');
  output.textContent=JSON.stringify({
    passed:diagnostics.practicalTieBreakApplied===true&&Number(diagnostics.practicalTieBreakLossPct)<=.25&&!s9FlyingOpens,
    optimizerBuild:message.diagnostics?.optimizerBuild,
    eld:result?.result?.expectedTotalLifetimeDamage,
    practicalTieBreakApplied:diagnostics.practicalTieBreakApplied,
    practicalTieBreakLossPct:diagnostics.practicalTieBreakLossPct,
    maximumScore:diagnostics.maximumPracticalStructureScore,
    chosenScore:diagnostics.practicalStructureScore,
    candidates:diagnostics.practicalCandidateSummary,
    deathOrder:(result?.result?.squads??[]).map(row=>({name:row.name,tier:row.tier,death:row.predictedDeathPosition}))
  },null,2);
};
worker.postMessage({
  type:'optimize',requestId:'arachne-gs-harness',selectedIds,
  bonuses:{monsterHealthPct:2438.5,monsterStrengthPct:5300.5,strengthAgainstEpicPct:6181,monsterDDPct:32,monsterSTPct:30,arachne:true,enemySquadTypes:['FLYING','FLYING','MOUNTED','MOUNTED','MELEE','MELEE','RANGED','RANGED'],includeMercenariesInOptimization:false,useCustomFamilyBonuses:false},
  capacityLimits:{LEADERSHIP:1_326_786,DOMINANCE:270_245,AUTHORITY:0},fixedQuantities:{},fixedAuthorityMaximum:515_385
});
