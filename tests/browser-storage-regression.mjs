import assert from 'node:assert/strict';
import {readSavedJson,validateAccountState,validateSavedTree,writeSavedJson} from '../js/browser-storage.mjs';

const values=new Map();
const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
const valid={activeAccountId:'main',accounts:{main:{name:'Main',battle:{workspaces:{}}}}};
writeSavedJson(storage,'state',valid,{validate:validateAccountState});
assert.deepEqual(readSavedJson(storage,'state',{validate:validateAccountState}),valid);
assert.throws(()=>validateSavedTree({value:Infinity}),/non-finite/);
assert.throws(()=>validateSavedTree({rows:new Array(2001)}),/oversized list/);
assert.throws(()=>validateAccountState({accounts:{main:{name:''}}}),/invalid name/);
values.set('oversize','x'.repeat(101));
assert.throws(()=>readSavedJson(storage,'oversize',{maxBytes:100}),/exceeds/);
console.log(JSON.stringify({ok:true}));
