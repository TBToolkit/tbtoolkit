import assert from 'node:assert/strict';
import {linkedPlayerAccounts,planForMethod,planMatchesRequirement,convertEpicNormBasis,netResourcesForPeriod} from '../js/clan-net-resources.mjs';

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
assert.equal(planMatchesRequirement({...optimize,profileId:''},requirement,100,profileId,{acceptUnlinkedPlan:true}),true,'A matching local plan may be used after the player is explicitly linked to the clan.');
assert.equal(planMatchesRequirement({...optimize,profileId:'another-clan'},requirement,100,profileId,{acceptUnlinkedPlan:true}),false,'A plan linked to another clan must not be reused.');
const arachneChestPoints=300e6/35,arachneNorm={value:2.5,unit:'B',basis:'points',pointsPerChest:arachneChestPoints};
const chests=convertEpicNormBasis(arachneNorm,'chests');
assert.equal(chests.value,291,'Switching to chests must convert the point norm, not relabel its number.');
assert.equal(chests.basis,'chests');
const arachnePlan={...optimize,norm:2.5,unit:'B',basis:'points'};
assert.equal(planMatchesRequirement(arachnePlan,{...chests,pointsPerChest:arachneChestPoints},100,profileId),true,'A basis switch with the same whole-chest payout must keep the saved plan ready.');
assert.equal(planMatchesRequirement(arachnePlan,{...chests,value:292,pointsPerChest:arachneChestPoints},100,profileId),false,'Editing the chest norm must still invalidate an unmatched plan.');
const pointsAgain=convertEpicNormBasis({...chests,pointsPerChest:arachneChestPoints},'points');
assert.equal(planMatchesRequirement(arachnePlan,{...pointsAgain,pointsPerChest:arachneChestPoints},100,profileId),false,'Changing the actual point target remains distinct from merely changing its display basis.');
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
