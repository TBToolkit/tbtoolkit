export const REVIVAL_STRATEGIES=Object.freeze({
  full:'Full Gold revival',
  'mercenary-monster':'Gold revive Mercenaries + Monsters',
  'mercenary-only':'Gold revive Mercenaries only'
});

const bridgeKey='tbtoolkit.epicEncounterResults.v1';
const calculatorKey='tbtoolkit.stackingCalculator';

export function saveRevivalStrategy(storage,accountId,encounterName,strategy){
  if(!Object.hasOwn(REVIVAL_STRATEGIES,strategy))return false;
  const bridge=JSON.parse(storage.getItem(bridgeKey)||'null');
  const account=bridge?.accounts?.[accountId];
  const entry=Object.entries(account?.encounters||{}).find(([,encounter])=>String(encounter?.name||'').toUpperCase()===String(encounterName||'').toUpperCase());
  if(!entry)return false;
  const [encounterId,encounter]=entry;
  for(const plan of Object.values(encounter.plansByMethod||{}))if(plan)plan.selectedStrategy=strategy;
  if(encounter.plan)encounter.plan.selectedStrategy=strategy;

  const calculator=JSON.parse(storage.getItem(calculatorKey)||'null');
  const inputs=calculator?.accounts?.[accountId]?.battle?.workspaces?.[encounterId]?.inputs;
  if(inputs)inputs.encounterPlanStrategy=strategy;
  const planKey=`tbtoolkit.encounterPlan.v1.${accountId}.${encounterId}`;
  const savedPlan=JSON.parse(storage.getItem(planKey)||'null')||{};
  savedPlan.strategy=strategy;

  if(inputs)storage.setItem(calculatorKey,JSON.stringify(calculator));
  storage.setItem(planKey,JSON.stringify(savedPlan));
  storage.setItem(bridgeKey,JSON.stringify(bridge));
  return true;
}
