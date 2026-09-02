# Composition Search Offline Checkpoint

This checkpoint does not change the Battle Calculator interface or shared workspace selection. It establishes testable policy rules for a future **Allow optimizer to exclude selected units** option.

## Provisional policy

- Selected units form the complete candidate pool. Search never adds an unselected unit.
- Selected mercenaries can be mandatory when mercenary optimization is off.
- The raw mathematical maximum remains available for diagnostics.
- Armies within `0.05%` of the mathematical maximum are practical ties.
- Within that tie range, prefer fewer micro squads, then fewer total squads, then fewer selection changes, then higher ELD.
- A micro squad uses less than `0.05%` of its capacity pool **and** contributes less than `0.05%` of total ELD. This preserves small squads that have a meaningful combat effect.
- Do not prompt to change the shared selection unless ELD improves by at least `0.05%` and the proposed selection is different.

## Offline coverage

- Synthetic regression: a four-squad mathematical maximum that improves ELD by `0.04%` but adds two negligible squads loses to the simpler two-squad army at the `0.05%` practical tie threshold.
- Proposal regression: a `0.0001%` improvement does not trigger an apply-selection prompt; a `0.10%` improvement does.
- Exhaustive subset regression: all non-empty subsets are evaluated for small candidate pools.
- Mercenary ownership regression: mandatory owned mercenaries remain in every composition, and unselected mercenaries are never introduced.
- Real-data exhaustive screen: 63 compositions from a six-unit Tier 9 pool were evaluated with the exact Epic combat scorer.
- Real-data sampled screen: 158 compositions from a 17-unit Tier 8–9 pool were evaluated.
- Bounded deterministic search explores progressively smaller subsets with a fixed beam width and hard evaluation budget.
- Full quantity optimization polished the three strongest small-pool screen finalists.

## Current finding

The `0.05%` practical tie and proposal thresholds correctly reject deliberately negligible improvements. The first real-data pools had clear winners rather than near-ties, so they do not yet distinguish `0.01%`, `0.025%`, `0.05%`, and `0.10%`. The thresholds should remain provisional until broader pools containing lower tiers and included mercenaries produce more near-optimal compositions.

## User-provided Doomsday case

The September 2 test uses the exact supplied inputs:

- Leadership `407,082` with Max Fill
- Dominance `76,212` with Max Fill
- No selected mercenaries; mercenary optimization off
- Monster Health `1637.5%`
- Monster Strength `2032%`
- Strength PvE `3877%`
- Monster Double Damage `12%`
- Monster Strike Twice `18%`
- Doomsday formation: Flying, Mounted, Melee, and Ranged
- Candidate tiers: G7–G9, S7–S9, E7–E9, and M7–M9 (`39` selected units)

The first bounded screen spent almost its entire `500`-evaluation budget on one- and two-unit removals. It could not reach the user's manually discovered 29-unit army, which removes all nine selected Tier 7 troops plus Black Dragon. The live calculator produced approximately `873.593B` ELD for that army.

The corrected offline search adds:

- structural starting selections that remove a whole troop or monster tier;
- a broad shallow beam for nearby alternatives; and
- a deep greedy path that reached 29 exclusion depths within its own `500`-evaluation budget.

The corrected search independently evaluated the exact manual 29-unit selection and retained it among the strongest finalists. Its screen also found nearby 29-unit variants, including a variant that keeps Black Dragon and excludes Wind Lord. Bounded local polishing produced:

- Current 39-unit selection: approximately `778.403B` ELD
- Exact manual selection: approximately `863.952B` ELD with local polishing
- Best locally polished nearby finalist: approximately `864.188B` ELD
- Local comparison improvement: approximately `11.021%`
- Added units: none
- Micro squads: none

The offline local-polish values are not expected to equal the live `873.593B` result because the live result uses the full deep quantity optimizer. The composition stage has now demonstrated that it can reach the correct 29-unit basin without being given the final selection. An online implementation should screen many compositions with the structural and deep-greedy paths, then run the existing full optimizer on only the strongest one or two finalists.

### Deep-finalist validation

The two strongest distinct 29-unit basins were then run through the complete deep optimizer with the supplied inputs:

- User selection, all Tier 7 troops and Black Dragon excluded: approximately `874.320B` ELD in `76.6` seconds
- Screen alternative, all Tier 7 troops and Wind Lord excluded: approximately `867.294B` ELD in `75.8` seconds
- Difference: approximately `7.026B` ELD in favor of the user's Black Dragon-excluded selection

The run reproduced and slightly exceeded the `873.593B` screenshot. The fast screen and bounded local polish had ranked the Wind Lord-excluded alternative slightly higher, but the full deep optimizer reversed that order. Therefore, deeply optimizing only the screen's first-place candidate is not reliable enough. The online composition workflow should retain diverse basins and deep-optimize at least two finalists before choosing the proposed army.

The deep comparison is intentionally available as a separate test command because it takes roughly two and a half minutes on the current test machine and should not run in the normal regression suite.

## Next offline step

Expand the experiment matrix to different encounter formations, Arachne, and included mercenaries. Validate whether one or two final deep-optimizer runs are sufficient before integrating any control into the live calculator.
