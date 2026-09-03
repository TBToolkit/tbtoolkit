# Composition Search Offline Checkpoint

This checkpoint does not change the Battle Calculator interface or shared workspace selection. It establishes testable policy rules for a future **Allow optimizer to exclude selected units** option.

## Provisional policy

- Selected units form the complete candidate pool. Search never adds an unselected unit.
- Selected mercenaries are always mandatory. Mercenary optimization may adjust their quantities, but Review Selection never adds or removes mercenary types.
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
- Mercenary ownership regression: every selected mercenary remains in every composition, and unselected mercenaries are never introduced.
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

## Included-mercenary benchmark

The first included-mercenary benchmark uses the Doomsday inputs, the validated complete 30-unit G8–G9/S8–S9/E8–E9/M7–M9 troop and monster structure, and all 19 explicitly selected Tier II mercenaries. Authority is `156,570` at `40%` fill, so mercenary optimization receives an effective Authority limit of `62,628`.

The original experiment allowed the search to remove selected mercenaries. That behavior was rejected because it does not match common gameplay. The permanent rule is simpler: all 19 selected mercenaries are mandatory army members. Review Selection may recommend different troop and monster types, and the mercenary optimization checkbox may adjust mercenary quantities, but neither operation may add or remove a mercenary type.

The revised benchmark runs a bounded composition screen in which troops and monsters are optional while every selected mercenary is mandatory. It also performs a quantity-optimization pass and asserts that all 19 mercenary types still have positive quantities. Unselected mercenaries remain outside the inferred availability pool.

The repeatable invariant check is available through `npm run test:review-selection-mercenaries`.

## Next offline step

Integrate the proposal-only worker behind a Review Selection control, then add the Accept/Keep Current confirmation workflow without changing shared selections before acceptance.

## Browser-worker timing

The accuracy-preserving adaptive search now runs in a dedicated module worker. The worker loads canonical army data independently, reports search and refinement progress, and returns a proposal without touching saved calculator state. The calling page cancels by terminating the worker, which immediately discards the in-progress review.

Real-browser measurements on the current test machine:

- Doomsday: `41.5` seconds, producing the expected complete 30-unit G8–G9/S8–S9/E8–E9/M7–M9 recommendation.
- Arachne: `38.9` seconds, producing the same expected complete 30-unit structure.
- Cancellation: confirmed after approximately one second, with no selection change.
- `20`-second budget: correctly returns a time-limit message with no selection change.

The current accurate process does not meet the aspirational 20-second target. The prototype therefore uses a conservative `120`-second default budget and retains visible progress plus cancellation. Runtime optimization can be revisited later without weakening the validated search breadth.

The isolated browser harness is `tests/review-selection-worker-harness.html`, and a fast engine/protocol regression is available through `npm run test:review-selection-worker`.

## Development-interface integration

Review Selection is now connected to the Battle Calculator on the development branch with these boundaries:

- The control is visible only for Epic Monster battle types and remains hidden for every PvP battle type.
- The worker receives a snapshot of the current workspace and cannot change saved state.
- If mercenary optimization is disabled, deterministic Standard mercenary quantities are held fixed while troop and monster selections are reviewed.
- If mercenary optimization is enabled, mercenary quantities may be refined, but selected mercenary types remain mandatory.
- A completed review displays Current ELD, Recommended ELD, estimated improvement, additions, and removals.
- `Keep Current` closes the proposal without changing the workspace.
- `Accept Recommendation` replaces only troop and monster selections, preserves the exact mercenary selection, updates Custom Order defaults as needed, and recalculates the active method.
- Inputs or selections changed during a review invalidate the returned proposal.
- Cancellation and the `120`-second time budget leave the workspace unchanged.

Local browser verification confirmed Epic/PvP visibility, proposal rendering, Keep Current, Accept Recommendation, recalculation, and a clean browser console. This interface remains on `optimizer-composition-search` for development testing and has not been merged into `main`.

## Troop-only conventional death-order audit

The supplied 28-squad Arachne case was used to test a secondary, player-facing death-order preference. The preference applies only to Guardsmen, Specialists, and Engineers. Monster and mercenary death positions do not contribute to its score, and whole-army ELD remains the primary objective.

The first opening-sacrifice score was too coarse and still selected the mathematical champion. A second diagnostic compared the complete non-siege troop death ladder with a tier- and damage-per-opportunity value ladder. It weighted wider and more obvious inversions more heavily.

- Mathematical maximum: `3.931836846T` ELD, 41 troop inversions, weighted penalty `15.9341`.
- Most conventional retained alternative: `3.931245993T` ELD, 39 troop inversions, weighted penalty `15.1840`.
- ELD cost: `0.01503%`.
- The alternative moved S9 Duelist 2 from death position 2 to death position 7.
- The severe-inversion count remained 3, so this is a useful improvement but not yet proof that the scoring model is complete.

The `0.1%`, `0.25%`, `0.5%`, and `1%` eligibility windows all selected the same alternative because all six retained candidates were within `0.0232%` of the maximum. For this case, `0.1%` is therefore the recommended ceiling. Wider tolerances add risk without changing the result.

This remains an offline diagnostic. Before enabling it in the browser, test additional Epic encounters and expand the retained candidate pool so that the conventionality rule is not limited to alternatives generated for the first three flagged sacrifices.

### Supplied Doomsday case

The same troop-only audit was run on the supplied 30-squad Doomsday selection: G9/G8, S9/S8, E9/E8, all M9/M8/M7 monsters, and no mercenaries. The screenshot inputs were reproduced with Leadership `407,082`, Dominance `76,212`, Monster Health `1,637.5%`, Monster Strength `2,032%`, Strength PvE `3,877%`, Double Damage `12%`, and Strike Twice `18%`.

- Mathematical maximum: `873.921899B` ELD, 28 troop inversions, six severe inversions, weighted penalty `16.3360`.
- More conventional retained alternative: `872.990947B` ELD, 19 troop inversions, four severe inversions, weighted penalty `10.0517`.
- ELD cost: `0.10653%`.
- S9 Royal Lion 2 no longer occupies the first non-engineer troop sacrifice position; S8 Duelist 1 takes that early position.

The `0.1%` window excluded the alternative by `0.00653` percentage points. The `0.25%`, `0.5%`, and `1%` windows all selected it. Combined with the Arachne result, `0.25%` is now the provisional ceiling: it captures both improvements while the wider windows have not yet produced additional value. This is not sufficient evidence to enable the policy online; the candidate generator retained only two distinct Doomsday alternatives and six Arachne alternatives.

## First-cycle monster sacrifice discovery

An offline scenario miner evaluated 72 combinations across Doomsday/Arachne, four tier structures, three combat profiles, and three capacity profiles. Each scenario used six deterministic health-ladder seeds. A case was flagged only when a monster died during the first enemy cycle while at least one non-siege Guardsman or Specialist survived beyond it. Mercenaries were excluded.

- 40 of 72 scenarios contained the pattern.
- None of the simple health-spacing seed alternatives removed all early monster deaths within `0.25%` of the best seed.
- This shows the pattern is reproducible and that varying only the starting health separation is not an adequate remedy.

A clean Doomsday fixture was promoted to a full optimizer run: G9/G8, S9/S8, E9/E8, all M9/M8/M7 monsters, Leadership `700,000`, Dominance `160,000`, and the default `1,600%`/`2,000%` combat profile. Deep optimization strengthened the anomaly rather than removing it:

- Mathematical maximum: `1.097607785T` ELD.
- Fire Phoenix 2, Fire Phoenix 1, and Wind Lord died at positions 2, 3, and 4.
- 16 non-siege combat troops survived beyond the four-enemy opening cycle.

A targeted monster counterfactual produced `1.097384878T` ELD, a loss of only `0.02031%`. It moved Fire Phoenix 2 beyond the opening cycle without changing the troop conventionality score, but Fire Phoenix 1 and Wind Lord remained at positions 2 and 3. This validates a narrow early-monster preference while also demonstrating that a single counterfactual is insufficient. The next offline algorithm should retain a small beam of progressively protected monster basins, permitting slightly worse intermediate moves while enforcing the overall `0.25%` ceiling.

The early-monster work was subsequently deferred. Monster and mercenary positions will not participate in the near-optimal conventionality preference. Engineers are also excluded because their normal Epic role is sacrificial. The final intended scope is explicit G-tier Guardsmen and S-tier Specialists only.

### Lower-tier G/S validation

Two additional G8/G7 and S8/S7 cases were evaluated with E8/E7 engineers and M8/M7 monsters, Leadership `700,000`, Dominance `160,000`, and an intermediate combat profile.

- Lower-tier Doomsday produced no unusual early Guardsman or Specialist death, so the targeted search correctly proposed no change.
- Lower-tier Arachne found an alternative only `0.04334%` below the mathematical maximum.
- Its weighted G/S inversion penalty fell from `14.7252` to `11.9920`, an improvement of about `18.6%`.
- It replaced the early S8 Royal Lion with the lower-damage S8 Duelist while leaving the sacrificial engineers outside the scoring policy.

Across the supplied Arachne, supplied Doomsday, lower-tier Doomsday, and lower-tier Arachne cases, the `0.25%` ceiling captures each useful G/S alternative and makes no change when the targeted issue is absent. The browser policy should use explicit tier prefixes `G` and `S` rather than relying only on the present engineer `SIEGE` classification.

## Review Selection method matrix

Review Selection was evaluated with the established Doomsday and Arachne inputs across Standard, untouched Custom Order, and Optimize. Starting from the 39 checked G7–G9, S7–S9, E7–E9, and M7–M9 units, the availability rules correctly inferred a 93-unit pool extending through every lower troop and monster tier. The broad search evaluated 7,999 complete contiguous tier-band structures per encounter and expanded unit-level neighborhoods around the strongest tier leaders.

Standard and untouched Custom Order intentionally match because the application reuses the Standard result when Custom Order has not been changed. Their recommendations are method-specific:

- Doomsday Standard/Custom: approximately `849.181B` estimated ELD, using 29 units and excluding all selected Tier 7 troops plus Wind Lord.
- Arachne Standard/Custom: approximately `3.831T` estimated ELD, using 28 units and excluding all selected Tier 7 troops, E8, and Destructive Colossus.

The first Optimize-oriented pass used only deterministic screening and repeated the earlier Arachne mistake by excluding E8. Adding bounded intermediate quantity refinement for 30–31 promoted candidates corrected the ranking:

- Doomsday Optimize Review: complete 30-unit G8–G9, S8–S9, E8–E9, and M7–M9 structure; approximately `868.352B` intermediate ELD.
- Arachne Optimize Review: the same complete 30-unit tier structure; approximately `3.909T` intermediate ELD.

The Doomsday recommendation deliberately keeps the complete M7 tier because the deeply measured benefit from removing Black Dragon is only `0.0348%`, inside the practical-noise threshold. The Arachne recommendation retains E8 and therefore reaches the correct structural basin before the user starts full optimization.

The first matrix validated accuracy but was not suitable for interactive use: evaluating all 7,999 structures and refining 30–31 candidates took roughly thirteen minutes for both encounters. It was replaced with an adaptive best-first tier lattice that:

- starts from the current selection, top-only tiers, diagonal tier bands, and asymmetric family-width seeds;
- moves one family floor up or down at a time;
- retains a diverse 16-candidate beam;
- stops after at most 250 tier evaluations, without imposing a fixed lowest-tier window; and
- uses successive halving: 11–12 candidates receive a short three-resolution refinement, then six survivors—including complete-tier alternatives—receive a stronger refinement.

This reduced the tier search by `96.9%` and the stronger refinement set by about `80%`, completing the two-encounter matrix in under three minutes on the current test machine while preserving every Standard, untouched Custom Order, and Optimize recommendation exactly. An attempted reduction to eight short candidates and four stronger survivors changed the Doomsday recommendation and was rejected. The current 12/six breadth is therefore the smallest validated configuration, not an arbitrary tier cutoff.
