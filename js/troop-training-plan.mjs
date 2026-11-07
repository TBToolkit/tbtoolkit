import {attackingRevivableQuantity} from './combat-mechanics.mjs';
import {ENCOUNTER_PLAN_STRATEGIES} from './encounter-plan.mjs';

export const TRAINING_FAMILIES=Object.freeze({GUARDSMAN:'Guardsmen',SPECIALIST:'Specialists',ENGINEER:'Engineers',MONSTER:'Monsters'});
const typeOrder=['RANGED','MELEE','MOUNTED','FLYING'];
// Monster barracks order, as shown in the game (not the Results death order).
const monsterOrder={
  3:['water-elemental','battle-boar','emerald-dragon','stone-gargoyle'],
  4:['magic-dragon','gorgon-medusa','many-armed-guardian','ice-phoenix'],
  5:['ettin','desert-vanquisher','flaming-centaur','fearsome-manticore'],
  6:['crystal-dragon','ruby-golem','jungle-destroyer','troll-rider'],
  7:['destructive-colossus','wind-lord','ancient-terror','black-dragon'],
  8:['trickster-1','kraken-1','devastator-1','fire-phoenix-1'],
  9:['trickster-2','kraken-2','devastator-2','fire-phoenix-2'],
};

export function parseTrainingAttacks(value){
  const text=String(value??'').trim();
  return /^\d+$/.test(text)&&BigInt(text)>0n?BigInt(text):null;
}

export function troopTrainingPlan({squads=[],units=[],attacks='1',strategy='full'}={}){
  const count=parseTrainingAttacks(attacks);
  if(count===null)return null;
  const byId=new Map(units.map(u=>[u.id,u]));
  const groups=Object.fromEntries(Object.keys(TRAINING_FAMILIES).map(key=>[key,[]]));
  const revived=ENCOUNTER_PLAN_STRATEGIES[strategy]||ENCOUNTER_PLAN_STRATEGIES.full;
  for(const squad of squads){
    const unit=byId.get(squad.id),quantity=Number(squad.quantity??squad.qty);
    if(!unit||unit.category==='mercenary'||!Number.isSafeInteger(quantity)||quantity<=0)continue;
    const family=unit.category==='monster'?'MONSTER':unit.unitClass;
    if(!groups[family])continue;
    const recovered=revived[unit.category]?attackingRevivableQuantity(quantity):0;
    const row={...unit,quantity,required:BigInt(quantity)+(count-1n)*BigInt(quantity-recovered)};
    const existing=groups[family].find(r=>r.id===row.id);
    if(existing){existing.quantity+=row.quantity;existing.required+=row.required;}
    else groups[family].push(row);
  }
  for(const [family,rows] of Object.entries(groups)){
    const highest=Math.max(0,...rows.map(r=>r.tierNumber));
    const tierRank=r=>r.tierNumber===highest?0:r.tierNumber;
    const unitRank=r=>family==='MONSTER'?(monsterOrder[r.tierNumber]||[]).findIndex(name=>r.id.endsWith('-'+name)):typeOrder.indexOf(r.combatType);
    rows.sort((a,b)=>tierRank(a)-tierRank(b)||unitRank(a)-unitRank(b)||a.displayOrder-b.displayOrder||a.id.localeCompare(b.id));
  }
  return groups;
}
