/* Compatibility entry point. Production and offline paths share the module worker. */
import('./epic-optimizer-worker.mjs').catch(error=>self.postMessage({type:'error',message:error?.message||String(error),stack:error?.stack||''}));
