# AI Architecture

## Responsibilities

The AI is split into a shared decision pipeline and a game-mode adapter.

| Layer | Responsibility | Game-mode dependency |
|---|---|---|
| `AIWorker` | Worker request validation, progress and result transport | Mode and difficulty IDs |
| `AIAdapterRegistry` | Resolve a mode ID to its adapter factory | Registry entries |
| `AIController` | Candidate evaluation flow, tactical priority, search orchestration and telemetry | Adapter contract |
| `SearchEngine` | Iterative deepening, Alpha-Beta/PVS, transposition table and search budgets | None; state access is callback-driven |
| `DifficultyProfiles` | Shared evaluation weights and per-level computation budgets | None |
| `TreeGrowAIAdapter` | TreeGrow state, rules, combat, legal actions, evaluation, tactical analysis and explanation | TreeGrow rules |

## Adapter contract

A mode adapter supplied to `AIController` must provide:

- State and side: `createState`, `isValidSide`, `setSideToMove`, `getSideToMove`, `isTerminal`.
- Match metadata: `getBases`.
- Search identity: `getPositionKey`, `getMoveKey`.
- Rules and transitions: `generateMoves`, `simulateMove`, `simulatePass`.
- Evaluation and tactics: `positionEvaluator.scoreMove`, `positionEvaluator.evaluateState`, `tacticalAnalyzer.findImmediateWinningMove`, `tacticalAnalyzer.rankDefenses`, `tacticalAnalyzer.findMandatoryDefenses`, `tacticalAnalyzer.findForcedWinInTwoMoves`, `tacticalAnalyzer.findForcedMaterialGainInTwoMoves`, `tacticalAnalyzer.findForcedTacticalSequenceInThreeMoves`.
- Presentation boundary: `toPublicMove`, `createDecisionExplanation`, `createNoMoveExplanation`.
- Topology/evaluation support: `distanceToBase`.

The adapter owns domain-specific state transitions. It must use the authoritative game rules and combat resolver rather than maintaining a second rules implementation.

## Tactical sequence analysis

Before general search, the controller runs a bounded AND/OR proof for a two-turn forcing win on the tactically admissible root candidates:

1. Apply one candidate action.
2. Enumerate every legal opponent reply (or the authoritative pass transition when no reply exists).
3. After each reply, check whether the AI still has an immediate winning action, including direct base entry or a simulated attack that destroys the opponent's final root.

A candidate is accepted only when every opponent reply preserves an immediate win. Generated legal replies are charged to the proof work budget, and an incomplete branch cannot be promoted to a proof. This distinguishes a genuine forcing combination from simply counting multiple apparent threats. A dedicated node cap bounds the analysis; budget exhaustion is reported and never treated as proof. The analysis may discover cooperation between different roots because the continuation is generated from the complete side-to-move position rather than being restricted to the original parent node.

The result is exposed through `lastSearchStats.tacticalSequenceNodes`, `tacticalSequenceComplete`, and `forcedWinInTwoMoves`. It is a bounded tactical capability, not a general multi-move mate solver.

## Forced material-gain analysis

If no forced win is proven, the controller performs a second bounded AND/OR pass using the remaining tactical node budget:

1. Apply a candidate action and enumerate every legal opponent reply (or the authoritative pass transition).
2. For each reply, inspect the AI's legal attacking continuations.
3. Simulate each attack with the authoritative combat rules and measure enemy root loss and cascade loss.
4. Require every opponent reply to leave at least one continuation that destroys an enemy root or at least two non-root descendants. A single isolated leaf loss is deliberately insufficient.
5. Rank qualifying candidates by their worst-case guaranteed root loss, then cascade loss, then total node loss.

An opponent reply that wins immediately, a missing continuation, an invalid transition, or an exhausted node budget prevents the candidate from being reported as a proven gain. The tactical pipeline shares a maximum allowance of 12,000 work units per decision. Mandatory-defense analysis has its own 4,000-unit sub-cap and is charged against the shared allowance; if it cannot finish, it preserves the full legal candidate set rather than narrowing from partial evidence. Each later proof stage receives only the remaining allowance.

Telemetry is exposed as `forcedMaterialGainInTwoMoves`, `guaranteedTacticalRootLoss`, `guaranteedTacticalCascadeLoss`, and `guaranteedTacticalNodeLoss`. This remains a deliberately narrow two-turn tactical proof, not a general-purpose combination solver.

## Extended counterattack, inducement, and sacrifice analysis

If the two-action forced-win and material-gain proofs do not find a result, the controller runs a final bounded AND/OR proof for:

`candidate -> defender reply -> attacker setup -> defender reply -> final attack`

- Attacker nodes are existential: the AI may choose a setup and a final attack.
- Defender nodes are universal: every legal response must preserve the proof; an unavailable move uses the authoritative pass transition.
- The final attack is simulated through the adapter's authoritative rules and combat resolver.
- Opponent attack replies are explicitly counted. Any losses to the AI during those replies are charged against the final material gain.
- A sacrifice is accepted only if the same worst-case branch proves a positive tactical result. Even when an enemy root is removed, the branch must still retain the configured positive net-node gain; root damage no longer bypasses material cost. The AI's own last root may never be sacrificed.
- Inducement is reported only when the candidate creates an immediate winning threat, an opponent reply removes that immediate threat, and the deeper combination remains proven after that defense.
- A deeper line is not promoted as a forcing tactic merely because it is a quiet multi-step plan: it must contain an actual opponent attack reply, a neutralized immediate threat, or a net-positive sacrifice exposed to opponent attacks.
- Counterattack and inducement telemetry are descriptive; they do not replace the all-replies proof.

The proof shares the same per-decision 12,000-work-unit tactical ceiling with the shorter tactical analyzers. It returns no result if any branch is unexamined, any opponent reply can win immediately, or a transition is invalid. Its three attacker actions are a bounded tactical horizon, not an unrestricted multi-move solver.

Telemetry includes `forcedTacticalSequenceInThreeMoves`, `counterattackSequence`, `inducementValidated`, `sacrificeValidated`, `tacticalOpponentAttackReplies`, `inducedDefenseBranches`, and the guaranteed net gain/self-loss fields.

## SearchEngine boundary

`SearchEngine` receives the following state-dependent callbacks:

- `isTerminal(state)`
- `getSideToMove(state)`
- `getPositionKey(state)`
- `generateMoves(state, side)`
- `applyMove(state, move, side)`
- `passTurn(state, side)`
- `evaluate(state)`
- `orderMoves(state, moves, maximizing, checkBudget)`

The defaults preserve compatibility with the current TreeGrow state shape, while adapters can supply their own state semantics. Search logic must not inspect game-specific node, board, or ownership fields.

## Difficulty model

All existing difficulty levels use the same rules, tactical filters, evaluation weights and search algorithm. Strength is controlled by maximum depth and a unified search-work budget. The per-decision profile budget is shared across root preparation, tactical analysis, and general search. Root preparation uses a deterministic estimate based on candidate count, simulations/scoring, sorting complexity, and strategic-analysis passes; it is a coarse proxy rather than an exact count of CPU operations. Tactical and search stages charge generated candidates and analysis steps to weighted `workUnits`; evaluator internals and runtime-specific operation costs are not measured instruction-by-instruction. `nodes` reports search recursion visits (and tactical analyzer checks for tactical telemetry), while `workUnits` reports the weighted budget charge. This budget bounds modeled work, not wall-clock latency. Configured millisecond values are telemetry targets only; they do not terminate search. Telemetry exposes `targetLatencyExceeded` when total decision time exceeds the configured target; the legacy `deadlineExceeded` field mirrors that target-overrun signal for existing benchmark consumers and does not mean search was aborted. The AI runs in a Web Worker, so deeper analysis does not block rendering. Difficulty-specific random move selection and evaluation-weight changes are intentionally excluded from this model.

The current six levels are:

| Level | Maximum depth | Target latency (telemetry only) | Approximate work-unit budget |
|---|---:|---:|---:|
| beginner | 1 | 25 ms | 500 |
| easy | 2 | 50 ms | 1,500 |
| medium | 4 | 150 ms | 6,000 |
| advanced | 5 | 300 ms | 12,000 |
| hard | 9 | 1,800 ms (target only) | 120,000 |
| expert | 10 | 3,000 ms (target only) | 250,000 |

These are initial tuning values, not proven strength ratings. All six levels share the same evaluation weights and search implementation. Fixed-position tactical regressions, target-device measurements, and observed human-player experience must guide later calibration. AI-vs-AI tournaments are not part of the validation plan unless the project owner explicitly authorizes them.

## Position-key invariant

A transposition key must encode every persistent state field that can change legal actions, terminal outcomes, or evaluation. For TreeGrow this includes turn, node ID counter, terminal state, node identity/ownership/area, parent-child structure, root status, `hasUsedRootGrowth`, destroyed state and frozen state. Rendering coordinates are excluded because they do not affect game rules or evaluation.

When a mode adds a rule-relevant persistent field, its adapter's position-key implementation and regression tests must be updated together.

## Adding a future mode

A future mode should add a new adapter and its own domain evaluator/tactical analyzer, then register its factory in `AIAdapterRegistry`. The worker accepts an optional `mode` field and defaults to `tree-grow` for backward compatibility. The shared controller and search engine should not gain mode-name conditionals or duplicate rule branches. Only `tree-grow` is registered currently; Quick/Campaign gameplay and their adapters are not implemented.

## Strategic evaluation (Phase C)

Strategic evaluation is a deterministic, position-derived layer above the existing legal-rule and tactical pipeline:

- `PositionAnalyzer` extracts expansion frontiers, contested space, root safety, incoming pressure, siege pressure, and independent root-frontier coverage. It consumes the adapter topology and existing RuleEngine-derived structural metrics; it does not generate actions or duplicate rules.
- `StrategicPhaseDetector` emits overlapping normalized signals for expansion, defense, siege, multi-root coordination, tactical pressure, and frontier control. These are simultaneous intensities, not mutually exclusive game phases.
- `StrategicAnalyzer` converts those signals into bounded dynamic multipliers over the shared difficulty profile and a spatial evaluation term. The shared profile is never mutated.
- `PositionEvaluator` applies the resulting weights consistently to move ordering and state evaluation. Terminal wins/losses and the existing tactical proofs remain higher priority and are not softened by strategic weights.
- Analysis is deterministic and cached per immutable game state and side. No historical state, player identity, or adaptive difficulty is used.

The strategic layer does not claim a move is forced. Tactical proofs remain authoritative for forced wins and material gains; strategic evaluation only ranks non-terminal alternatives.

Strategic transition signals also distinguish attack-oriented and defense-oriented states. They are derived continuously from tactical pressure and defensive pressure, allowing the evaluator to shift emphasis without switching between exclusive modes. Root safety is exposed as its own signal and independently adjusts root-preservation weights.


## Offensive opportunity analysis (Issue #37, Phase A)

`OffensiveStrategyAnalyzer` evaluates legal attack candidates from their already simulated authoritative successor states. It reports enemy node/root losses, cascade losses, own node losses, and immediate wins. It is observational: it does not duplicate combat rules, claim non-forced lines are proven, or add speculative fixed attack bonuses.

`AIController` uses this analysis for per-decision telemetry. High-value attack candidates are identified separately from ordinary attacks so later phases can add exchange valuation and position-dependent risk without conflating those responsibilities.

Mandatory-defense analysis now runs for every root position. If the opponent has an immediate winning reply, candidates are filtered to those minimizing the remaining immediate wins. If no immediate win exists, every legal candidate is retained and ordered by the opponent's strongest single simulated attack reply. Root loss, cascade loss, and total node loss are compared as one coherent reply tuple; losses from mutually exclusive replies are never combined into a synthetic worst case. Counts of replies causing root or structural loss are secondary frequency signals, not additive material values. This quiet-position ordering is a search-order hint, not a hard filter; minimax may still select a tactically justified counterattack that accepts structural risk. If the bounded analysis is incomplete, the original full candidate order is preserved.

Root structural exposure also counts the full descendant subtree below a vulnerable first branch. A fork does not protect its descendants: authoritative combat deletion removes every descendant of the attacked node.

Candidate move scoring checks legal enemy attacks against every attackable ancestor on the newly grown node's parent chain, not only direct recapture of the new leaf. This reflects the combat rule that attacking an ancestor can remove the new branch as collateral. Recapture penalties partition direct-target, cascade, and root losses so each removed node is charged once, with an additional strategic premium for root loss.

The extended tactical proof generates its hypothetical initial attacker threats with the attacker as side-to-move, restores the real defender turn before enumerating replies, and simulates attacks to detect wins caused by destroying the opponent's final root. A direct base-entry check alone is insufficient for this game rule.

Telemetry includes `offensiveCandidateCount`, `offensiveAttackCandidateCount`, `offensiveHighValueAttackCount`, `offensiveRootAttackCount`, `offensiveCascadeAttackCount`, `offensiveImmediateWinCount`, `offensiveMaxEnemyNodeLoss`, and `offensiveMaxEnemyRootLoss`.


## Offensive exchange evaluation (Issue #37, Phase B)

`analyzeExchangeOutcome` compares node identities in the parent and simulated successor states. It separately counts enemy losses, own losses, enemy-root losses, own-root losses, and cascade losses, then derives net node/root gains. A newly grown attacker therefore cannot hide an own-node loss, and gross enemy casualties are not mistaken for a favorable exchange.

`PositionEvaluator.scoreMove` uses net node and root gains for attack ordering. It does not double-count cascade losses, and it does not reward an even one-for-one exchange as a net material gain. The authoritative adapter simulation remains the sole source of combat outcomes.

## Advantage conversion (Issue #37, Phase C)

`PositionEvaluator` derives a bounded conversion factor from the current side-to-move perspective's cached position evaluation. Only positive conversion evidence—net-positive exchanges, enemy-root damage, and progress toward the enemy base—receives the additional shared conversion multiplier. A negative exchange does not become attractive merely because the AI is ahead.

The conversion threshold, scale, and multiplier are shared by all six difficulty profiles; difficulty continues to differ through computation budgets. Conversion telemetry is exposed alongside gross and net exchange metrics so real-game decisions can be inspected. This is a bounded move-ordering preference, not a tactical proof or a replacement for minimax evaluation.


## Disadvantage risk strategy (Phase D)

`DisadvantageRiskAnalyzer` derives a bounded risk factor from the current side's cached position evaluation. It is inactive in even or favorable positions and increases smoothly only when the evaluated position is materially unfavorable.

The risk preference is outcome-dependent, not a generic bonus for aggressive moves:
- Forward progress, enemy-root damage, cascade damage, and positive net exchange can justify measured volatility.
- Own node losses are charged against the candidate.
- Own-root loss carries a dominant penalty and cannot be made attractive by ordinary material or progress bonuses.
- The evaluator also adds a bounded comeback-potential term to the actual minimax state value, derived from tactical pressure, siege pressure, and frontier control. This lets a completed search prefer a position with credible breakthrough potential instead of affecting only move ordering.
- The existing terminal checks and proven tactical results remain higher priority than strategic risk preference.
- When behind, the ordinary proximity-to-base safety penalty is softened only within a fixed bound; it is not removed.

The shared profile defines the disadvantage threshold, scale, leverage weights, self-loss costs, and bonus/penalty caps. All six difficulties use identical strategic parameters and continue to differ only by computation budgets. The decision telemetry exposes `disadvantageRiskFactor` so actual comeback behavior can be inspected.

This is a controlled change in move ordering and positional risk tolerance, not a rule to sacrifice material or a guarantee that a speculative attack succeeds.

## Strategic decision coordination (Phase E)

`StrategicDecisionCoordinator` owns the shared priority order and invokes expensive analyzers lazily. A higher-priority result prevents lower-priority stages from replacing it or consuming unnecessary tactical budget.

The order is:

1. Immediate verified win.
2. Mandatory defense against an opponent's immediate winning threat.
3. Bounded proof of a forced win.
4. Bounded proof of a forced material gain.
5. Bounded counterattack, inducement, or sacrifice sequence.
6. General search over the remaining tactically admissible candidates.

Mandatory defense narrows the candidate set only when an immediate opponent win is actually present. Without that condition, all legal root candidates remain available to tactical analysis and general search. If no defense fully removes an immediate threat, the tactical analyzer's best available defensive set is retained.

The tactical pipeline shares a maximum modeled allowance of 12,000 work units per decision. Mandatory-defense analysis receives up to 4,000 units and is included in the shared total; the forced-win and material-gain stages each receive up to 4,000 units from the remainder, and the extended proof receives what remains. Generated candidate counts and analyzer checks are charged as weighted units; this is a deterministic workload proxy, not an instruction-level or wall-clock limit. An incomplete mandatory-defense scan keeps all legal candidates. `tacticalSequenceNodes` and `mandatoryDefenseNodes` count analyzer checks; `tacticalSequenceWorkUnits`, `mandatoryDefenseWorkUnits`, and `totalTacticalWorkUnits` report the weighted budget charges. No wall-clock deadline aborts these checks, and budget exhaustion is never treated as a proof. The coordinator returns the selected action, its reason, and a consolidated tactical summary for telemetry.

This layer coordinates priorities; it does not duplicate game rules, alter tactical proof semantics, or let strategic risk preference override an immediate win, mandatory defense, or verified forcing line.
