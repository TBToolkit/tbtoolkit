import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mercenaryPreservationStatus,optimizeEpicQuantities} from '../js/epic-quantity-optimizer.mjs';

const fake={
  squads:[{id:'merc-1',name:'Mercenary',capacityType:'AUTHORITY',quantity:1}],
  cases:{friendlyFirst:{cycles:8,death:{'merc-1':{cycle:5}}},epicFirst:{cycles:8,death:{'merc-1':{cycle:6}}}}
};
assert.equal(mercenaryPreservationStatus(fake).valid,true);
fake.cases.epicFirst.death['merc-1'].cycle=4;
assert.equal(mercenaryPreservationStatus(fake).valid,false,'Both initiative outcomes must satisfy the rule.');
fake.cases.epicFirst.death['merc-1'].cycle=6;
fake.squads.push({id:'troop-1',capacityType:'LEADERSHIP',quantity:1});
assert.equal(mercenaryPreservationStatus(fake).deaths.length,1,'Only Authority squads are constrained.');

const playerPath=process.argv[2];
if(playerPath){
  const player=JSON.parse(fs.readFileSync(playerPath,'utf8'));
  const workspace=player.account.workspaces.find(row=>row.encounterId==='epic-doomsday');
  assert.ok(workspace,'The player file must include a Doomsday workspace.');
  const i=workspace.inputs;
  const parse=value=>Number(String(value??0).replaceAll(',',''))||0;
  const capacity=(key,fill,auto)=>Math.floor(parse(i[key])*(i[auto]?1:parse(i[fill])/100));
  const bonuses={
    monsterHealthPct:parse(i.monsterHealth),monsterStrengthPct:parse(i.monsterStrength),
    strengthAgainstEpicPct:parse(i.strengthAgainstEpic),monsterDDPct:parse(i.monsterDD),monsterSTPct:parse(i.monsterST),
    arachne:!!i.arachne,enemySquadTypes:i.enemySquadTypes,
    includeMercenariesInOptimization:true,preserveMercenaries:true,useCustomProfileBonuses:true,
    customProfileBonuses:Object.fromEntries(
      ['beast','dragon','elemental','giant','human','guardsman','specialist','engineer','epicHunter'].flatMap(key=>
        ['Health','Strength','DD','ST'].map(stat=>[`${key}${stat}Pct`,parse(i[`${key}${stat}`])])
      )
    )
  };
  const units=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
  const selectedIds=Object.values(workspace.selectedIds).flat();
  const started=performance.now();
  const result=optimizeEpicQuantities({
    units,selectedIds,bonuses,
    capacityLimits:{LEADERSHIP:capacity('leadership','leadershipFill','autoLeadership'),DOMINANCE:capacity('dominance','dominanceFill','autoDominance'),AUTHORITY:capacity('authority','authorityFill','autoAuthority')},
    minimumHealthSeparationPct:.01,minimumQuantity:1
  });
  const status=result.result.mercenaryPreservation;
  assert.equal(status.valid,true,'The optimized army must preserve every Authority squad in both initiative outcomes.');
  console.log(JSON.stringify({ok:true,authorityFill:i.authorityFill,elapsedMs:Math.round(performance.now()-started),eld:result.result.expectedTotalLifetimeDamage,authorityUsed:result.result.capacities.AUTHORITY,firstAllowedCycle:status.firstAllowedCycle,totalCycles:status.totalCycles,deaths:status.deaths.map(({name,friendlyFirstCycle,epicFirstCycle})=>({name,friendlyFirstCycle,epicFirstCycle}))},null,2));
}else console.log('Mercenary preservation checks passed.');
