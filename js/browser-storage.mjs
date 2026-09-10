const BLOCKED_KEYS=new Set(['__proto__','prototype','constructor']);

export function validateSavedTree(value,{maxDepth=14,maxNodes=50_000,maxArrayLength=2_000,maxStringLength=100_000}={}){
  let nodes=0;
  const visit=(node,depth)=>{
    if(++nodes>maxNodes)throw new Error('Saved data is too large.');
    if(depth>maxDepth)throw new Error('Saved data is nested too deeply.');
    if(node===null||typeof node==='boolean')return;
    if(typeof node==='number'){
      if(!Number.isFinite(node))throw new Error('Saved data contains a non-finite number.');
      return;
    }
    if(typeof node==='string'){
      if(node.length>maxStringLength)throw new Error('Saved data contains an oversized string.');
      return;
    }
    if(Array.isArray(node)){
      if(node.length>maxArrayLength)throw new Error('Saved data contains an oversized list.');
      node.forEach(item=>visit(item,depth+1));return;
    }
    if(typeof node!=='object')throw new Error('Saved data contains an unsupported value.');
    for(const [key,item] of Object.entries(node)){
      if(BLOCKED_KEYS.has(key))throw new Error('Saved data contains an unsafe property.');
      visit(item,depth+1);
    }
  };
  visit(value,0);return value;
}

export function readSavedJson(storage,key,{maxBytes=2_000_000,validate=validateSavedTree}={}){
  const raw=storage.getItem(key);
  if(raw==null||raw==='')return null;
  if(raw.length>maxBytes)throw new Error('Saved data exceeds the browser-storage limit.');
  return validate(JSON.parse(raw));
}

export function writeSavedJson(storage,key,value,{maxBytes=2_000_000,validate=validateSavedTree}={}){
  validate(value);
  const raw=JSON.stringify(value);
  if(raw.length>maxBytes)throw new Error('Saved data exceeds the browser-storage limit.');
  storage.setItem(key,raw);
}

export function validateAccountState(value){
  validateSavedTree(value);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Saved calculator state must be an object.');
  if(value.accounts!==undefined){
    if(!value.accounts||typeof value.accounts!=='object'||Array.isArray(value.accounts))throw new Error('Saved accounts must be an object.');
    const accounts=Object.entries(value.accounts);
    if(!accounts.length||accounts.length>100)throw new Error('Saved calculator state has an invalid account count.');
    for(const [id,account] of accounts){
      if(!id||!account||typeof account!=='object'||Array.isArray(account))throw new Error('Saved calculator state contains an invalid account.');
      if(typeof account.name!=='string'||!account.name.trim()||account.name.length>60)throw new Error(`Saved account ${id} has an invalid name.`);
      if(account.battle?.workspaces&&Object.keys(account.battle.workspaces).length>100)throw new Error(`Saved account ${id} has too many workspaces.`);
    }
  }
  return value;
}
