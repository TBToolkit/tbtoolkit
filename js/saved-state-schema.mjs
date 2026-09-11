export const SAVED_STATE_KEY='tbtoolkit.stackingCalculator';
export const SAVED_STATE_SCHEMA_VERSION=20;
export const LEGACY_SAVED_STATE_KEYS=[
  {key:'tbtoolkit.stackingCalculator.v18',schemaVersion:18},
  {key:'tbtoolkit.stackingCalculator.v17',schemaVersion:17},
];

const migrations=new Map([
  [17,state=>state],
  [18,state=>state],
  [19,state=>state],
]);

export function migrateSavedState(value,fromVersion){
  let state=structuredClone(value);
  let version=Number(fromVersion);
  if(!Number.isInteger(version)||version<17||version>SAVED_STATE_SCHEMA_VERSION)throw new Error('Saved calculator state uses an unsupported schema.');
  while(version<SAVED_STATE_SCHEMA_VERSION){
    const migrate=migrations.get(version);
    if(!migrate)throw new Error(`No saved-state migration exists for schema ${version}.`);
    state=migrate(state);version++;
  }
  return{...state,schemaVersion:SAVED_STATE_SCHEMA_VERSION};
}

export function readLatestSavedState(storage,readJson,options){
  const current=readJson(storage,SAVED_STATE_KEY,options);
  if(current)return{state:migrateSavedState(current,current.schemaVersion??SAVED_STATE_SCHEMA_VERSION),sourceKey:SAVED_STATE_KEY};
  for(const legacy of LEGACY_SAVED_STATE_KEYS){
    const value=readJson(storage,legacy.key,options);
    if(value)return{state:migrateSavedState(value,legacy.schemaVersion),sourceKey:legacy.key};
  }
  return null;
}
