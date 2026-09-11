import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareEpicScoringContext,scoreEpicArmy} from '../js/epic-combat-engine-v2.mjs';

const units=JSON.parse(fs.readFileSync(new URL('../data/army-v2.json',import.meta.url),'utf8'));
const chosen=units.filter(unit=>['G9','S9','E9','M9'].includes(unit.tier)).slice(0,10);
const formations=[
  ['FLYING','MOUNTED','MELEE','RANGED'],
  ['FLYING','FLYING','MOUNTED','MOUNTED','MELEE','MELEE','RANGED','RANGED']
];

for(const enemySquadTypes of formations){
  const bonuses={monsterHealthPct:2000,monsterStrengthPct:2500,strengthAgainstEpicPct:3000,monsterDDPct:15,monsterSTPct:20,arachne:enemySquadTypes.length===8,enemySquadTypes,useCustomFamilyBonuses:false};
  const quantities={};
  chosen.forEach((unit,index)=>{const key=index%3===0?unit.id:index%3===1?unit.name:String(unit.unitId);quantities[key]=1000-index*37;});
  const ordinary=scoreEpicArmy({units,quantities,bonuses});
  const context=prepareEpicScoringContext({units,bonuses});
  const prepared=scoreEpicArmy({units,quantities,bonuses,scoringContext:context});
  assert.deepEqual(prepared,ordinary,'Prepared scoring must be deeply identical to ordinary scoring');
  const eventless=scoreEpicArmy({units,quantities,bonuses,scoringContext:context,recordEvents:false});
  assert.deepEqual({...eventless,cases:undefined},{...ordinary,cases:undefined},'Event suppression must not change scoring output');
  assert.deepEqual(eventless.cases.friendlyFirst.events,[]);
  assert.deepEqual(eventless.cases.epicFirst.events,[]);
  const clonedBonuses={...bonuses};
  const safelyIgnored=scoreEpicArmy({units,quantities,bonuses:clonedBonuses,scoringContext:context});
  assert.deepEqual(safelyIgnored,scoreEpicArmy({units,quantities,bonuses:clonedBonuses}),'A context for a different bonus object must be ignored');
}

console.log(JSON.stringify({ok:true,formations:formations.length,units:chosen.length}));
