export function createOptimizerWorker(){
  return new Worker(new URL('./epic-optimizer-worker.mjs',import.meta.url),{type:'module',name:'epic-optimizer'});
}

export function createReviewWorker(){
  return new Worker(new URL('./epic-review-worker.mjs',import.meta.url),{type:'module',name:'epic-selection-review'});
}
