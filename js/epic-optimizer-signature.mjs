// Fixed separation belongs to Custom mode, not the Epic optimizer. Strip it
// from older saved signatures so a preview update does not discard results.
export function normalizeEpicOptimizerSignature(signature){
  if(typeof signature!=='string')return '';
  try{
    const parsed=JSON.parse(signature);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||!Object.hasOwn(parsed,'rankSeparation'))return signature;
    delete parsed.rankSeparation;
    return JSON.stringify(parsed);
  }catch{return signature;}
}
