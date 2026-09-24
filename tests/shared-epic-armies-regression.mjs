import assert from 'node:assert/strict';
import {EPIC_ARMY_GROUPS,epicArmyGroup,canReuseEpicOptimizerResult,copySharedEpicArmy} from '../js/shared-epic-armies.mjs';

assert.deepEqual(EPIC_ARMY_GROUPS['one-captain'].encounters,['epic-tinman','epic-hellforge','epic-doomsday','epic-fenrir','epic-jormungandr','epic-chimera']);
assert.equal(epicArmyGroup('epic-arachne'),'three-captains');
assert.equal(epicArmyGroup('epic-ashen'),'hero-three-captains');
assert.equal(epicArmyGroup('epic-custom-1'),null);
assert.equal(canReuseEpicOptimizerResult('epic-arachne'),false);
assert.equal(canReuseEpicOptimizerResult('epic-briareus'),true);

const source={inputs:{leadership:'450000',monsterDD:'14',rankSeparation:'0.05',shareEpicArmy:true,encounterNorm:500,encounterPlanStrategy:'full',arachne:false,enemySquadTypes:['FLYING','MOUNTED','MELEE','RANGED']},selectedIds:{troop:['corax'],monster:['kraken'],mercenary:[]},methods:{custom:{orders:{troop:['corax'],monster:['kraken'],mercenary:[]}}}};
const target={inputs:{leadership:'200000',encounterNorm:250,encounterPlanStrategy:'merc-only',arachne:true,enemySquadTypes:['FLYING','FLYING','MOUNTED','MOUNTED','MELEE','MELEE','RANGED','RANGED']},selectedIds:{troop:[],monster:[],mercenary:[]},methods:{custom:{orders:{}}}};
copySharedEpicArmy(source,target);
assert.equal(target.inputs.leadership,'450000');
assert.equal(target.inputs.monsterDD,'14');
assert.equal(target.inputs.encounterNorm,250);
assert.equal(target.inputs.encounterPlanStrategy,'merc-only');
assert.equal(target.inputs.arachne,true);
assert.equal(target.inputs.enemySquadTypes.length,8);
assert.deepEqual(target.selectedIds,source.selectedIds);
assert.notEqual(target.selectedIds,source.selectedIds);
assert.deepEqual(target.methods.custom,source.methods.custom);
console.log('Shared Epic army regression checks passed.');
