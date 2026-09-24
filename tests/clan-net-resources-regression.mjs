import assert from 'node:assert/strict';
import {linkedPlayerAccounts,planForMethod,planMatchesRequirement,netResourcesForPeriod} from '../js/clan-net-resources.mjs';

const profileId='norm-clan';
const accounts=linkedPlayerAccounts({accounts:{one:{id:'one',name:'Biff',clanProfileId:profileId},two:{id:'two',name:'Other',clanProfileId:'elsewhere'}}},profileId);
assert.deepEqual(accounts,[{id:'one',name:'Biff'}]);
const optimize={method:'optimize',profileId,norm:500,unit:'M',basis:'points',clanMembers:100,selectedStrategy:'full',outcomes:{full:{complete:true,gold:{spent:40,net:60},silver:{spent:20,net:30},dragonCoins:{spent:10,net:10}}}};
const custom={...optimize,method:'custom',outcomes:{full:{complete:true,gold:{spent:50,net:50},silver:{spent:25,net:25},dragonCoins:{spent:15,net:5}}}};
const bridge={accounts:{one:{encounters:{doom:{name:'Doomsday',plansByMethod:{custom,optimize}}}}}};
assert.equal(planForMethod(bridge,'one','DOOMSDAY','optimize'),optimize);
assert.equal(planForMethod(bridge,'one','Doomsday','custom'),custom);
assert.equal(planForMethod(bridge,'two','Doomsday','custom'),null);
const requirement={basis:'points',value:500,unit:'M',pointsPerChest:50e6/7};
assert.equal(planMatchesRequirement(optimize,requirement,100,profileId),true);
assert.equal(planMatchesRequirement(optimize,{...requirement,value:600},100,profileId),false);
assert.equal(planMatchesRequirement(optimize,requirement,99,profileId),false);
assert.equal(planMatchesRequirement({...optimize,profileId:''},requirement,100,profileId),false);
const activities=[
  {name:'Doomsday',category:'Epic monsters',cadence:6,prorated:10,reward:{gold:10,potion:5,silver:8,dragonCoins:4}},
  {name:'Tinman',category:'Tinman',cadence:6,prorated:2,reward:{gold:20,potion:0,silver:10,dragonCoins:0}}
];
const result=netResourcesForPeriod(activities,new Map([['Doomsday',optimize]]),6);
assert.equal(result.complete,true);
assert.deepEqual(result.received,{revival:190,silver:100,dragonCoins:40});
assert.deepEqual(result.spent,{revival:40,silver:20,dragonCoins:10});
assert.deepEqual(result.net,{revival:150,silver:80,dragonCoins:30});
assert.deepEqual(netResourcesForPeriod(activities,new Map(),6),{complete:false,missing:['Doomsday']});
const month=netResourcesForPeriod([{...activities[0],cadence:24,prorated:2.5}],new Map([['Doomsday',optimize]]),6);
assert.equal(month.spent.revival,10,'A 24-day Epic contributes one quarter of its battle cost to a six-day period.');
assert.equal(month.received.revival,37.5);
console.log(JSON.stringify({ok:true,methods:2}));
