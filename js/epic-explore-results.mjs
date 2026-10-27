import {parseNumber} from './ui-utils.mjs';

// Keep this scope limited to Army Limits & Unit Bonuses (Section 2).
// Selections, Explore settings, clan planning, and account settings are separate.
export function exploreSection2Context(owner,inputs){
  const numeric=['leadership','authority','dominance','leadershipFill','authorityFill','dominanceFill','strengthAgainstEpic','fenrirStrength','pvpHealth','pvpStrength','rankSeparation'];
  const flags=['autoLeadership','autoAuthority','autoDominance','arachne','minimumSeparation'];
  for(const profile of ['monster','beast','dragon','elemental','giant','human','guardsman','specialist','engineer','epicHunter']){
    numeric.push(...['Health','Strength','DD','ST','PvpHealth','FenrirStrength','StrengthAgainstEpic','PvpStrength'].map(stat=>profile+stat));
    if(profile!=='monster')flags.push('auto'+profile[0].toUpperCase()+profile.slice(1)+'Bonuses');
  }
  const values={};
  for(const key of numeric)values[key]=parseNumber(inputs?.[key]);
  for(const key of flags)values[key]=!!inputs?.[key];
  return exploreContextKey({scope:'section2',owner,inputs:values});
}

export function exploreComparisonMatches(comparison,owner,inputs){
  if(comparison?.version!==1||comparison.owner!==owner)return false;
  try{
    const saved=JSON.parse(comparison.context);
    // Older panels saved the entire workspace; project their original inputs
    // onto Section 2 so existing player files and browser results still work.
    return saved.owner===owner&&saved.inputs&&exploreSection2Context(owner,saved.inputs)===exploreSection2Context(owner,inputs);
  }catch{return false;}
}

export function exploreArmyKey(payload){
  return JSON.stringify((payload?.result?.squads||[]).filter(s=>s.quantity>0).map(s=>[s.id,s.quantity]).sort(([a],[b])=>a.localeCompare(b)));
}

export function captureExploreArmy(payload,selectedIds,label){
  const result={...payload.result};delete result.cases;
  const diagnostics={};
  for(const key of ['unusualSacrifices','mercenaryOptimizationMode','fixedMercenaries','optimizerCoreExpectedLifetimeDamage','combinedExpectedLifetimeDamage','totalEvaluations']){
    if(payload.diagnostics?.[key]!==undefined)diagnostics[key]=payload.diagnostics[key];
  }
  return {id:exploreArmyKey(payload),label,selectedIds:[...selectedIds],payload:{quantities:Array.isArray(result.squads)?Object.fromEntries(result.squads.filter(s=>s.quantity>0).map(s=>[s.name,s.quantity])):{...payload.quantities},result,diagnostics}};
}

export function collectExploreArmies(rows,winner){
  const unique=new Map();
  for(const row of rows)if(!unique.has(row.id))unique.set(row.id,row);
  return {version:1,activeId:exploreArmyKey(winner),armies:[...unique.values()]};
}

export function exploreContextKey(value){
  const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
  return JSON.stringify(stable(value));
}

export function exploreResultRows(comparison,{goldForSquad,pointsForEld,sort='eld',direction}){
  const rows=(comparison?.armies||[]).map(army=>{
    const squads=(army.payload?.result?.squads||[]).filter(s=>s.quantity>0);
    const eld=Number(army.payload?.result?.expectedTotalLifetimeDamage)||0;
    const gold=squads.reduce((sum,s)=>sum+goldForSquad(s),0);
    return {...army,squads,eld,gold,points:pointsForEld(eld),efficiency:gold>0?eld/gold*1000:null,unitCount:squads.length};
  });
  const best=Math.max(0,...rows.map(r=>r.eld)),fewest=Math.min(...rows.map(r=>r.unitCount));
  for(const row of rows){row.lossPct=best>0?(best-row.eld)/best*100:0;row.best=row.eld===best;row.fewest=row.unitCount===fewest;row.active=row.id===comparison.activeId;}
  const order={name:(a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}),loss:(a,b)=>a.lossPct-b.lossPct,points:(a,b)=>(b.points??-1)-(a.points??-1),eld:(a,b)=>b.eld-a.eld,units:(a,b)=>a.unitCount-b.unitCount,gold:(a,b)=>a.gold-b.gold,efficiency:(a,b)=>(b.efficiency??-1)-(a.efficiency??-1)};
  const naturalAscending=['name','loss','units','gold'].includes(sort);
  const factor=direction&&((direction==='asc')!==naturalAscending)?-1:1;
  return rows.sort((a,b)=>factor*(order[sort]||order.eld)(a,b)||b.eld-a.eld||a.id.localeCompare(b.id));
}
