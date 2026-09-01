export const WORKSPACE_MODEL_BUILD='191-dev1';
export const COMBAT_TYPES=Object.freeze(['FLYING','MOUNTED','MELEE','RANGED']);

const FOUR_SQUADS=Object.freeze({FLYING:1,MOUNTED:1,MELEE:1,RANGED:1});
const EIGHT_SQUADS=Object.freeze({FLYING:2,MOUNTED:2,MELEE:2,RANGED:2});

function epic(id,name,arachne=false){
  return Object.freeze({id,name,battleType:'epic',builtIn:true,enemyFormation:{...(arachne?EIGHT_SQUADS:FOUR_SQUADS)},arachneBonus:arachne});
}
function pvp(id,name,model){return Object.freeze({id,name,battleType:'pvp',builtIn:true,pvpModel:model});}

export const BUILT_IN_ENCOUNTERS=Object.freeze([
  epic('epic-arachne','Arachne',true),
  epic('epic-armageddon','Armageddon'),
  epic('epic-arcanomancer','Arcanomancer'),
  epic('epic-doomsday','Doomsday'),
  epic('epic-hellforge','Hellforge'),
  epic('epic-basilisk','Basilisk'),
  epic('epic-briareus','Briareus'),
  epic('epic-shadow-city','Shadow City'),
  epic('epic-ashen','Ashen'),
  epic('epic-tinman','Tinman'),
  pvp('pvp-single','1 Enemy Squad','single'),
  pvp('pvp-unknown','Unknown Enemy Squads','unknown'),
]);
const BUILT_IN_BY_ID=new Map(BUILT_IN_ENCOUNTERS.map(encounter=>[encounter.id,encounter]));

export function normalizeEnemyFormation(source,{minimum=1,maximum=8}={}){
  const formation={};
  for(const type of COMBAT_TYPES)formation[type]=Math.max(0,Math.floor(Number(source?.[type])||0));
  const total=COMBAT_TYPES.reduce((sum,type)=>sum+formation[type],0);
  if(total<minimum||total>maximum)throw new Error(`Enemy formation must contain ${minimum}–${maximum} squads.`);
  return formation;
}
export function enemySquadTypes(formation){
  const normalized=normalizeEnemyFormation(formation);
  return COMBAT_TYPES.flatMap(type=>Array.from({length:normalized[type]},()=>type));
}
export function encounterEnemyCount(encounter){
  return encounter?.battleType==='epic'?enemySquadTypes(encounter.enemyFormation).length:(encounter?.pvpModel==='single'?1:null);
}
export function engineBattleType(encounter){
  if(encounter?.battleType==='epic')return'epic';
  return encounter?.pvpModel==='unknown'?'pvp_unknown':'pvp_single_cp';
}
export function encountersForAccount(account,battleType){
  return[
    ...BUILT_IN_ENCOUNTERS.filter(encounter=>encounter.battleType===battleType),
    ...Object.values(account?.customEncounters||{}).filter(encounter=>encounter.battleType===battleType)
  ].sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base',numeric:true}));
}
export function resolveEncounter(account,id){return BUILT_IN_BY_ID.get(id)||account?.customEncounters?.[id]||null;}
export function isBuiltInEncounter(id){return BUILT_IN_BY_ID.has(id);}

export function createCustomEncounter({id,name,battleType,enemyFormation,arachneBonus=false,pvpModel='single'}){
  const cleanName=String(name||'').trim();
  if(!cleanName)throw new Error('Enter an encounter name.');
  if(battleType==='epic')return{id, name:cleanName,battleType:'epic',builtIn:false,enemyFormation:normalizeEnemyFormation(enemyFormation),arachneBonus:!!arachneBonus};
  if(battleType==='pvp'&&!['single','unknown'].includes(pvpModel))throw new Error('Choose a valid PvP encounter model.');
  return{id,name:cleanName,battleType:'pvp',builtIn:false,pvpModel};
}

export function makeAccount({id='main',name='Main',templeLevel=45}={}){
  return{
    id,
    name:String(name||'Main').trim()||'Main',
    templeLevel:Math.max(1,Math.min(45,Math.floor(Number(templeLevel)||45))),
    customEncounters:{},
    battle:{
      activeBattleCategory:'epic',
      activeBattleType:'epic',
      activeEncounterId:'epic-doomsday',
      activeEncounterByType:{epic:'epic-doomsday',pvp:'pvp-single'},
      activeBattleMethod:'basic',
      workspaces:{},
    },
  };
}

export function uniqueStableId(prefix,existingIds){
  const used=new Set(existingIds||[]);let index=1,id=`${prefix}-${index}`;
  while(used.has(id)){index++;id=`${prefix}-${index}`;}
  return id;
}

export function validateAccountCollection(accounts,activeAccountId){
  const values=Object.values(accounts||{});
  if(!values.length)throw new Error('At least one player account is required.');
  if(!accounts?.[activeAccountId])throw new Error('The active player account does not exist.');
  return true;
}
