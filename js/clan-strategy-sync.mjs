import {saveAccountMetadataChange} from './account-metadata-storage.mjs';

export const REVIVAL_STRATEGIES=Object.freeze({
  full:'Revive All',
  'mercenary-monster':'Revive Mercs + Monsters',
  'mercenary-only':'Revive Mercs Only'
});

// The player workspace is the sole writable source for revival strategy.
// Derived clan plans read it when rendered instead of synchronizing copies.
export async function saveRevivalStrategy(storage,accountId,encounterName,strategy){
  if(!Object.hasOwn(REVIVAL_STRATEGIES,strategy))return false;
  const encounterId=`epic-${String(encounterName||'').toLowerCase().replace(/\s+/g,'-')}`;
  return saveAccountMetadataChange(storage,calculator=>{
    const inputs=calculator?.accounts?.[accountId]?.battle?.workspaces?.[encounterId]?.inputs;
    if(!inputs)return false;
    inputs.encounterPlanStrategy=strategy;
  });
}
