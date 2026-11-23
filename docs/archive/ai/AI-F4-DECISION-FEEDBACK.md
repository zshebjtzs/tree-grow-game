# AI F4 — Decision Feedback

## Scope

F4 adds truthful, user-visible feedback around the existing AI decision pipeline. It does not change legal move generation, combat rules, evaluation weights, difficulty profiles, search budgets, or the selected move.

## Worker progress protocol

AIWorker sends request-scoped messages:

- `progress / starting`: the worker has accepted the request.
- `progress / generating`: legal candidate generation has begun.
- `progress / evaluating`: the completed and total candidate counts from the actual root scoring loop.
- `progress / tactics`: tactical threat and defensive response analysis is running.
- `progress / search`: a complete iterative-deepening layer has finished. The payload includes completed depth, configured maximum depth, visited nodes, cutoffs, transposition hits, current root value, and elapsed search time.
- `progress / complete`: decision calculation has completed.
- `decision`: the chosen move, factual explanation, and final search statistics.

Messages carry the request ID. The main thread ignores stale request messages. Progress callbacks are observational: callback failures are isolated from decision correctness. Search progress is emitted only after a fully completed iteration; an interrupted partial iteration is never presented as completed work.

Easy and medium report actual candidate-evaluation counts. Hard and expert additionally report completed search depths. No synthetic percentage or timer-driven progress is displayed.

## Decision explanation

AIController builds an explanation from the selected legal candidate and its already simulated resulting state. It reports only evidence available from the current evaluation:

- direct legal win by entering the enemy base;
- enemy nodes or roots removed by the simulated combat result;
- graph distance to the enemy base before and after the move;
- opponent distance to the AI's base before and after the move;
- resulting child count of the selected parent;
- completed search depth, node count, elapsed time, and transposition hits for search difficulties.

If none of these measurements explains a move, the UI uses a neutral statement that the move ranked highly under the active difficulty profile. It does not invent a tactical motive.

## Target-area feedback

The chosen target area receives a distinct amber overlay while the AI's growth animation is being presented. The overlay is cleared when that animation completes. The authoritative move is still checked by the main-thread RuleEngine before the node is created.

## Timing authenticity

The old 600 ms timeout during AI base placement was only a presentation delay around deterministic setup logic, not actual AI computation. It has been removed. Base selection now proceeds immediately; turn-time progress is reserved for real worker computation.

## Boundaries

- No progress percentage is fabricated.
- No timer is used to hold a completed AI move.
- No AI search runs on the main thread.
- Worker progress does not authorize a move; the final move must still pass main-thread RuleEngine validation.
- The explanation is presentation metadata and never participates in move selection.
