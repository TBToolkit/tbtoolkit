import {parseNumber} from './ui-utils.mjs';

export const ADJUSTMENT_PROFILES=Object.freeze({guardsman:'Guardsmen',specialist:'Specialists',engineer:'Engineers',epicHunter:'Epic Hunters'});
export const ADJUSTMENT_STATS=Object.freeze(['DD','ST','Health','StrengthAgainstEpic','FenrirStrength','Strength','PvpHealth','PvpStrength']);
export function bonusAdjustmentColumns({isPvp=false}={}){
  return [['DD','Double Damage'],['ST','Strike Twice'],...(isPvp?[['PvpHealth','Health PvP']]:[]),['Health','Health'],...(isPvp?[['PvpStrength','Strength PvP']]:[]),['Strength','Strength']];
}
export function bonusFieldId(profile,stat){
  return profile==='monster'&&['StrengthAgainstEpic','FenrirStrength','PvpHealth','PvpStrength'].includes(stat)?stat[0].toLowerCase()+stat.slice(1):profile+stat;
}
export function normalizeBonusAdjustments(value){
  return Object.fromEntries(Object.keys(ADJUSTMENT_PROFILES).map(profile=>[profile,Object.fromEntries(ADJUSTMENT_STATS.map(stat=>{
    const fallback=['Health','Strength'].includes(stat)?(profile==='epicHunter'?-741:-100):stat==='ST'?-5:0;
    const raw=value?.[profile]?.[stat];
    const n=typeof raw==='number'||typeof raw==='string'?Number(raw):NaN;
    return [stat,raw!==undefined&&raw!==null&&Number.isFinite(n)?n:fallback];
  }))]));
}
const clean=n=>Number(n.toFixed(10));
export function applyAutomaticBonusAdjustments(inputs,adjustments){
  const result={...inputs},offsets=normalizeBonusAdjustments(adjustments);
  const derive=(profile,stat)=>clean(Math.max(0,parseNumber(inputs[bonusFieldId('monster',stat)])+offsets[profile][stat]));
  if(inputs.autoHumanBonuses!==false)for(const stat of ADJUSTMENT_STATS)result[bonusFieldId('human',stat)]=String(derive('guardsman',stat));
  for(const profile of Object.keys(ADJUSTMENT_PROFILES)){
    const auto='auto'+profile[0].toUpperCase()+profile.slice(1)+'Bonuses';
    if(inputs[auto]===false)continue;
    for(const stat of ADJUSTMENT_STATS){
      // Retain the existing shared Human manual override for linked troops.
      result[bonusFieldId(profile,stat)]=String(profile!=='epicHunter'&&inputs.autoHumanBonuses===false?parseNumber(result[bonusFieldId('human',stat)]):derive(profile,stat));
    }
  }
  return result;
}
export function captureBonusAdjustments(inputs){
  return Object.fromEntries(Object.keys(ADJUSTMENT_PROFILES).map(profile=>[profile,Object.fromEntries(ADJUSTMENT_STATS.map(stat=>[stat,clean(parseNumber(inputs[bonusFieldId(profile,stat)])-parseNumber(inputs[bonusFieldId('monster',stat)]))]))]));
}
export function effectiveBonusAdjustments(account,inputs){
  return normalizeBonusAdjustments(inputs?.useEncounterBonusAdjustments?inputs.bonusAdjustments:account?.bonusAdjustments);
}
export function updateAccountBonusAdjustments(account,value){
  account.bonusAdjustments=normalizeBonusAdjustments(value);
  for(const workspace of Object.values(account.battle?.workspaces||{})){
    if(!workspace.inputs||workspace.inputs.useEncounterBonusAdjustments)continue;
    workspace.inputs.bonusAdjustments=normalizeBonusAdjustments(account.bonusAdjustments);
    Object.assign(workspace.inputs,applyAutomaticBonusAdjustments(workspace.inputs,account.bonusAdjustments));
  }
}
