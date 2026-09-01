import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BUILT_IN_ENCOUNTERS,makeAccount,encountersForAccount,createCustomEncounter,enemySquadTypes,validateAccountCollection} from '../js/workspace-model.mjs';
import {scoreEpicArmy} from '../js/epic-combat-engine-v2.mjs';

const epics=BUILT_IN_ENCOUNTERS.filter(row=>row.battleType==='epic');
assert.deepEqual(epics.map(row=>row.name),['Arachne','Armageddon','Arcanomancer','Doomsday','Hellforge','Basilisk','Briareus','Shadow City','Ashen','Tinman']);
for(const encounter of epics){
  assert.equal(enemySquadTypes(encounter.enemyFormation).length,encounter.name==='Arachne'?8:4);
  assert.equal(encounter.arachneBonus,encounter.name==='Arachne');
}
const main=makeAccount();assert.equal(main.name,'Main');validateAccountCollection({main},'main');
assert.throws(()=>validateAccountCollection({},'main'));
assert.equal(encountersForAccount(main,'pvp').length,2);
for(let total=1;total<=8;total++)assert.equal(enemySquadTypes({FLYING:total,MOUNTED:0,MELEE:0,RANGED:0}).length,total);
assert.throws(()=>createCustomEncounter({id:'zero',name:'Zero',battleType:'epic',enemyFormation:{}}));
assert.throws(()=>createCustomEncounter({id:'nine',name:'Nine',battleType:'epic',enemyFormation:{FLYING:9}}));

const army=JSON.parse(await readFile(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const unit=army.find(row=>row.baseStrength>0&&row.baseHealth>0);
const common={monsterHealthPct:1600,monsterStrengthPct:2299.5,strengthAgainstEpicPct:3225,monsterDDPct:12,monsterSTPct:12};
const legacy=scoreEpicArmy({units:army,quantities:{[unit.id]:100},bonuses:{...common,arachne:false}});
const explicit=scoreEpicArmy({units:army,quantities:{[unit.id]:100},bonuses:{...common,arachne:false,enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED']}});
assert.equal(explicit.expectedTotalLifetimeDamage,legacy.expectedTotalLifetimeDamage);
for(let count=1;count<=8;count++){
  const result=scoreEpicArmy({units:army,quantities:{[unit.id]:100},bonuses:{...common,enemySquadTypes:Array(count).fill('FLYING')}});
  assert.equal(result.bonuses.enemySquadTypes.length,count);
  if(count===1)assert.equal(result.squads[0].secondStrike,null);
}
console.log(JSON.stringify({ok:true,builtInEpic:epics.length,customFormationRange:'1-8'}));
