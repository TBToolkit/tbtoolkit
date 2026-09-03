import fs from 'node:fs';
import {scoreEpicArmy} from '../js/epic-combat-engine-v2.mjs';

const units=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const selectedTiers=new Set(['G9','G8','S9','S8','E9','E8','M9','M8','M7']);
const selected=units.filter(unit=>selectedTiers.has(unit.tier));
const selectedNames=new Set(selected.map(unit=>unit.name));
const templeDivisor=5.91;
const revivableShare=.90;
const bonuses={
  monsterHealthPct:2447.5,
  monsterStrengthPct:5312,
  strengthAgainstEpicPct:6189,
  monsterDDPct:32,
  monsterSTPct:30,
  arachne:false,
  enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED'],
  includeMercenariesInOptimization:false,
  useCustomFamilyBonuses:false
};
const capacityLimits={LEADERSHIP:1_330_049,DOMINANCE:270_910,AUTHORITY:0};

const baselineQuantities={
  'JOSEPHINE 2':5422,'DUELIST 2':54218,'DUELIST 1':97219,'JOSEPHINE 1':9524,
  'WHITEMANE 1':47601,'PUNISHER 1':95196,'LEGITIMIST 1':95154,'WHITEMANE 2':26420,
  'PUNISHER 2':52798,'PURIFIER 1':95062,'LEGITIMIST 2':52793,'CORAX 1':4752,
  'SMITER 1':47509,'CORAX 2':2638,'PURIFIER 2':52727,'SMITER 2':26361,
  'ROYAL LION 1':4560,'ROYAL LION 2':2532,
  'FIRE PHOENIX 2':234,'FIRE PHOENIX 1':420,'TRICKSTER 1':432,'DEVASTATOR 1':425,
  'KRAKEN 1':412,'TRICKSTER 2':240,'KRAKEN 2':228,'DEVASTATOR 2':235,
  'BLACK DRAGON':742,'WIND LORD':718,'ANCIENT TERROR':794,'DESTRUCTIVE COLOSSUS':766
};

for(const name of Object.keys(baselineQuantities))if(!selectedNames.has(name))throw new Error(`Unknown selected unit ${name}.`);
if(selected.length!==30)throw new Error(`Expected 30 selected squads; found ${selected.length}.`);

const categoryByName=new Map(selected.map(unit=>[unit.name,unit.category]));
const unitByName=new Map(selected.map(unit=>[unit.name,unit]));
const orderedNames=[...Object.keys(baselineQuantities)].sort();
const signature=quantities=>orderedNames.map(name=>quantities[name]??0).join(',');
const adjustedGold=quantities=>orderedNames.reduce((sum,name)=>sum+Math.floor(Number(quantities[name]||0)*revivableShare)*Number(unitByName.get(name)?.goldRevivalCost||0),0)/templeDivisor;
const score=quantities=>{
  const result=scoreEpicArmy({units,quantities,bonuses});
  const gold=adjustedGold(quantities);
  return{quantities,result,eld:Number(result.expectedTotalLifetimeDamage||0),gold,efficiency:gold>0?Number(result.expectedTotalLifetimeDamage||0)/gold*1000:0};
};
const baseline=score(baselineQuantities);

for(const type of ['LEADERSHIP','DOMINANCE','AUTHORITY']){
  if(Number(baseline.result.capacities[type]||0)>capacityLimits[type])throw new Error(`${type} exceeds the supplied limit.`);
}

function reduceOne(candidate,name,fraction){
  const current=Number(candidate.quantities[name]||0);
  const delta=Math.max(1,Math.floor(current*fraction));
  if(current-delta<1)return null;
  return score({...candidate.quantities,[name]:current-delta});
}

function reduceGroup(candidate,names,fraction){
  const quantities={...candidate.quantities};
  let changed=false;
  for(const name of names){
    const current=Number(quantities[name]||0),delta=Math.max(1,Math.floor(current*fraction));
    if(current-delta<1)continue;
    quantities[name]=current-delta;changed=true;
  }
  return changed?score(quantities):null;
}

function transferCapacity(candidate,donorName,receiverName,fraction){
  const donor=unitByName.get(donorName),receiver=unitByName.get(receiverName);
  if(!donor||!receiver||donor.capacityType!==receiver.capacityType)return null;
  const donorCurrent=Number(candidate.quantities[donorName]||0);
  const donorDelta=Math.max(1,Math.floor(donorCurrent*fraction));
  if(donorCurrent-donorDelta<1)return null;
  const receiverDelta=Math.floor(donorDelta*Number(donor.capacityCost)/Number(receiver.capacityCost));
  if(receiverDelta<1)return null;
  return score({...candidate.quantities,[donorName]:donorCurrent-donorDelta,[receiverName]:Number(candidate.quantities[receiverName]||0)+receiverDelta});
}

function transferPairs(candidate){
  const squadByName=new Map((candidate.result.squads||[]).map(squad=>[squad.name,squad]));
  const pairs=[];
  for(const capacityType of ['LEADERSHIP','DOMINANCE']){
    const names=orderedNames.filter(name=>unitByName.get(name)?.capacityType===capacityType);
    const ranked=names.map(name=>{
      const squad=squadByName.get(name);
      const damage=Number(squad?.expectedLifetimeDamage||0);
      const gold=Number(squad?.rawGoldRevivalCost||0);
      return{name,value:gold>0?damage/gold:0};
    }).sort((a,b)=>a.value-b.value);
    const donors=ranked.slice(0,Math.min(6,ranked.length));
    const receivers=[...ranked].reverse().slice(0,Math.min(6,ranked.length));
    for(const donor of donors)for(const receiver of receivers)if(donor.name!==receiver.name)pairs.push([donor.name,receiver.name]);
  }
  return pairs;
}

function keepDiverse(candidates,width){
  const unique=[...new Map(candidates.map(candidate=>[signature(candidate.quantities),candidate])).values()];
  const efficient=[...unique].sort((a,b)=>b.efficiency-a.efficiency||b.eld-a.eld).slice(0,Math.ceil(width*.75));
  const cheap=[...unique].sort((a,b)=>a.gold-b.gold||b.eld-a.eld).slice(0,width-efficient.length);
  return [...new Map([...efficient,...cheap].map(candidate=>[signature(candidate.quantities),candidate])).values()];
}

function searchFloor(floorPct){
  const minimumEld=baseline.eld*floorPct/100;
  const troopNames=orderedNames.filter(name=>categoryByName.get(name)==='troop');
  const monsterNames=orderedNames.filter(name=>categoryByName.get(name)==='monster');
  let beam=[baseline],evaluations=0;
  for(const fraction of [.10,.05,.02,.01,.005,.002,.001,.0005]){
    for(let round=0;round<5;round++){
      const generated=[...beam];
      for(const candidate of beam){
        for(const name of orderedNames){
          const next=reduceOne(candidate,name,fraction);evaluations++;
          if(next&&next.eld>=minimumEld)generated.push(next);
        }
        for(const names of [troopNames,monsterNames,orderedNames]){
          const next=reduceGroup(candidate,names,fraction);evaluations++;
          if(next&&next.eld>=minimumEld)generated.push(next);
        }
        for(const [donor,receiver] of transferPairs(candidate)){
          const next=transferCapacity(candidate,donor,receiver,fraction);evaluations++;
          if(next&&next.eld>=minimumEld)generated.push(next);
        }
      }
      const nextBeam=keepDiverse(generated,32);
      const before=beam[0]?.efficiency||0,after=nextBeam[0]?.efficiency||0;
      beam=nextBeam;
      if(after<=before+1e-9&&round>=1)break;
    }
  }
  const best=[...beam].sort((a,b)=>b.efficiency-a.efficiency||b.eld-a.eld)[0];
  return{floorPct,minimumEld,evaluations,best};
}

const floors=[99.5,99,98,97.5,95].map(searchFloor);
const summarize=candidate=>({
  eld:candidate.eld,
  eldPctOfMaximum:candidate.eld/baseline.eld*100,
  adjustedGoldRevival:candidate.gold,
  goldSavingsPct:(1-candidate.gold/baseline.gold)*100,
  damagePerThousandGold:candidate.efficiency,
  efficiencyGainPct:(candidate.efficiency/baseline.efficiency-1)*100,
  leadership:candidate.result.capacities.LEADERSHIP,
  dominance:candidate.result.capacities.DOMINANCE,
  largestQuantityReductions:orderedNames.map(name=>({name,before:baselineQuantities[name],after:candidate.quantities[name],reductionPct:(1-candidate.quantities[name]/baselineQuantities[name])*100}))
    .filter(row=>row.after<row.before).sort((a,b)=>b.reductionPct-a.reductionPct).slice(0,8)
});

console.log(JSON.stringify({
  generatedAt:new Date().toISOString(),
  purpose:'Explore the ELD-versus-Gold Pareto frontier without changing the live optimizer.',
  inputs:{encounter:'Arcanomancer',selectedSquads:selected.length,capacityLimits,bonuses,templeLevel:45,templeDivisor,revivableShare},
  baseline:summarize(baseline),
  frontier:floors.map(row=>({floorPct:row.floorPct,evaluations:row.evaluations,...summarize(row.best)}))
},null,2));
