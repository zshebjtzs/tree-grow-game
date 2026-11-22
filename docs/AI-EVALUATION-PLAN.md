# AI Evaluation Upgrade Plan (A3)

## Baseline diagnosis

The current evaluator uses hard route distance, node/root counts, a small static structure score, and a short list of move-level bonuses. It does not directly quantify whether a root is protected by a branching ancestor, how much vulnerable single-chain structure can be lost, whether a side has multiple legal growth fronts, or how much progress remains when all hard routes are blocked.

The prior strategy-assistant analysis proposed structural-risk, root-safety, soft-distance, growth-headroom, base-threat, siege, and lane metrics. Those are feature hypotheses, not proven weights. Its GA/WASM implementation and fixed-width beam are not being ported: its training/deployment policy differed, and its reported tests did not establish a stable advantage over the built-in hard AI.

## A3.1: Static structural metrics

The first implementation will add these metrics, all derived from the live JS state and authoritative adapter operations:

| Metric | Definition | Intended signal |
|---|---|---|
| `unsafeRoots` | Count roots whose first child is absent or is not a fortress (`getDegree() <= 3`) | A root can still be lost by attacking its first child |
| `rootChainRisk` | Number of nodes in vulnerable single-child chains below unsafe roots, stopping at a branch or leaf | Approximate cascade-loss magnitude |
| `softDistanceToBase` | Multi-source Dijkstra from owned nodes; empty area cost 1, enemy-occupied intermediate area cost 3, enemy base remains the terminal target | Preserve a useful distance gradient when hard paths are blocked |
| `growthHeadroom` | Number of distinct owned parent nodes with at least one legal growth move | Measure expansion capacity without rewarding raw node count alone |
| `baseThreatCount` | Count of currently legal moves that enter the enemy base | Measure immediate winning pressure |
| `siegeCount` | Count nodes adjacent to the enemy base, split into degree-3 pre-fortress and degree-greater-than-3 fortress nodes | Measure near-base conversion and established siege pressure |

Definitions must follow the actual JS rules:

- Combat's stopping point is the nearest **ancestor** that is non-root and has at least two children; the attacked node itself is not a stopping point.
- A fortress is currently protected from attack only when `getDegree() > 3`.
- A first child with two children has degree 3 and is still attackable. Its branching protects descendants when they are attacked, but it does not protect the root if the first child itself is attacked. Therefore root safety requires the first child itself to be a fortress (degree greater than 3), not merely a two-way fork. This corrects the earlier helper-document heuristic.
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

Current shared structural weights in `DifficultyProfiles.js`:

| Feature | Weight |
|---|---:|
| root safety | 2,500 |
| vulnerable root-chain risk | 80 |
| soft-distance fallback | 0.25 |
| growth headroom | 12 |
| immediate base threat | 700 |
| pre-fortress siege | 350 |
| fortress siege | 1,500 |

All six levels use these same values. They remain calibration seeds, not empirically established constants.

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


## A3.2: Paired tournament statistics

The tournament runner must treat two games played on the same map with the same random seed and swapped red/blue difficulty assignments as one paired sample.

- `--pair-games` must be an even integer of at least 2, ensuring every scheduled game has a color-swapped counterpart.
- Every game records its pair ID, map seed, and decision-randomness seed.
- The report still shows raw game wins, draws, and losses, but the score-rate estimate and confidence interval are calculated across paired samples.
- The confidence interval uses a two-sided Student's t critical value for small samples (tabulated through 30 degrees of freedom, normal approximation thereafter). With fewer than two paired samples, interval bounds are null rather than implying false precision.
- A pair is rejected if it is incomplete, uses different map/random seeds, or fails to swap the color assignments.

This fixes the statistical unit: the two color-swapped games are not treated as independent observations. It does not make a small tournament conclusive; multiple independent map seeds and sufficiently long games are still required.

Automated tests cover pair aggregation, sample counting, incomplete pairs, seed mismatch, color-swap validation, and even pair-game constraints.


## A4.1: Lazy soft-distance fallback

The structural-metric cache now defers `softDistanceToBase` until evaluation actually needs it. If the hard legal route is finite, the evaluator does not run the fallback Dijkstra search. If the hard route is blocked, only the affected side computes soft distance.

This preserves the evaluation formula and all difficulty budgets; it changes when the fallback metric is computed, not its value. A regression test verifies zero fallback calls when both hard routes are reachable and exactly one call when only one side's route is blocked.

CI result (same Ubuntu / Node 20 environment): 232 tests passed; six-tier benchmarks, full 30-game paired round robin, build, Pages verification, and Windows Desktop Build passed.

Sparse-fixture PVS average time before/after lazy fallback:

| Difficulty | Before | After | Change |
|---|---:|---:|---:|
| beginner | 1.044 ms | 0.951 ms | -8.9% |
| easy | 2.909 ms | 2.484 ms | -14.6% |
| medium | 13.155 ms | 13.172 ms | +0.1% |
| advanced | 27.841 ms | 24.449 ms | -12.2% |
| hard | 146.296 ms | 128.928 ms | -11.9% |
| expert | 304.150 ms | 298.439 ms | -1.9% |

Configured search depths remained unchanged. This confirms the lazy fallback avoids some unnecessary work, but the improvement is fixture-dependent and does not fully offset the structural-evaluation cost. Continue with A4.2 rather than reducing search budgets.


## A4.2: Root aspiration windows

Iterative deepening now uses the previous completed iteration's score as a prediction for the next depth:

- Depth 1 and any search without a previous score use a full window.
- Later iterations begin with `previousValue ± window`, where `window = 150 + 2 × |last completed score delta|`.
- A fail-high or fail-low triggers a full-window re-search; a failed narrow-window result is never committed as a completed iteration.
- The previous iteration's best root move is promoted before search, preserving principal-variation ordering.
- Every root candidate checks the same time/node budget guard; the search still retains the complete legal root candidate set.
- Telemetry reports aspiration research count and fail-high/fail-low counts.

Correctness requirements:
- Aspiration and full-window search must return the same move/value on deterministic trees.
- Both fail-high and fail-low must trigger a full-window recovery.
- Budget exhaustion during a re-search must preserve the last fully completed depth.
- PVS/Alpha-Beta parity and the six-tier benchmark remain mandatory.


## A4.3: Search telemetry and randomized differential tests

The AI benchmark now reports mean aspiration re-searches plus total fail-high/fail-low counts for each fixture/difficulty/search variant.

A deterministic pseudo-random test generator creates 50 independent four-ply game trees. Each tree is evaluated by four search configurations:
- full-window Alpha-Beta,
- full-window PVS,
- aspiration-window Alpha-Beta,
- aspiration-window PVS.

All configurations must complete the same depth and return the same minimax value and selected root move. The sample also asserts that aspiration fail recovery is exercised. This complements the existing hand-authored PVS and fail-high/fail-low fixtures.


Aspiration-window calibration: a fixed 150-point window caused roughly 6–7 full re-searches per hard/expert sparse-fixture decision. A fixed 500-point window did not materially reduce re-searches and slightly worsened decision time. The current implementation therefore adapts the next window using the previous completed iteration's score swing: `150 + 2 × |last score delta|`. The next benchmark must validate whether this reduces re-searches without reducing completed depth or worsening time.