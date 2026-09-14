import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';

const requestId='stale-page-build';
const worker=new Worker(new URL('./optimizer-worker-node-adapter.mjs',import.meta.url));
const message=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{
    worker.terminate();
    reject(new Error('Optimizer build-handshake test timed out.'));
  },5_000);
  worker.on('message',candidate=>{
    if(candidate.requestId!==requestId)return;
    clearTimeout(timer);
    resolve(candidate);
    worker.terminate();
  });
  worker.on('error',reject);
  worker.postMessage({type:'optimize',requestId,appBuild:'stale-build'});
});

assert.equal(message.type,'error');
assert.equal(message.code,'BUILD_MISMATCH');
assert.match(message.message,/updated while this page was open/i);
assert.equal(message.pageBuild,'stale-build');
assert.ok(message.workerBuild);

console.log(JSON.stringify({ok:true,pageBuild:message.pageBuild,workerBuild:message.workerBuild}));
