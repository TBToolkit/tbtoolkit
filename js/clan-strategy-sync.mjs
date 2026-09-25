export const REVIVAL_STRATEGIES=Object.freeze({
  full:'Full Gold revival',
  'mercenary-monster':'Gold revive Mercenaries + Monsters',
  'mercenary-only':'Gold revive Mercenaries only'
});

const calculatorKey='tbtoolkit.stackingCalculator';

// The player workspace is the sole writable source for revival strategy.
// Derived clan plans read it when rendered instead of synchronizing copies.
export function saveRevivalStrategy(storage,accountId,encounterName,strategy){
  if(!Object.hasOwn(REVIVAL_STRATEGIES,strategy))return false;
  const calculator=JSON.parse(storage.getItem(calculatorKey)||'null');
  const encounterId=`epic-${String(encounterName||'').toLowerCase().replace(/\s+/g,'-')}`;
  const inputs=calculator?.accounts?.[accountId]?.battle?.workspaces?.[encounterId]?.inputs;
  if(!inputs)return false;
  inputs.encounterPlanStrategy=strategy;
  storage.setItem(calculatorKey,JSON.stringify(calculator));
  return true;
}
