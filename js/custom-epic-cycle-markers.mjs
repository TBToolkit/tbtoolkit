/** Keep cycle boundaries inside each independently ordered unit category. */
export function cycleMarkersForOrder(order, friendlyDeaths = {}, epicDeaths = {}) {
  let previousCycle = null;
  return order.map(id => {
    const friendly = Number(friendlyDeaths[id]?.cycle);
    const epic = Number(epicDeaths[id]?.cycle);
    const cycle = Number.isInteger(friendly) && friendly > 0 ? friendly : null;
    const alternateCycle = Number.isInteger(epic) && epic > 0 ? epic : null;
    const startsCycle = cycle !== null && previousCycle !== null && cycle !== previousCycle;
    if (cycle !== null) previousCycle = cycle;
    return {id, cycle, alternateCycle, startsCycle};
  });
}
