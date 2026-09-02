export const BIFF_FORMAT='tbtoolkit-biff';
export const BIFF_SCHEMA_VERSION=1;
export const BIFF_MAX_BYTES=5*1024*1024;

const CATEGORIES=Object.freeze(['troop','monster','mercenary']);
const BATTLE_CATEGORIES=new Set(['epic','pvp']);
const BATTLE_METHODS=new Set(['basic','custom','optimize']);
const PVP_MODELS=new Set(['single','unknown']);
const FORBIDDEN_KEYS=new Set(['__proto__','prototype','constructor']);
const INPUT_KEYS=new Set([
  'leadership','leadershipFill','autoLeadership','authority','authorityFill','autoAuthority',
  'dominance','dominanceFill','autoDominance','monsterHealth','humanHealth','epicHunterHealth',
  'pvpHealth','monsterStrength','strengthAgainstEpic','pvpStrength','monsterDD','monsterST',
  'humanStrength','epicHunterStrength','humanDD','epicHunterDD','humanST','epicHunterST',
  'useCustomFamilyBonuses','useCustomHealthInputs','includeMercenariesInOptimization','arachne',
  'battleType','battleMethod','enemyUnitId','minimumSeparation','rankSeparation','enemySquadTypes'
]);

function fail(message){throw new Error(message);}
function cleanText(value,label,{maximum=80}={}){
  const text=String(value??'').trim();
  if(!text)fail(`${label} is required.`);
  if(text.length>maximum)fail(`${label} is too long.`);
  return text;
}
function cleanId(value,label='ID'){
  const id=cleanText(value,label,{maximum:100});
  if(FORBIDDEN_KEYS.has(id))fail(`${label} uses a reserved value.`);
  return id;
}
function ownEntries(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return[];
  return Object.entries(value).filter(([key])=>!FORBIDDEN_KEYS.has(key));
}
function cleanStringArray(value){
  if(!Array.isArray(value))return[];
  return [...new Set(value.map(item=>String(item||'').trim()).filter(Boolean))];
}
function cleanSelectedIds(value){
  return Object.fromEntries(CATEGORIES.map(category=>[category,cleanStringArray(value?.[category])]));
}
function cleanOrders(value){return cleanSelectedIds(value);}
function cleanNestedOrders(value,{booleans=false}={}){
  const output={troop:{},monster:{},mercenary:{}};
  for(const category of CATEGORIES){
    for(const [level,raw] of ownEntries(value?.[category])){
      const key=String(level).trim();
      if(!key)continue;
      output[category][key]=booleans?!!raw:cleanStringArray(raw);
    }
  }
  return output;
}
function cleanInputs(value){
  const output={};
  for(const [key,raw] of ownEntries(value)){
    if(!INPUT_KEYS.has(key))continue;
    if(key==='enemySquadTypes')output[key]=cleanStringArray(raw).filter(type=>['FLYING','MOUNTED','MELEE','RANGED'].includes(type)).slice(0,8);
    else if(['autoLeadership','autoAuthority','autoDominance','useCustomFamilyBonuses','useCustomHealthInputs','includeMercenariesInOptimization','arachne','minimumSeparation'].includes(key))output[key]=!!raw;
    else if(['battleType','battleMethod','enemyUnitId'].includes(key))output[key]=String(raw??'');
    else if(typeof raw==='string'||typeof raw==='number')output[key]=raw;
  }
  return output;
}
function normalizeFormation(value){
  const formation={};let total=0;
  for(const type of ['FLYING','MOUNTED','MELEE','RANGED']){
    const count=Math.max(0,Math.floor(Number(value?.[type])||0));
    formation[type]=count;total+=count;
  }
  if(total<1||total>8)fail('Epic enemy formation must contain 1–8 squads.');
  return formation;
}
function normalizeEncounter(raw){
  const id=cleanId(raw?.id,'Encounter ID');
  const name=cleanText(raw?.name,'Encounter name',{maximum:60});
  const battleType=String(raw?.battleType||'');
  if(battleType==='epic')return{id,name,battleType,builtIn:false,enemyFormation:normalizeFormation(raw?.enemyFormation),arachneBonus:!!raw?.arachneBonus};
  if(battleType==='pvp'){
    const pvpModel=String(raw?.pvpModel||'');
    if(!PVP_MODELS.has(pvpModel))fail(`Encounter “${name}” has an invalid PvP model.`);
    return{id,name,battleType,builtIn:false,pvpModel};
  }
  fail(`Encounter “${name}” has an invalid battle type.`);
}
function normalizeWorkspace(raw){
  const encounterId=cleanId(raw?.encounterId,'Workspace encounter ID');
  const custom=raw?.customOrder||{};
  return{
    encounterId,
    inputs:cleanInputs(raw?.inputs),
    selectedIds:cleanSelectedIds(raw?.selectedIds),
    customOrder:{
      orders:cleanOrders(custom?.orders),
      unitOrders:cleanNestedOrders(custom?.unitOrders),
      unitOrderManual:cleanNestedOrders(custom?.unitOrderManual,{booleans:true}),
      squadOrder:cleanOrders(custom?.squadOrder)
    }
  };
}
function canonicalAccount(raw){
  const battle=raw?.battle||{};
  const customEncounters=Object.values(raw?.customEncounters||{}).map(normalizeEncounter).sort((a,b)=>a.id.localeCompare(b.id));
  const workspaces=ownEntries(battle.workspaces).map(([encounterId,workspace])=>normalizeWorkspace({
    encounterId,inputs:workspace?.inputs,selectedIds:workspace?.selectedIds,
    customOrder:workspace?.methods?.custom||workspace
  })).sort((a,b)=>a.encounterId.localeCompare(b.encounterId));
  return{
    id:cleanId(raw?.id,'Account ID'),
    name:cleanText(raw?.name,'Account name',{maximum:60}),
    templeLevel:Math.max(1,Math.min(45,Math.floor(Number(raw?.templeLevel)||45))),
    activeBattleCategory:BATTLE_CATEGORIES.has(battle.activeBattleCategory)?battle.activeBattleCategory:'epic',
    activeBattleMethod:BATTLE_METHODS.has(battle.activeBattleMethod)?battle.activeBattleMethod:'basic',
    activeEncounterByType:{
      epic:cleanId(battle.activeEncounterByType?.epic||'epic-doomsday','Active Epic encounter ID'),
      pvp:cleanId(battle.activeEncounterByType?.pvp||'pvp-single','Active PvP encounter ID')
    },
    customEncounters,
    workspaces
  };
}

export function serializeAccountToBiff(account,{appBuild='unknown',exportedAt=new Date().toISOString()}={}){
  const envelope={format:BIFF_FORMAT,schemaVersion:BIFF_SCHEMA_VERSION,exportedAt:String(exportedAt),appBuild:String(appBuild),kind:'account',account:canonicalAccount(account)};
  return `${JSON.stringify(envelope,null,2)}\n`;
}

export function parseBiff(text,{maxBytes=BIFF_MAX_BYTES}={}){
  const source=String(text??'');
  if(new TextEncoder().encode(source).length>maxBytes)fail('This .biff file is larger than 5 MB.');
  let raw;try{raw=JSON.parse(source);}catch{fail('This file is not valid .biff JSON.');}
  if(raw?.format!==BIFF_FORMAT)fail('This is not a TB Toolkit .biff file.');
  if(!Number.isInteger(raw?.schemaVersion)||raw.schemaVersion<1)fail('This .biff file has an invalid schema version.');
  if(raw.schemaVersion>BIFF_SCHEMA_VERSION)fail(`This .biff file uses newer schema version ${raw.schemaVersion}.`);
  if(raw?.kind!=='account')fail('This .biff file does not contain a supported account export.');
  const rawEncounters=Array.isArray(raw.account?.customEncounters)?raw.account.customEncounters:[];
  const rawEncounterIds=rawEncounters.map(row=>String(row?.id||''));
  if(new Set(rawEncounterIds).size!==rawEncounterIds.length)fail('This .biff file contains duplicate encounter IDs.');
  const rawWorkspaces=Array.isArray(raw.account?.workspaces)?raw.account.workspaces:[];
  const rawWorkspaceIds=rawWorkspaces.map(row=>String(row?.encounterId||''));
  if(new Set(rawWorkspaceIds).size!==rawWorkspaceIds.length)fail('This .biff file contains duplicate workspace IDs.');
  const account=canonicalAccount({
    ...raw.account,
    customEncounters:Object.fromEntries(rawEncounters.map(row=>[row?.id,row])),
    battle:{
      activeBattleCategory:raw.account?.activeBattleCategory,
      activeBattleMethod:raw.account?.activeBattleMethod,
      activeEncounterByType:raw.account?.activeEncounterByType,
      workspaces:Object.fromEntries(rawWorkspaces.map(row=>[row?.encounterId,{...row,methods:{custom:row?.customOrder}}]))
    }
  });
  return{format:BIFF_FORMAT,schemaVersion:BIFF_SCHEMA_VERSION,exportedAt:String(raw.exportedAt||''),appBuild:String(raw.appBuild||''),kind:'account',account};
}

function allocateId(preferred,used){
  if(!used.has(preferred)){used.add(preferred);return preferred;}
  let index=2,candidate=`${preferred}-${index}`;
  while(used.has(candidate)){index++;candidate=`${preferred}-${index}`;}
  used.add(candidate);return candidate;
}
function filterKnownIds(ids,known,warnings,label){
  const output=[];
  for(const id of ids){
    if(known&& !known.has(id)){warnings.push(`${label}: removed unknown unit “${id}”.`);continue;}
    if(!output.includes(id))output.push(id);
  }
  return output;
}

export function materializeImportedAccount(parsed,{existingAccountIds=[],existingEncounterIds=[],builtInEncounterIds=[],armyIds=null}={}){
  const source=parsed?.account||fail('No .biff account is available to import.');
  const warnings=[];
  const accountId=allocateId(source.id,new Set(existingAccountIds));
  if(accountId!==source.id)warnings.push(`Account ID changed from “${source.id}” to “${accountId}” to avoid a collision.`);
  const usedEncounters=new Set([...existingEncounterIds,...builtInEncounterIds]);
  const encounterIdMap=new Map();
  const customEncounters={};
  for(const encounter of source.customEncounters){
    const id=allocateId(encounter.id,usedEncounters);encounterIdMap.set(encounter.id,id);
    if(id!==encounter.id)warnings.push(`Encounter “${encounter.name}” received a new internal ID to avoid a collision.`);
    customEncounters[id]={...encounter,id};
  }
  const knownUnits=armyIds?new Set(armyIds):null;
  const workspaces={};
  for(const workspace of source.workspaces){
    const encounterId=encounterIdMap.get(workspace.encounterId)||workspace.encounterId;
    const selectedIds={};const custom=workspace.customOrder;
    for(const category of CATEGORIES)selectedIds[category]=filterKnownIds(workspace.selectedIds[category],knownUnits,warnings,`${encounterId} ${category} selection`);
    const allowedByCategory=Object.fromEntries(CATEGORIES.map(category=>[category,new Set(selectedIds[category])]));
    const cleanCategoryOrder=value=>Object.fromEntries(CATEGORIES.map(category=>[category,(value?.[category]||[]).filter(id=>allowedByCategory[category].has(id))]));
    const cleanNested=value=>{
      const output={troop:{},monster:{},mercenary:{}};
      for(const category of CATEGORIES)for(const [level,ids] of ownEntries(value?.[category]))output[category][level]=ids.filter(id=>allowedByCategory[category].has(id));
      return output;
    };
    const cleanManual=value=>{
      const output={troop:{},monster:{},mercenary:{}};
      for(const category of CATEGORIES)for(const [level,manual] of ownEntries(value?.[category]))output[category][level]=!!manual;
      return output;
    };
    workspaces[encounterId]={
      inputs:{...workspace.inputs},selectedIds,
      methods:{basic:{},custom:{orders:cleanCategoryOrder(custom.orders),unitOrders:cleanNested(custom.unitOrders),unitOrderManual:cleanManual(custom.unitOrderManual),squadOrder:cleanCategoryOrder(custom.squadOrder)},optimize:{resultCache:null}}
    };
  }
  const mapEncounter=id=>encounterIdMap.get(id)||id;
  const builtIns=new Set(builtInEncounterIds),available=new Set([...builtIns,...Object.keys(customEncounters)]);
  const mappedActive={epic:mapEncounter(source.activeEncounterByType.epic),pvp:mapEncounter(source.activeEncounterByType.pvp)};
  const fallbackEncounter=category=>{
    const preferred=category==='epic'?'epic-doomsday':'pvp-single';
    if(builtIns.has(preferred))return preferred;
    return Object.values(customEncounters).find(row=>row.battleType===category)?.id||preferred;
  };
  const activeEncounterByType={...mappedActive};
  for(const category of ['epic','pvp'])if(!available.has(activeEncounterByType[category])){
    warnings.push(`The active ${category==='epic'?'Epic':'PvP'} encounter “${activeEncounterByType[category]}” is unavailable and was reset.`);
    activeEncounterByType[category]=fallbackEncounter(category);
  }
  for(const encounterId of Object.keys(workspaces))if(!available.has(encounterId))warnings.push(`Saved workspace “${encounterId}” was retained but its encounter is unavailable in this version.`);
  return{
    account:{id:accountId,name:source.name,templeLevel:source.templeLevel,customEncounters,battle:{
      activeBattleCategory:source.activeBattleCategory,
      activeBattleMethod:source.activeBattleMethod,
      activeEncounterByType,
      activeEncounterId:activeEncounterByType[source.activeBattleCategory],
      workspaces
    }},
    warnings,
    summary:{accountName:source.name,encounterCount:source.customEncounters.length,workspaceCount:source.workspaces.length}
  };
}
