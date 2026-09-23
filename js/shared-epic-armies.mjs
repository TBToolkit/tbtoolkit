export const EPIC_ARMY_GROUPS=Object.freeze({
  'one-captain':Object.freeze({label:'1 Captain',encounters:Object.freeze(['epic-tinman','epic-hellforge','epic-doomsday','epic-fenrir','epic-jormungandr','epic-chimera'])}),
  'one-hero':Object.freeze({label:'1 Hero',encounters:Object.freeze(['epic-basilisk','epic-armageddon'])}),
  'hero-three-captains':Object.freeze({label:'1 Hero + 3 Captains',encounters:Object.freeze(['epic-ashen','epic-shadow-city'])}),
  'three-captains':Object.freeze({label:'3 Captains',encounters:Object.freeze(['epic-arachne','epic-arcanomancer','epic-briareus'])})
});

const ENCOUNTER_ONLY_INPUTS=new Set([
  'battleType','battleMethod','arachne','enemySquadTypes','enemyUnitId',
  'pvpHealth','pvpStrength','clanMembers','encounterNorm','encounterNormUnit',
  'encounterNormBasis','encounterPlanStrategy','shareEpicArmy'
]);

export function epicArmyGroup(encounterId){
  return Object.entries(EPIC_ARMY_GROUPS).find(([,group])=>group.encounters.includes(encounterId))?.[0]||null;
}

export function canReuseEpicOptimizerResult(encounterId){
  return !!epicArmyGroup(encounterId)&&encounterId!=='epic-arachne';
}

export function copySharedEpicArmy(source,target){
  if(!source?.inputs||!target?.inputs)return;
  for(const [key,value] of Object.entries(source.inputs)){
    if(!ENCOUNTER_ONLY_INPUTS.has(key))target.inputs[key]=structuredClone(value);
  }
  target.selectedIds=structuredClone(source.selectedIds||{troop:[],monster:[],mercenary:[]});
  if(source.methods?.custom&&target.methods?.custom){
    target.methods.custom=structuredClone(source.methods.custom);
  }
}
