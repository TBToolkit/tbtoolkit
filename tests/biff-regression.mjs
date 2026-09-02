import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {serializeAccountToBiff,parseBiff,materializeImportedAccount,BIFF_FORMAT,BIFF_SCHEMA_VERSION} from '../js/biff-format.mjs';

const account={
  id:'main',name:'Main Account',templeLevel:45,
  customEncounters:{raid:{id:'raid',name:'Raid',battleType:'epic',builtIn:false,enemyFormation:{FLYING:1,MOUNTED:1,MELEE:1,RANGED:1},arachneBonus:false}},
  battle:{
    activeBattleCategory:'epic',activeBattleMethod:'custom',activeEncounterByType:{epic:'raid',pvp:'pvp-single'},activeEncounterId:'raid',
    workspaces:{raid:{
      inputs:{battleType:'epic',leadership:'365000',minimumSeparation:true,ignoredInput:'no'},
      selectedIds:{troop:['known','missing'],monster:[],mercenary:[]},
      methods:{
        basic:{},
        custom:{orders:{troop:['G9'],monster:[],mercenary:[]},unitOrders:{troop:{G9:['known','missing']},monster:{},mercenary:{}},unitOrderManual:{troop:{G9:true},monster:{},mercenary:{}},squadOrder:{troop:['known','missing'],monster:[],mercenary:[]}},
        optimize:{resultCache:{large:'must not export'}}
      }
    }}
  }
};

const text=serializeAccountToBiff(account,{appBuild:'test',exportedAt:'2026-09-01T00:00:00.000Z'});
const raw=JSON.parse(text);
assert.equal(raw.format,BIFF_FORMAT);assert.equal(raw.schemaVersion,BIFF_SCHEMA_VERSION);
assert.equal(raw.account.workspaces[0].inputs.ignoredInput,undefined);
assert.doesNotMatch(text,/resultCache|must not export/);

const parsed=parseBiff(text);
assert.equal(parsed.account.name,'Main Account');
assert.deepEqual(parsed.account.customEncounters.map(row=>row.name),['Raid']);
assert.equal(parsed.account.workspaces[0].customOrder.unitOrderManual.troop.G9,true);

const imported=materializeImportedAccount(parsed,{
  existingAccountIds:['main'],existingEncounterIds:['raid'],builtInEncounterIds:['epic-doomsday','pvp-single'],armyIds:['known']
});
assert.equal(imported.account.id,'main-2');
assert.equal(imported.account.battle.activeEncounterId,'raid-2');
assert.ok(imported.account.customEncounters['raid-2']);
assert.ok(imported.account.battle.workspaces['raid-2']);
assert.deepEqual(imported.account.battle.workspaces['raid-2'].selectedIds.troop,['known']);
assert.deepEqual(imported.account.battle.workspaces['raid-2'].methods.custom.squadOrder.troop,['known']);
assert.equal(imported.account.battle.workspaces['raid-2'].methods.custom.unitOrderManual.troop.G9,true);
assert.ok(imported.warnings.some(message=>message.includes('unknown unit')));

assert.throws(()=>parseBiff('{}'),/not a TB Toolkit/);
assert.throws(()=>parseBiff(JSON.stringify({format:BIFF_FORMAT,schemaVersion:2,kind:'account'})),/newer schema/);
assert.throws(()=>parseBiff(text,{maxBytes:10}),/larger than 5 MB/);
const duplicate=structuredClone(raw);duplicate.account.customEncounters.push(structuredClone(duplicate.account.customEncounters[0]));
assert.throws(()=>parseBiff(JSON.stringify(duplicate)),/duplicate encounter IDs/);
const invalidFormation=structuredClone(raw);invalidFormation.account.customEncounters[0].enemyFormation={FLYING:9};
assert.throws(()=>parseBiff(JSON.stringify(invalidFormation)),/1–8 squads/);
for(const reservedId of ['__proto__','prototype','constructor']){
  const reservedEncounter=structuredClone(raw);
  reservedEncounter.account.customEncounters[0].id=reservedId;
  reservedEncounter.account.workspaces[0].encounterId=reservedId;
  assert.throws(()=>parseBiff(JSON.stringify(reservedEncounter)),/reserved value/,`Encounter ID ${reservedId} must be rejected`);

  const reservedAccount=structuredClone(raw);
  reservedAccount.account.id=reservedId;
  assert.throws(()=>parseBiff(JSON.stringify(reservedAccount)),/reserved value/,`Account ID ${reservedId} must be rejected`);
}
const fixture=parseBiff(await readFile(new URL('./fixtures/biff-v1-account.biff',import.meta.url),'utf8'));
assert.equal(fixture.account.name,'Fixture Account');

console.log(JSON.stringify({ok:true,schemaVersion:BIFF_SCHEMA_VERSION,accountId:imported.account.id,warnings:imported.warnings.length}));
