/** Shared deterministic battle-event simulator. Damage profiles remain battle-specific. */
export {BATTLE_SIMULATOR_BUILD} from './build-info.mjs';

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

function simulateInitiativeCaseIndexed(squads,friendlyStarts,enemyCount,enemyStartsAfterOpening){
  const count=squads.length;
  const alive=new Uint8Array(count),attacked=new Uint8Array(count);
  const attackCounts=new Float64Array(count),damageTotals=new Float64Array(count);
  const deathCycles=new Int32Array(count),deathPositions=new Int32Array(count);
  let aliveCount=0,totalDamage=0,cycle=1,friendlyHasInitiative=Boolean(friendlyStarts),deathPosition=0;
  for(let i=0;i<count;i++)if(squads[i].quantity>0){alive[i]=1;aliveCount++;}

  const friendlyAttack=()=>{
    let best=-1;
    for(let i=0;i<count;i++){
      if(!alive[i]||attacked[i])continue;
      if(best<0||squads[i].nominalSquadStrength>squads[best].nominalSquadStrength||
        (squads[i].nominalSquadStrength===squads[best].nominalSquadStrength&&squads[i].unitId<squads[best].unitId))best=i;
    }
    if(best<0)return false;
    attacked[best]=1;attackCounts[best]+=1;damageTotals[best]+=squads[best].expectedDamagePerOpportunity;
    totalDamage+=squads[best].expectedDamagePerOpportunity;
    return true;
  };
  const enemyAttack=()=>{
    let best=-1;
    for(let i=0;i<count;i++){
      if(!alive[i])continue;
      if(best<0||squads[i].effectiveHealth>squads[best].effectiveHealth||
        (squads[i].effectiveHealth===squads[best].effectiveHealth&&squads[i].unitId<squads[best].unitId))best=i;
    }
    if(best<0)return false;
    alive[best]=0;aliveCount--;deathPosition++;deathCycles[best]=cycle;deathPositions[best]=deathPosition;
    return true;
  };

  while(aliveCount){
    attacked.fill(0);let enemyAttacks=0,friendlyTurn=friendlyHasInitiative;
    while(enemyAttacks<enemyCount&&aliveCount){
      if(friendlyTurn)friendlyAttack();else{enemyAttack();enemyAttacks++;}
      friendlyTurn=!friendlyTurn;
    }
    while(aliveCount&&friendlyAttack()){}
    cycle++;friendlyHasInitiative=enemyStartsAfterOpening?false:!friendlyHasInitiative;
    if(cycle>count+5)throw new Error('Simulation exceeded expected cycle bound.');
  }

  const attackOpportunities={},lifetimeDamage={},death={};
  for(let i=0;i<count;i++){
    const id=squads[i].id;
    attackOpportunities[id]=attackCounts[i];lifetimeDamage[id]=damageTotals[i];
    if(deathPositions[i])death[id]={cycle:deathCycles[i],position:deathPositions[i]};
  }
  return{friendlyStarts:Boolean(friendlyStarts),enemyStartsAfterOpening:Boolean(enemyStartsAfterOpening),totalDamage,cycles:cycle-1,attackOpportunities,lifetimeDamage,death,events:[]};
}

export function simulateInitiativeCase(squads,friendlyStarts,enemySquadCount=4,{enemyStartsAfterOpening=false,recordEvents=true}={}){
  const enemyCount=Math.max(1,Math.floor(Number(enemySquadCount)||0));
  if(!recordEvents)return simulateInitiativeCaseIndexed(squads,friendlyStarts,enemyCount,enemyStartsAfterOpening);
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
    if(recordEvents)events.push({cycle,side:'FRIENDLY',unitId:attacker.unitId,id:attacker.id,name:attacker.name,expectedDamage:attacker.expectedDamagePerOpportunity});
    return true;
  };
  const enemyAttack=()=>{
    const target=chooseEnemyTarget(squads,alive);
    if(!target)return false;
    alive.delete(target.id);deathPosition+=1;
    death[target.id]={cycle,position:deathPosition};
    if(recordEvents)events.push({cycle,side:'ENEMY',killedUnitId:target.unitId,killedId:target.id,killedName:target.name,targetHealth:target.effectiveHealth});
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
    cycle+=1;friendlyHasInitiative=enemyStartsAfterOpening?false:!friendlyHasInitiative;
    if(cycle>squads.length+5)throw new Error('Simulation exceeded expected cycle bound.');
  }
  return{friendlyStarts:Boolean(friendlyStarts),enemyStartsAfterOpening:Boolean(enemyStartsAfterOpening),totalDamage,cycles:cycle-1,attackOpportunities,lifetimeDamage,death,events};
}

export function simulateTwoInitiativeAverage(squads,enemySquadCount){
  const friendlyFirst=simulateInitiativeCase(squads,true,enemySquadCount);
  const enemyFirst=simulateInitiativeCase(squads,false,enemySquadCount);
  return{friendlyFirst,enemyFirst,expectedTotalLifetimeDamage:(friendlyFirst.totalDamage+enemyFirst.totalDamage)/2};
}

export function simulateOpeningCoinTossAverage(squads,enemySquadCount){
  const friendlyFirst=simulateInitiativeCase(squads,true,enemySquadCount,{enemyStartsAfterOpening:true});
  const enemyFirst=simulateInitiativeCase(squads,false,enemySquadCount,{enemyStartsAfterOpening:true});
  return{friendlyFirst,enemyFirst,expectedTotalLifetimeDamage:(friendlyFirst.totalDamage+enemyFirst.totalDamage)/2};
}
