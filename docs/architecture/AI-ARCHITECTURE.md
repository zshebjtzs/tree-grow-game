# AI Architecture

## Component responsibilities

| Component | Responsibility |
|---|---|
| `AIWorker` | Worker request validation, progress and result transport |
| `AIAdapterRegistry` | Resolve a game-mode ID to its adapter |
| `AIController` | Generate candidates, coordinate tactical checks and invoke search |
| `TacticalAnalyzer` | Prove immediate wins, mandatory defenses and bounded forcing wins |
| `StrategicDecisionCoordinator` | Decide which tactical results are hard constraints and which are search hints |
| `PositionEvaluator` | The single fixed-weight position evaluator and move-ordering heuristic |
| `SearchEngine` | Iterative deepening, Alpha-Beta/PVS, transposition table and bounded search |
| `TreeGrowAIAdapter` | Authoritative TreeGrow state, rules, combat, topology and explanations |
| `DifficultyProfiles` | Shared evaluation weights and per-level search budgets |

Game rules and state transitions remain in `TreeGrowAIAdapter`, `RuleEngine`, and `CombatResolver`. The AI must not reimplement growth, combat, freezing, or terminal-state rules.

## Decision pipeline

1. Generate every legal root candidate through the adapter.
2. Return a legal immediate winning move if one exists.
3. Run bounded mandatory-defense analysis. If the opponent has an immediate winning reply, only fully verified defenses may narrow the candidate set. If analysis is incomplete, preserve all legal candidates.
4. Run the bounded two-turn forcing-win proof. A move may bypass search only when every legal opponent reply has been examined and still leaves an immediate win.
5. Run forced-material and extended tactical analysis. These results are **ordering hints only**; they never remove other legal candidates or bypass global evaluation.
6. Search all remaining candidates with the same minimax/PVS implementation and position evaluator.

This separates hard tactical facts from non-terminal strategic preferences. A guaranteed node gain is not automatically more valuable than preventing a base loss, preserving a root chain, or choosing a stronger long-term position.

## Position evaluation

`PositionEvaluator` is the sole owner of strategic scoring. It retains the fixed-weight model from the base branch and evaluates both sides symmetrically:

- Base race: legal distance to the opposing base, with soft distance used only when the legal route is blocked.
- Material and roots: surviving node count and surviving root count. A surviving root has a fixed value of 7,000, deliberately greater than the maximum exposed-root penalty on the default 50-area map. Destroying a root therefore cannot look like an evaluation improvement merely because its exposed branch and descendants disappear from the current state.
- Structural value: branching flexibility, fortified branches, frozen nodes, and frontier leaves.
- Root safety: only roots with an existing, attackable first branch are counted as exposed; an unused root has no branch subtree to lose. The same root-safety delta is included in static move ordering so deadline-limited fallback ordering does not ignore it.
- Cascade exposure: the complete descendant subtree below each vulnerable first branch. Every reachable descendant is counted once; forks are not truncated to a single chain.
- Growth and siege: RuleEngine-derived growth headroom, immediate base threats, siege preparation and established siege fortresses.

The evaluator does not apply dynamic phase multipliers, spatial bonuses, comeback-risk bonuses, or a second offensive score. This prevents the same underlying fact from being added through several independent analyzers.

`scoreMove` is used for candidate ordering. `evaluateState` supplies the position value at search leaves. A move-ordering score is not a substitute for a completed minimax comparison.

Material and root counts are aggregated in one pass and cached per immutable state; candidate scoring reuses the pre-move counts across every legal action. The newly grown node is identified from the appended child entry rather than scanning the full node list.

Evaluation results and structural metrics are cached per immutable state and side. Search transitions produce detached states through the adapter, so a cached value is never reused after mutating the state it describes.

## Tactical analysis and search

The tactical analyzer uses the authoritative adapter to enumerate legal replies and simulate attacks. A proof is accepted only when all required branches have been examined; budget exhaustion is never treated as proof.

The coordinator applies the following distinction:

- Immediate wins and fully proven forced wins may return directly.
- Mandatory defense may constrain the candidate set only when the proof is complete.
- Forced material gains and extended counterattacks are move-ordering hints. All legal candidates remain in the root search.

`SearchEngine` is game-agnostic. It receives callbacks for terminal checks, side-to-move, position keys, legal moves, state transitions, evaluation and move ordering. It does not inspect TreeGrow node or ownership fields.

## Difficulty and budgets

All six levels share the same rules, tactical proofs, evaluation weights and search implementation. Difficulty changes only the computation budget.

| Level | Maximum depth | Target budget | Maximum work units |
|---|---:|---:|---:|
| beginner | 1 | 25 ms | 500 |
| easy | 2 | 50 ms | 1,500 |
| medium | 4 | 150 ms | 6,000 |
| advanced | 5 | 300 ms | 12,000 |
| hard | 9 | 1,800 ms | 120,000 |
| expert | 10 | 3,000 ms | 250,000 |

One absolute deadline is established before state preparation and passed to tactical analysis and search. Root candidate generation and initial scoring are synchronous; their time is included in the total decision measurement and reduces the time available to later stages. Of the remaining work-unit budget passed to the coordinator, tactical analysis may consume at most 60%; at least 40% remains available to global search. `deadlineExceeded` reports an actual overrun, not merely a target-latency warning. Work units are a deterministic budget estimate, not a count of CPU instructions.

These are initial tuning values, not proven strength ratings. They must be calibrated against fixed positions and target-device timings rather than assumed to represent expert-level play.

## Base-branch compatibility benchmark

`scripts/compare-ai-baseline.js` runs the PR base and candidate implementations on identical deterministic positions. It reports selected actions, legality under the base rules, the candidate's rank under the legacy one-ply score, completed depth, nodes and elapsed time.

The current fixture set covers sparse growth, branching attacks, combat, an immediate base-defense obligation and an exposed root chain. The report is diagnostic, not a strength verdict: different actions require tactical review, and synthetic positions do not replace real saved-game positions.

## Validation policy

- Run the full unit-test suite, compatibility benchmark, build and Pages verification.
- Keep the Windows desktop build and Worker smoke test green.
- Add real-game positions when a reproducible save or replay is available.
- Do not run AI-vs-AI self-play or tournaments without explicit project-owner authorization.
- Do not merge this PR or push changes to `main` without explicit authorization.

## Position-key invariant

A transposition key must encode every persistent state field that can change legal actions, terminal outcomes or evaluation. For TreeGrow this includes turn, node ID counter, terminal state, node identity/ownership/area, parent-child structure, root status, `hasUsedRootGrowth`, destroyed state and frozen state. Rendering coordinates are excluded because they do not affect rules or evaluation.

When a mode adds a rule-relevant persistent field, its adapter's position-key implementation and regression tests must be updated together.

## Adding a future mode

A future mode should add a new adapter and its own domain rules, evaluator and tactical analyzer, then register its factory in `AIAdapterRegistry`. The shared controller and search engine should not gain mode-name conditionals or duplicate rule branches. Only `tree-grow` is registered currently.
