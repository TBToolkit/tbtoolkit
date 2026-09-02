/** Shared physical and economic primitives for every TB Toolkit battle type. */
export const COMBAT_MECHANICS_BUILD='191';

export const BONUS_FAMILY_BY_SPECIES=Object.freeze({
  BEAST:'MONSTER',DRAGON:'MONSTER',ELEMENTAL:'MONSTER',GIANT:'MONSTER',
  HUMAN:'HUMAN',CURSED:'HUMAN',DEMON:'HUMAN',ELVES:'HUMAN',UNDEAD:'HUMAN',BARBARIAN:'HUMAN',
  'EPIC HUNTER':'EPIC_HUNTER',
});

export const ATTACKING_REVIVABLE_FRACTION=.90;

export function finiteNumber(value,label='Value'){
  const number=Number(value);
  if(!Number.isFinite(number))throw new Error(`${label} must be a finite number.`);
  return number;
}

export function pctPoints(value,label='Percentage'){
  return finiteNumber(value,label)/100;
}

export function clampProbability(value){return Math.max(0,Math.min(1,finiteNumber(value,'Probability')));}

export function bonusFamilyForSpecies(species){
  const family=BONUS_FAMILY_BY_SPECIES[String(species??'').toUpperCase()];
  if(!family)throw new Error(`Unknown bonus-family species: ${species}`);
  return family;
}

export function assertLegalQuantity(quantity,label='Quantity'){
  const value=finiteNumber(quantity,label);
  if(!Number.isInteger(value)||value<0)throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

/** Excel-compatible MROUND behavior for the positive quantities used by the calculators. */
export function mroundPositive(value,multiple=1){
  const number=finiteNumber(value,'MROUND value'),step=finiteNumber(multiple,'MROUND multiple');
  if(step<=0)throw new Error(`Invalid MROUND multiple: ${multiple}`);
  return Math.floor(number/step+.5+Number.EPSILON)*step;
}

export function attackingRevivableQuantity(quantity,fraction=ATTACKING_REVIVABLE_FRACTION){
  const legal=assertLegalQuantity(quantity,'Attacking quantity');
  const rate=Math.max(0,Math.min(1,finiteNumber(fraction,'Revivable fraction')));
  return Math.floor(legal*rate);
}

export function actualRevivalCost(rawCost,templeDivisor=1){
  const raw=Math.max(0,finiteNumber(rawCost,'Raw revival cost'));
  const divisor=finiteNumber(templeDivisor,'Temple revival divisor');
  if(!(divisor>0))throw new Error('Temple revival divisor must be > 0.');
  return raw/divisor;
}

export function squadRevivalCosts({quantity,goldEach=0,silverEach=0,templeDivisor=1,revivableFraction=ATTACKING_REVIVABLE_FRACTION}){
  const revivableQuantity=attackingRevivableQuantity(quantity,revivableFraction);
  const fullGold=assertLegalQuantity(quantity,'Attacking quantity')*Math.max(0,finiteNumber(goldEach,'Gold revival cost/unit'));
  const fullSilver=assertLegalQuantity(quantity,'Attacking quantity')*Math.max(0,finiteNumber(silverEach,'Silver revival cost/unit'));
  const revivableGoldRaw=revivableQuantity*Math.max(0,finiteNumber(goldEach,'Gold revival cost/unit'));
  const revivableSilverRaw=revivableQuantity*Math.max(0,finiteNumber(silverEach,'Silver revival cost/unit'));
  return{revivableQuantity,fullGold,fullSilver,revivableGoldRaw,revivableSilverRaw,
    actualGold:actualRevivalCost(revivableGoldRaw,templeDivisor),
    actualSilver:actualRevivalCost(revivableSilverRaw,templeDivisor)};
}
