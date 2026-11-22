# AI Evaluation Upgrade Plan (A3)

## Baseline diagnosis

The current evaluator uses hard route distance, node/root counts, a small static structure score, and a short list of move-level bonuses. It does not directly quantify whether a root is protected by a branching ancestor, how much vulnerable single-chain structure can be lost, whether a side has multiple legal growth fronts, or how much progress remains when all hard routes are blocked.

The prior strategy-assistant analysis proposed structural-risk, root-safety, soft-distance, growth-headroom, base-threat, siege, and lane metrics. Those are feature hypotheses, not proven weights. Its GA/WASM implementation and fixed-width beam are not being ported: its training/deployment policy differed, and its reported tests did not establish a stable advantage over the built-in hard AI.

## A3.1: Static structural metrics

The first implementation will add these metrics, all derived from the live JS state and authoritative adapter operations:

| Metric | Definition | Intended signal |
|---|---|---|
| `unsafeRoots` | Count roots whose first child is absent or has fewer than two children | A root can still be lost through a single-chain attack |
| `rootChainRisk` | Number of nodes in vulnerable single-child chains below unsafe roots, stopping at a branch or leaf | Approximate cascade-loss magnitude |
| `softDistanceToBase` | Multi-source Dijkstra from owned nodes; empty area cost 1, enemy-occupied intermediate area cost 3, enemy base remains the terminal target | Preserve a useful distance gradient when hard paths are blocked |
| `growthHeadroom` | Number of distinct owned parent nodes with at least one legal growth move | Measure expansion capacity without rewarding raw node count alone |
| `baseThreatCount` | Count of currently legal moves that enter the enemy base | Measure immediate winning pressure |
| `siegeCount` | Count nodes adjacent to the enemy base, split into degree-3 pre-fortress and degree-greater-than-3 fortress nodes | Measure near-base conversion and established siege pressure |

Definitions must follow the actual JS rules:

- Combat's stopping point is the nearest **ancestor** that is non-root and has at least two children; the attacked node itself is not a stopping point.
- A fortress is currently protected from attack only when `getDegree() > 3`.
- Root growth is a one-time action tracked by `hasUsedRootGrowth`.
- Entering the enemy base ends the game before combat resolution.

Do not duplicate these rules in the evaluator. Legal growth and base-threat counts must come from the TreeGrow adapter / RuleEngine.

## A3.2: Scoring integration

- Add the new terms symmetrically for both sides, with the side-to-move handled explicitly where an immediate threat depends on turn legality.
- Prefer soft distance only as a fallback/secondary gradient when hard distance is unreachable; do not double-count two measures of the same open route.
- Root safety and chain risk should have meaningful but bounded influence. They must not outweigh a verified immediate win or an immediate root-loss threat.
- Base-threat detection remains subordinate to the tactical layer's exact immediate-win and urgent-defense handling.
- Use the same weights for all six difficulty levels. Difficulty remains a search-budget distinction.
- Initial weights are calibration seeds, not final values. Tune against reproducible maps and color-swapped games rather than visual intuition.

## Deferred metrics

Two proposed metrics are intentionally deferred:

- `structuralRisk`: exact worst single-turn loss requires enumerating opponent legal attacks and simulating cascades. This may be expensive at every leaf.
- `laneScore`: independent-path / dual-lane analysis needs a precise path-disjointness definition and should not be approximated by an arbitrary count.

They can be reconsidered after A3.1/A3.2 profiling shows whether they add value.

## Correctness tests

- Root safety: no first child, single-child chain, first child with two children, multiple roots with mixed safety.
- Chain risk: chain extension, branching stop, and subtree removal semantics.
- Soft distance: open route, blocked hard route with enemy-occupied detour, unreachable topology, and symmetric side swap.
- Growth headroom: frozen nodes, used roots, fortress constraints, occupied targets, and no legal moves.
- Base threats: only legal entries count; a move rejected by RuleEngine must not contribute.
- Siege: degree 3 vs degree 4, root vs non-root, and adjacency to the enemy base.
- Evaluating a position must not mutate `currentTurn`, node state, or serialized state.

## Performance and strength validation

1. Preserve the six-tier / three-fixture CI benchmark as the fast regression check.
2. Record evaluator/search time, nodes, completed depth, and cache hit rates before and after.
3. Run the same seed set with red/blue swapped; report each difficulty's score rate and confidence interval.
4. Do not change search budgets to compensate for a slower evaluator until the algorithmic cost is understood.
5. Accept the feature set only if correctness tests pass and the strength signal is repeatable across multiple seeds; a single small tournament is not sufficient.
