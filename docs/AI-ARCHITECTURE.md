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
- Evaluation and tactics: `positionEvaluator.scoreMove`, `positionEvaluator.evaluateState`, `tacticalAnalyzer.findImmediateWinningMove`, `tacticalAnalyzer.rankDefenses`.
- Presentation boundary: `toPublicMove`, `createDecisionExplanation`, `createNoMoveExplanation`.
- Topology/evaluation support: `distanceToBase`.

The adapter owns domain-specific state transitions. It must use the authoritative game rules and combat resolver rather than maintaining a second rules implementation.

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

The current four levels are:

| Level | Maximum depth | Time budget | Node budget |
|---|---:|---:|---:|
| easy | 2 | 50 ms | 1,500 |
| medium | 4 | 150 ms | 6,000 |
| hard | 7 | 700 ms | 30,000 |
| expert | 8 | 1,200 ms | 60,000 |

These are initial tuning values, not proven strength ratings. Tournament results and target-device measurements must guide later calibration.

## Position-key invariant

A transposition key must encode every persistent state field that can change legal actions, terminal outcomes, or evaluation. For TreeGrow this includes turn, node ID counter, terminal state, node identity/ownership/area, parent-child structure, root status, `hasUsedRootGrowth`, destroyed state and frozen state. Rendering coordinates are excluded because they do not affect game rules or evaluation.

When a mode adds a rule-relevant persistent field, its adapter's position-key implementation and regression tests must be updated together.

## Adding a future mode

A future mode should add a new adapter and its own domain evaluator/tactical analyzer, then register its factory in `AIAdapterRegistry`. The worker accepts an optional `mode` field and defaults to `tree-grow` for backward compatibility. The shared controller and search engine should not gain mode-name conditionals or duplicate rule branches. Only `tree-grow` is registered currently; Quick/Campaign gameplay and their adapters are not implemented.
