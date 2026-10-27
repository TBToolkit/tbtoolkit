import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {captureExploreArmy,collectExploreArmies,exploreArmyKey,exploreResultRows,exploreContextKey,exploreSection2Context,exploreComparisonMatches} from '../js/epic-explore-results.mjs';
const payload=(eld,squads)=>({quantities:Object.fromEntries(squads.map(s=>[s.name,s.quantity])),result:{expectedTotalLifetimeDamage:eld,squads,cases:{largeTrace:true}},diagnostics:{unusualSacrifices:[],initialResult:{largeTrace:true}},exploreResults:{old:true}});
const a=payload(1000,[{id:'a',name:'A',quantity:100},{id:'b',name:'B',quantity:1}]);
const b=payload(999.999,[{id:'a',name:'A',quantity:101}]);
const starting=captureExploreArmy(a,['a','b'],'Starting army'),simple=captureExploreArmy(b,['a'],'Finalist 1');
const comparison=collectExploreArmies([starting,simple,captureExploreArmy(a,['b','a'],'Duplicate')],a);
assert.equal(comparison.armies.length,2,'Duplicate quantities must collapse');
assert.equal(comparison.activeId,starting.id);
assert.equal(simple.payload.exploreResults,undefined,'Comparison payloads must never nest');
assert.equal(simple.payload.result.cases,undefined,'Do not persist battle traces per finalist');
assert.equal(simple.payload.diagnostics.initialResult,undefined);
assert.equal(exploreArmyKey({...a,result:{...a.result,squads:[...a.result.squads].reverse()}}),starting.id);
const metrics={goldForSquad:s=>s.quantity*2,pointsForEld:eld=>eld/10};
const rows=exploreResultRows(comparison,metrics);
assert.equal(rows[0].best,true);assert.equal(rows[0].active,true);
assert.equal(rows[1].fewest,true);assert.equal(rows[1].squads.length,1);
assert.ok(rows[1].lossPct>0&&rows[1].lossPct<.001,'Tiny ELD differences must remain visible');
assert.equal(rows[0].points,100);assert.equal(rows[0].gold,202);
assert.equal(rows[0].efficiency,1000/202*1000);
assert.equal(exploreResultRows(comparison,{...metrics,sort:'units'})[0].id,simple.id);
assert.equal(exploreResultRows(comparison,{...metrics,goldForSquad:s=>s.id==='b'?50:1,sort:'gold'})[0].id,simple.id);
assert.equal(exploreResultRows(comparison,{...metrics,goldForSquad:s=>s.id==='b'?50:1,sort:'efficiency'})[0].id,simple.id);
const unknown=exploreResultRows(comparison,{goldForSquad:()=>0,pointsForEld:()=>null});
assert.equal(unknown[0].points,null);assert.equal(unknown[0].efficiency,null);

const source=fs.readFileSync(new URL('../js/epic-stacker.js',import.meta.url),'utf8');
const compact=source.slice(source.indexOf('function compactOptimizerPayloadForStorage('),source.indexOf('function persistOptimizerResult('));
const context=vm.createContext({payload:{...a,exploreResults:comparison}});
vm.runInContext(compact+'; saved=compactOptimizerPayloadForStorage(payload);',context);
const restored=JSON.parse(JSON.stringify(context.saved));
assert.equal(restored.exploreResults.armies.length,2);
restored.exploreResults.activeId=simple.id;
const switched={...restored.exploreResults.armies[1].payload,exploreResults:restored.exploreResults};
context.payload=switched;vm.runInContext('saved=compactOptimizerPayloadForStorage(payload);',context);
assert.equal(context.saved.exploreResults.activeId,simple.id);
assert.equal(context.saved.exploreResults.armies[0].id,starting.id,'Choosing a lower result must preserve the best for switching back');
const key=exploreContextKey({owner:'p|shadow',inputs:{health:1,limit:2},selection:['a']});
assert.equal(key,exploreContextKey({selection:['a'],inputs:{limit:2,health:1},owner:'p|shadow'}));
for(const change of [{owner:'other|shadow'},{owner:'p|other'},{inputs:{health:2,limit:2}},{selection:['b']}])assert.notEqual(key,exploreContextKey({owner:'p|shadow',inputs:{health:1,limit:2},selection:['a'],...change}));
console.log('Explore comparison collection, metrics, deduplication, compact persistence, and context checks passed.');
for(const [sort,first] of [['eld',simple.id],['points',simple.id],['loss',starting.id],['units',simple.id],['name',simple.id]]){
 const ascending=exploreResultRows(comparison,{...metrics,sort,direction:'asc'});
 const descending=exploreResultRows(comparison,{...metrics,sort,direction:'desc'});
 assert.equal(ascending[0].id,first,sort+' ascending');
 assert.equal(descending[1].id,first,sort+' descending');
}

const trimmed=payload(100,[{id:'a',name:'A',quantity:99}]);trimmed.quantities.A=100;
assert.equal(captureExploreArmy(trimmed,['a'],'Trimmed').payload.quantities.A,99,'Saved finalist quantities must match the scored army, including strict-health trimming');

const owner='player|epic-shadow-city';
const originalInputs={leadership:'1,000',authority:'200',dominance:'300',autoLeadership:true,monsterHealth:'2901.5',humanST:'13.6',autoHumanBonuses:true,guardsmanStrengthAgainstEpic:'2590',autoBeastBonuses:true,beastDD:'41.1',fenrirStrength:'0'};
const scoped={...comparison,owner,context:exploreSection2Context(owner,originalInputs)};
assert.equal(exploreComparisonMatches(scoped,owner,{...originalInputs,leadership:'1000.0',humanST:'13.6000'}),true,'Equivalent numeric formatting must match');
for(const [key,value] of Object.entries({leadership:'1001',authority:'201',dominance:'301',autoLeadership:false,monsterHealth:'2902',humanST:'14',autoHumanBonuses:false,guardsmanStrengthAgainstEpic:'2591',autoBeastBonuses:false,beastDD:'42',fenrirStrength:'1'})){
  assert.equal(exploreComparisonMatches(scoped,owner,{...originalInputs,[key]:value}),false,key+' must hide saved results');
  assert.equal(exploreComparisonMatches(scoped,owner,originalInputs),true,key+' must allow restoring results');
}
for(const key of ['includeMercenariesInOptimization','preserveMercenaries','shareEpicArmy','encounterNorm','clanMembers','encounterPlanStrategy','enemySquadTypes']){
  assert.equal(exploreComparisonMatches(scoped,owner,{...originalInputs,[key]:'changed'}),true,key+' is outside Section 2');
}
assert.equal(exploreComparisonMatches(scoped,'other|epic-shadow-city',originalInputs),false);
assert.equal(exploreComparisonMatches(scoped,'player|epic-arachne',originalInputs),false);
const legacy={...scoped,context:exploreContextKey({owner,inputs:originalInputs,selected:{troop:['old']},effective:'old',temple:45,encounter:{id:'epic-shadow-city'}})};
assert.equal(exploreComparisonMatches(legacy,owner,originalInputs),true,'Existing saved panels must migrate without rerunning Explore');
assert.equal(exploreComparisonMatches({...scoped,context:'broken'},owner,originalInputs),false);

// Exercise the actual panel renderer: mismatch hides without deleting, restores
// after reverting, and never marks a stale army as currently selected.
let liveInputs={...originalInputs};
const panel={hidden:false,dataset:{bound:'true'},querySelectorAll:()=>[]};
const elements={exploreResultsPanel:panel,exploreResultsRows:{querySelectorAll:()=>[],innerHTML:''},exploreResultsCount:{},exploreResultsStatus:{}};
const panelContext=vm.createContext({
  document:{getElementById:id=>elements[id]},lastOptimizedEpicPayload:{...a,exploreResults:scoped},
  epicResultCurrent:true,epicWorker:null,isBattleOptimizeMode:()=>true,
  exploreComparisonOwner:()=>owner,modeState:()=>({inputs:liveInputs}),exploreComparisonMatches,exploreResultRows,
  currentEncounter:()=>({builtIn:false}),actualRevivalCost:n=>n,rawSquadRevival:s=>s.quantity,
  armyV2:[],escapeHtml:String,TIER_COLORS:{},tierNumber:()=>1,formatInteger:String,formatDamage:String
});
const renderer=source.slice(source.indexOf('function renderExploreResultsPanel('),source.indexOf('function useExploreArmy('));
vm.runInContext(renderer,panelContext);
const render=()=>vm.runInContext('renderExploreResultsPanel()',panelContext);
render();assert.equal(panel.hidden,false);
liveInputs.leadership='999';render();assert.equal(panel.hidden,true);
assert.ok(panelContext.lastOptimizedEpicPayload.exploreResults,'Hiding must preserve the comparison');
liveInputs={...originalInputs};render();assert.equal(panel.hidden,false);
panelContext.epicResultCurrent=false;render();
assert.equal(elements.exploreResultsRows.innerHTML.includes('Currently selected'),false,'Changing selections must leave every saved finalist available to choose again');
assert.ok(elements.exploreResultsRows.innerHTML.includes('Use this army'));
const retainLine=source.split('\n').find(line=>line.includes('if(!exploring&&lastOptimizedEpicPayload?.exploreResults'));
panelContext.exploring=false;panelContext.msg={payload:{...b}};panelContext.exploreArmyKey=exploreArmyKey;
vm.runInContext(retainLine,panelContext);
assert.equal(panelContext.msg.payload.exploreResults.context,scoped.context,'Ordinary optimization must retain the original panel signature even while it is hidden');
console.log('Section 2 visibility, reversible hiding, legacy comparisons, and non-Explore optimization retention passed.');
