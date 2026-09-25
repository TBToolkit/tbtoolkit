import {stampCanonicalSnapshot,mirrorCanonicalSnapshot} from './durable-user-data.mjs';

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
  const snapshot=stampCanonicalSnapshot(calculator);
  storage.setItem(calculatorKey,JSON.stringify(snapshot));
  mirrorCanonicalSnapshot(calculatorKey,snapshot);
  return true;
}
