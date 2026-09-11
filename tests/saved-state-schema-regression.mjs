import assert from 'node:assert/strict';
import {LEGACY_SAVED_STATE_KEYS,SAVED_STATE_KEY,SAVED_STATE_SCHEMA_VERSION,migrateSavedState,readLatestSavedState} from '../js/saved-state-schema.mjs';

const values=new Map();
const storage={getItem:key=>values.get(key)??null};
const readJson=(_storage,key)=>{const raw=_storage.getItem(key);return raw?JSON.parse(raw):null;};
values.set(LEGACY_SAVED_STATE_KEYS[0].key,JSON.stringify({accounts:{main:{name:'Main'}}}));
const legacy=readLatestSavedState(storage,readJson);
assert.equal(legacy.sourceKey,'tbtoolkit.stackingCalculator.v18');
assert.equal(legacy.state.schemaVersion,SAVED_STATE_SCHEMA_VERSION);
assert.equal(migrateSavedState({accounts:{old:{name:'Old'}}},19).schemaVersion,SAVED_STATE_SCHEMA_VERSION);
values.set(SAVED_STATE_KEY,JSON.stringify({schemaVersion:SAVED_STATE_SCHEMA_VERSION,accounts:{new:{name:'New'}}}));
const current=readLatestSavedState(storage,readJson);
assert.equal(current.sourceKey,SAVED_STATE_KEY);
assert.ok(current.state.accounts.new);
assert.throws(()=>migrateSavedState({},16),/unsupported schema/);
assert.throws(()=>migrateSavedState({},SAVED_STATE_SCHEMA_VERSION+1),/unsupported schema/);
console.log(JSON.stringify({ok:true,schemaVersion:SAVED_STATE_SCHEMA_VERSION}));
