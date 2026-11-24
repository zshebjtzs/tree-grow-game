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
- Evaluation and tactics: `positionEvaluator.scoreMove`, `positionEvaluator.evaluateState`, `tacticalAnalyzer.findImmediateWinningMove`, `tacticalAnalyzer.rankDefenses`, `tacticalAnalyzer.findForcedWinInTwoMoves`, `tacticalAnalyzer.findForcedMaterialGainInTwoMoves`.
- Presentation boundary: `toPublicMove`, `createDecisionExplanation`, `createNoMoveExplanation`.
- Topology/evaluation support: `distanceToBase`.

The adapter owns domain-specific state transitions. It must use the authoritative game rules and combat resolver rather than maintaining a second rules implementation.

## Tactical sequence analysis

Before general search, the controller runs a bounded AND/OR proof for a two-turn forcing win on the tactically admissible root candidates:

1. Apply one candidate action.
2. Enumerate every legal opponent reply (or the authoritative pass transition when no reply exists).
3. After each reply, check whether the AI still has an immediate winning action, including direct base entry or a simulated attack that destroys the opponent's final root.

A candidate is accepted only when every opponent reply preserves an immediate win. This distinguishes a genuine forcing combination from simply counting multiple apparent threats. A node cap and the shared decision deadline bound the analysis; budget exhaustion is reported and never treated as proof. The analysis may discover cooperation between different roots because the continuation is generated from the complete side-to-move position rather than being restricted to the original parent node.

The result is exposed through `lastSearchStats.tacticalSequenceNodes`, `tacticalSequenceComplete`, and `forcedWinInTwoMoves`. It is a bounded tactical capability, not a general multi-move mate solver.

## Forced material-gain analysis

If no forced win is proven, the controller performs a second bounded AND/OR pass using the remaining tactical node budget:

1. Apply a candidate action and enumerate every legal opponent reply (or the authoritative pass transition).
2. For each reply, inspect the AI's legal attacking continuations.
3. Simulate each attack with the authoritative combat rules and measure enemy root loss and cascade loss.
4. Require every opponent reply to leave at least one continuation that destroys an enemy root or at least two non-root descendants. A single isolated leaf loss is deliberately insufficient.
5. Rank qualifying candidates by their worst-case guaranteed root loss, then cascade loss, then total node loss.

An opponent reply that wins immediately, a missing continuation, an invalid transition, or an exhausted node/deadline budget prevents the candidate from being reported as a proven gain. The forced-win and material-gain checks share a maximum tactical node allowance of 1,200 per decision; each is bounded and the second receives only the remainder.

Telemetry is exposed as `forcedMaterialGainInTwoMoves`, `guaranteedTacticalRootLoss`, `guaranteedTacticalCascadeLoss`, and `guaranteedTacticalNodeLoss`. This remains a deliberately narrow two-turn tactical proof, not a general-purpose combination solver.

## Extended counterattack, inducement, and sacrifice analysis

If the two-action forced-win and material-gain proofs do not find a result, the controller runs a final bounded AND/OR proof for:

`candidate -> defender reply -> attacker setup -> defender reply -> final attack`

- Attacker nodes are existential: the AI may choose a setup and a final attack.
- Defender nodes are universal: every legal response must preserve the proof; an unavailable move uses the authoritative pass transition.
- The final attack is simulated through the adapter's authoritative rules and combat resolver.
- Opponent attack replies are explicitly counted. Any losses to the AI during those replies are charged against the final material gain.
- A sacrifice is accepted only if the same worst-case branch proves a positive tactical result; a material exchange must retain at least a two-node net gain unless it removes an enemy root. The AI's own last root may never be sacrificed.
- Inducement is reported only when the candidate creates an immediate winning threat, an opponent reply removes that immediate threat, and the deeper combination remains proven after that defense.
- Counterattack and inducement telemetry are descriptive; they do not replace the all-replies proof.

The proof shares the same per-decision 1,200-node tactical ceiling and absolute deadline with the shorter tactical analyzers. It returns no result if any branch is unexamined, any opponent reply can win immediately, or a transition is invalid. Its three attacker actions are a bounded tactical horizon, not an unrestricted multi-move solver.

Telemetry includes `forcedTacticalSequenceInThreeMoves`, `counterattackSequence`, `inducementValidated`, `sacrificeValidated`, `tacticalOpponentAttackReplies`, `inducedDefensiveReplies`, and the guaranteed net gain/self-loss fields.

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

All existing difficulty levels use the same rules, tactical filters, evaluation weights and search algorithm. Strength is controlled by maximum depth, time budget and node budget. Difficulty-specific random move selection and evaluation-weight changes are intentionally excluded from this model.

The current six levels are:

| Level | Maximum depth | Time budget | Node budget |
|---|---:|---:|---:|
| beginner | 1 | 25 ms | 500 |
| easy | 2 | 50 ms | 1,500 |
| medium | 4 | 150 ms | 6,000 |
| advanced | 5 | 300 ms | 12,000 |
| hard | 7 | 700 ms | 30,000 |
| expert | 8 | 1,200 ms | 60,000 |

These are initial tuning values, not proven strength ratings. All six levels share the same evaluation weights and search implementation. Fixed-position tactical regressions, target-device measurements, and observed human-player experience must guide later calibration. AI-vs-AI tournaments are not part of the validation plan unless the project owner explicitly authorizes them.

## Position-key invariant

A transposition key must encode every persistent state field that can change legal actions, terminal outcomes, or evaluation. For TreeGrow this includes turn, node ID counter, terminal state, node identity/ownership/area, parent-child structure, root status, `hasUsedRootGrowth`, destroyed state and frozen state. Rendering coordinates are excluded because they do not affect game rules or evaluation.

When a mode adds a rule-relevant persistent field, its adapter's position-key implementation and regression tests must be updated together.

## Adding a future mode

A future mode should add a new adapter and its own domain evaluator/tactical analyzer, then register its factory in `AIAdapterRegistry`. The worker accepts an optional `mode` field and defaults to `tree-grow` for backward compatibility. The shared controller and search engine should not gain mode-name conditionals or duplicate rule branches. Only `tree-grow` is registered currently; Quick/Campaign gameplay and their adapters are not implemented.
