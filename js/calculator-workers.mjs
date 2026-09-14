export const OPTIMIZER_WATCHDOG_MS=195000;

export function createOptimizerWorker({watchdogMs=OPTIMIZER_WATCHDOG_MS}={}){
  const worker=new Worker(new URL('./epic-optimizer-worker.mjs',import.meta.url),{type:'module',name:'epic-optimizer'});
  const nativePostMessage=worker.postMessage.bind(worker);
  const nativeTerminate=worker.terminate.bind(worker);
  let watchdogId=null;
  let activeRequestId=null;

  const clearWatchdog=()=>{
    if(watchdogId!==null){clearTimeout(watchdogId);watchdogId=null;}
  };
  const finishRequest=()=>{
    clearWatchdog();
    activeRequestId=null;
  };

  worker.addEventListener('message',event=>{
    const message=event.data??{};
    if(activeRequestId===null||message.requestId!==activeRequestId)return;
    if(message.type==='result'||message.type==='error')finishRequest();
  });

  worker.postMessage=(message,transfer)=>{
    if(message?.type==='optimize'){
      clearWatchdog();
      activeRequestId=message.requestId;
      const delay=Math.max(1000,Number(watchdogMs)||OPTIMIZER_WATCHDOG_MS);
      watchdogId=setTimeout(()=>{
        if(activeRequestId===null)return;
        const requestId=activeRequestId;
        finishRequest();
        nativeTerminate();
        worker.dispatchEvent(new MessageEvent('message',{data:{
          type:'error',
          requestId,
          code:'WORKER_WATCHDOG',
          message:'Optimization stopped because the worker exceeded its safety limit. Try reducing the number of selected squads or run Optimize again.'
        }}));
      },delay);
    }
    return transfer===undefined?nativePostMessage(message):nativePostMessage(message,transfer);
  };

  worker.terminate=()=>{
    finishRequest();
    return nativeTerminate();
  };

  return worker;
}

export function createReviewWorker(){
  return new Worker(new URL('./epic-review-worker.mjs',import.meta.url),{type:'module',name:'epic-selection-review'});
}
