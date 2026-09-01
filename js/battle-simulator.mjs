/** Shared deterministic battle-event simulator. Damage profiles remain battle-specific. */
export const BATTLE_SIMULATOR_BUILD='190-dev1';

function chooseFriendlyAttacker(squads,alive,attackedThisCycle){
  let best=null;
  for(const squad of squads){
    if(!alive.has(squad.id)||attackedThisCycle.has(squad.id))continue;
    if(!best||squad.nominalSquadStrength>best.nominalSquadStrength||
      (squad.nominalSquadStrength===best.nominalSquadStrength&&squad.unitId<best.unitId))best=squad;
  }
  return best;
}

function chooseEnemyTarget(squads,alive){
  let best=null;
  for(const squad of squads){
    if(!alive.has(squad.id))continue;
    if(!best||squad.effectiveHealth>best.effectiveHealth||
      (squad.effectiveHealth===best.effectiveHealth&&squad.unitId<best.unitId))best=squad;
  }
  return best;
}

export function simulateInitiativeCase(squads,friendlyStarts,enemySquadCount=4){
  const enemyCount=Math.max(1,Math.floor(Number(enemySquadCount)||0));
  const alive=new Set(squads.filter(s=>s.quantity>0).map(s=>s.id));
  const attackOpportunities=Object.fromEntries(squads.map(s=>[s.id,0]));
  const lifetimeDamage=Object.fromEntries(squads.map(s=>[s.id,0]));
  const death={},events=[];
  let totalDamage=0,cycle=1,friendlyHasInitiative=Boolean(friendlyStarts),deathPosition=0;

  const friendlyAttack=attackedThisCycle=>{
    const attacker=chooseFriendlyAttacker(squads,alive,attackedThisCycle);
    if(!attacker)return false;
    attackedThisCycle.add(attacker.id);
    attackOpportunities[attacker.id]+=1;
    lifetimeDamage[attacker.id]+=attacker.expectedDamagePerOpportunity;
    totalDamage+=attacker.expectedDamagePerOpportunity;
    events.push({cycle,side:'FRIENDLY',unitId:attacker.unitId,id:attacker.id,name:attacker.name,expectedDamage:attacker.expectedDamagePerOpportunity});
    return true;
  };
  const enemyAttack=()=>{
    const target=chooseEnemyTarget(squads,alive);
    if(!target)return false;
    alive.delete(target.id);deathPosition+=1;
    death[target.id]={cycle,position:deathPosition};
    events.push({cycle,side:'ENEMY',killedUnitId:target.unitId,killedId:target.id,killedName:target.name,targetHealth:target.effectiveHealth});
    return true;
  };

  while(alive.size){
    const attackedThisCycle=new Set();let enemyAttacks=0,friendlyTurn=friendlyHasInitiative;
    while(enemyAttacks<enemyCount&&alive.size){
      if(friendlyTurn)friendlyAttack(attackedThisCycle);
      else{enemyAttack();enemyAttacks+=1;}
      friendlyTurn=!friendlyTurn;
    }
    while(alive.size&&friendlyAttack(attackedThisCycle)){}
    cycle+=1;friendlyHasInitiative=!friendlyHasInitiative;
    if(cycle>squads.length+5)throw new Error('Simulation exceeded expected cycle bound.');
  }
  return{friendlyStarts:Boolean(friendlyStarts),totalDamage,cycles:cycle-1,attackOpportunities,lifetimeDamage,death,events};
}

export function simulateTwoInitiativeAverage(squads,enemySquadCount){
  const friendlyFirst=simulateInitiativeCase(squads,true,enemySquadCount);
  const enemyFirst=simulateInitiativeCase(squads,false,enemySquadCount);
  return{friendlyFirst,enemyFirst,expectedTotalLifetimeDamage:(friendlyFirst.totalDamage+enemyFirst.totalDamage)/2};
}
