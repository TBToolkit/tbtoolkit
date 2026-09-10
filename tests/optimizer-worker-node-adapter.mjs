import fs from 'node:fs/promises';
import {parentPort} from 'node:worker_threads';

const workerUrl=new URL('../js/epic-optimizer-worker.js',import.meta.url);
globalThis.self={
  location:{href:workerUrl.href},
  postMessage:message=>parentPort.postMessage(message)
};
globalThis.fetch=async input=>{
  const url=new URL(String(input));
  if(url.protocol!=='file:')throw new Error(`Unexpected test fetch URL: ${url}`);
  try{return new Response(await fs.readFile(url),{status:200});}
  catch{return new Response('',{status:404});}
};
await import(`${workerUrl.href}?node-test=1`);
parentPort.on('message',data=>self.onmessage({data}));
