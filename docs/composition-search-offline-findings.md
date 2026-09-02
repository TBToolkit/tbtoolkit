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

## Next offline step

Add a bounded deterministic composition search for larger pools, then compare its finalists against exhaustive results on small pools. Expand the experiment matrix to lower tiers, different encounter formations, Arachne, and included mercenaries before integrating any control into the live calculator.
