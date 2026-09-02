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

## Review Selection availability policy

The optional Review Selection workflow treats the current selection as evidence of unit availability, not necessarily as the army the user wants to preserve:

- At the highest selected Guardsman or Specialist tier, only the individually selected units are available. Every unit in lower tiers of that class is inferred as available.
- Selecting any Monster makes its complete tier and all lower Monster tiers available.
- Selecting an Engineer makes that Engineer and all lower Engineer tiers available.
- Mercenary ownership is never inferred; only explicitly selected Mercenaries are available.
- Review never considers a unit above the highest selected tier for its class.

Within the `0.05%` practical-noise range, ranking first avoids negligible micro squads, then prefers complete available tiers and fewer partially used tiers, and only then considers selection changes and squad count. A tier is complete relative to the inferred available pool: if only one top-tier Guardsman is known to be unlocked, using that one unit is complete for that tier.

This policy intentionally prefers the complete 30-unit Doomsday tier structure over the 29-unit partial-M7 structure when their estimated difference is only `0.0348%`. A partial tier still wins whenever its improvement exceeds the practical-noise threshold.

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

### Hierarchical validation

The five-stage hierarchy introduced for Arachne was then run unchanged with the Doomsday inputs. It evaluated all `4,095` tier structures, expanded `1,950` unit-level structures around eight tier leaders, intermediate-optimized 30 candidates, fully optimized four finalists, and deeply audited the strongest neighboring challenger.

The known 29-unit army was not supplied to the search. Its 30-unit tier parent ranked second in the exhaustive tier stage; the unit-neighborhood stage independently generated the Black Dragon removal, promoted it, and deep-optimized it. Results:

- All Tier 7 troops and Black Dragon excluded: approximately `874.320B` ELD
- Intact 30-unit tier parent: approximately `874.015B` ELD
- Difference: approximately `304.197M` ELD, or `0.0348%`
- Strongest other fully optimized one-move audit challenger, with Destructive Colossus excluded: approximately `872.816B` ELD

Although the 30-unit parent falls within the provisional `0.05%` practical-tie range, it has one more squad and lower ELD, so the 29-unit army remains the practical and mathematical choice. The repeatable hierarchy is available through `npm run test:composition-doomsday-hierarchical`.

## User-provided Arachne case

The Arachne benchmark uses the second supplied input set:

- Leadership `1,326,786` with Max Fill
- Dominance `270,245` with Max Fill
- No selected mercenaries; mercenary optimization off
- Monster Health `2438.5%`
- Monster Strength `5300.5%`
- Strength PvE `6181%`
- Monster Double Damage `32%`
- Monster Strike Twice `30%`
- Eight enemy squads, with two Flying, Mounted, Melee, and Ranged squads, plus the Arachne bonus
- Candidate tiers: G7–G9, S7–S9, E7–E9, and M7–M9 (`39` selected units)

The initial removal-only screen selected a 28-unit finalist at approximately `3.932T` ELD, but the user independently found a better 30-unit army at approximately `3.947T`. The missed army retains G8–G9, S8–S9, E8–E9, and M7–M9. This proved that selecting only a few finalists from one rough removal beam was not reliable enough.

The replacement hierarchical search performs five stages:

1. Exhaust all `4,095` non-empty combinations of the 12 selected tier groups.
2. Expand one-unit add, remove, and swap neighborhoods around eight distinct tier leaders (`2,254` unique structures in this case).
3. Intermediate-optimize 31 candidates containing both score leaders and intact tier leaders.
4. Fully optimize four finalists.
5. Intermediate-audit 16 neighbors of the winner and fully optimize the strongest structurally different challenger.

Without receiving the answer as a seed, the tier search ranked the user's 30-unit structure first, promoted it through the intermediate stage, and deep-optimized it. The final results were:

- User-discovered 30-unit structure: approximately `3.948116T` ELD
- Former 28-unit finalist: approximately `3.931837T` ELD
- Improvement: approximately `16.280B` ELD, or `0.414%`
- Strongest fully optimized one-move audit challenger: approximately `3.892681T` ELD

The benchmark now asserts that the 30-unit structure must be independently ranked first at the tier stage, promoted, and deeply optimized. The target signature is used only after the search as a regression assertion; it is never supplied to the search.

The repeatable long test is available through `npm run test:composition-arachne`. It remains separate from the normal regression suite because the broad intermediate stage and five deep runs take several minutes on the current test machine. A fast `tests/composition-search-arachne-tier-screen.mjs` diagnostic verifies all tier masks in about two seconds.

## Next offline step

Reduce the Review Selection tier and intermediate candidate budgets without changing the validated Doomsday or Arachne recommendations, then add an included-mercenary benchmark before integrating the control into the live calculator.

## Review Selection method matrix

Review Selection was evaluated with the established Doomsday and Arachne inputs across Standard, untouched Custom Order, and Optimize. Starting from the 39 checked G7–G9, S7–S9, E7–E9, and M7–M9 units, the availability rules correctly inferred a 93-unit pool extending through every lower troop and monster tier. The broad search evaluated 7,999 complete contiguous tier-band structures per encounter and expanded unit-level neighborhoods around the strongest tier leaders.

Standard and untouched Custom Order intentionally match because the application reuses the Standard result when Custom Order has not been changed. Their recommendations are method-specific:

- Doomsday Standard/Custom: approximately `849.181B` estimated ELD, using 29 units and excluding all selected Tier 7 troops plus Wind Lord.
- Arachne Standard/Custom: approximately `3.831T` estimated ELD, using 28 units and excluding all selected Tier 7 troops, E8, and Destructive Colossus.

The first Optimize-oriented pass used only deterministic screening and repeated the earlier Arachne mistake by excluding E8. Adding bounded intermediate quantity refinement for 30–31 promoted candidates corrected the ranking:

- Doomsday Optimize Review: complete 30-unit G8–G9, S8–S9, E8–E9, and M7–M9 structure; approximately `868.352B` intermediate ELD.
- Arachne Optimize Review: the same complete 30-unit tier structure; approximately `3.909T` intermediate ELD.

The Doomsday recommendation deliberately keeps the complete M7 tier because the deeply measured benefit from removing Black Dragon is only `0.0348%`, inside the practical-noise threshold. The Arachne recommendation retains E8 and therefore reaches the correct structural basin before the user starts full optimization.

The matrix validates accuracy but is not yet suitable for interactive use. Streaming the tier screen keeps memory bounded, but 7,999 Standard calculations and 30–31 intermediate optimizer passes per encounter take too long. The next performance step is to reduce the tier structures and intermediate promotions while requiring these exact recommendations to remain unchanged.
