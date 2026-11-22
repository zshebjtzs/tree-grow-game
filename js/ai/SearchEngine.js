// js/ai/SearchEngine.js
/**
 * Iterative-deepening alpha-beta search with a depth-aware transposition table,
 * principal-variation ordering, and aspiration windows. Search is synchronous
 * and intended to run inside AIWorker, never the UI thread.
 */
export class SearchEngine {
    constructor({ now = () => performance.now() } = {}) {
        this.now = now;
    }

    search({
        rootState,
        rootMoves,
        isTerminal = state => Boolean(state.isGameOver),
        getSideToMove = state => state.currentTurn,
        getPositionKey,
        getMoveKey = move => move,
        applyMove,
        generateMoves,
        passTurn,
        evaluate,
        orderMoves,
        maxDepth,
        timeBudgetMs,
        maxNodes = Infinity,
        principalVariationSearch = true,
        aspirationWindows = true,
        aspirationWindow = 500,
        onProgress = () => {}
    }) {
        if (!Array.isArray(rootMoves) || !rootMoves.length) {
            return { move: null, value: evaluate(rootState), completedDepth: 0, nodes: 0, cutoffs: 0 };
        }
        const startedAt = this.now();
        const deadline = startedAt + Math.max(1, timeBudgetMs);
        const stats = {
            nodes: 0,
            cutoffs: 0,
            transpositionHits: 0,
            aspirationResearches: 0,
            aspirationFailLow: 0,
            aspirationFailHigh: 0
        };
        const checkBudget = () => {
            if (stats.nodes > maxNodes || this.now() >= deadline) {
                throw SearchEngine.BUDGET_EXHAUSTED;
            }
        };
        const table = new Map();
        const promoteMove = (moves, preferredKey) => {
            if (preferredKey === undefined || preferredKey === null) return moves;
            const index = moves.findIndex(move => getMoveKey(move) === preferredKey);
            if (index <= 0) return moves;
            return [moves[index], ...moves.slice(0, index), ...moves.slice(index + 1)];
        };
        let bestMove = rootMoves[0];
        let bestValue = -Infinity;
        let completedDepth = 0;
        let preferredRootMoveKey;

        const visit = (state, depth, alpha, beta, maximizing) => {
            stats.nodes++;
            if (stats.nodes > maxNodes || this.now() >= deadline) {
                throw SearchEngine.BUDGET_EXHAUSTED;
            }
            if (isTerminal(state) || depth === 0) return evaluate(state);

            const key = getPositionKey(state);
            const cached = table.get(key);
            const originalAlpha = alpha;
            const originalBeta = beta;
            if (cached && cached.depth >= depth) {
                stats.transpositionHits++;
                if (cached.bound === 'exact') return cached.value;
                if (cached.bound === 'lower') alpha = Math.max(alpha, cached.value);
                if (cached.bound === 'upper') beta = Math.min(beta, cached.value);
                if (alpha >= beta) return cached.value;
            }

            const side = getSideToMove(state);
            let moves = generateMoves(state, side);
            checkBudget();
            if (!moves.length) {
                const passed = passTurn?.(state, side);
                return passed ? visit(passed, depth - 1, alpha, beta, !maximizing) : evaluate(state);
            }
            moves = orderMoves(state, moves, maximizing, checkBudget);
            moves = promoteMove(moves, cached?.bestMoveKey);
            let value = maximizing ? -Infinity : Infinity;
            let bestMoveKey;

            for (let index = 0; index < moves.length; index++) {
                const move = moves[index];
                const next = applyMove(state, move, side);
                if (!next) continue;

                let childValue;
                // Narrow-window probes pay off mainly when a node has
                // enough siblings to justify the extra bound checks. Keep
                // low-branching nodes on ordinary alpha-beta to avoid overhead.
                if (!principalVariationSearch || moves.length < 4 || index === 0) {
                    childValue = visit(next, depth - 1, alpha, beta, !maximizing);
                } else if (maximizing) {
                    // A narrow window cheaply tests whether this move can beat
                    // the current principal variation. Re-search only when it
                    // improves alpha without already causing a beta cutoff.
                    const probeBeta = Math.min(beta, alpha + 1e-6);
                    childValue = visit(next, depth - 1, alpha, probeBeta, false);
                    if (childValue > alpha && childValue < beta) {
                        childValue = visit(next, depth - 1, alpha, beta, false);
                    }
                } else {
                    const probeAlpha = Math.max(alpha, beta - 1e-6);
                    childValue = visit(next, depth - 1, probeAlpha, beta, true);
                    if (childValue < beta && childValue > alpha) {
                        childValue = visit(next, depth - 1, alpha, beta, true);
                    }
                }

                if ((maximizing && childValue > value) || (!maximizing && childValue < value)) {
                    value = childValue;
                    bestMoveKey = getMoveKey(move);
                }
                if (maximizing) {
                    alpha = Math.max(alpha, value);
                } else {
                    beta = Math.min(beta, value);
                }
                if (alpha >= beta) {
                    stats.cutoffs++;
                    break;
                }
            }
            if (!Number.isFinite(value)) value = evaluate(state);
            const bound = value <= originalAlpha ? 'upper'
                : value >= originalBeta ? 'lower' : 'exact';
            const previous = table.get(key);
            if (!previous || previous.depth <= depth) {
                table.set(key, { depth, value, bound, bestMoveKey });
            }
            return value;
        };

        const searchRoot = (depth, initialAlpha, initialBeta) => {
            let iterationMove = bestMove;
            let iterationValue = -Infinity;
            let alpha = initialAlpha;
            const beta = initialBeta;
            let ordered = orderMoves(rootState, rootMoves, true, checkBudget);
            ordered = promoteMove(ordered, preferredRootMoveKey);

            for (const move of ordered) {
                checkBudget();
                const next = applyMove(rootState, move, getSideToMove(rootState));
                if (!next) continue;
                const value = isTerminal(next)
                    ? evaluate(next)
                    : visit(next, depth - 1, alpha, beta, false);
                if (value > iterationValue) {
                    iterationValue = value;
                    iterationMove = move;
                }
                alpha = Math.max(alpha, iterationValue);
                if (alpha >= beta) break;
            }
            return { move: iterationMove, value: iterationValue };
        };

        for (let depth = 1; depth <= maxDepth; depth++) {
            try {
                const window = Math.max(1, aspirationWindow);
                const alpha = aspirationWindows && depth > 1 && Number.isFinite(bestValue)
                    ? bestValue - window
                    : -Infinity;
                const beta = aspirationWindows && depth > 1 && Number.isFinite(bestValue)
                    ? bestValue + window
                    : Infinity;
                let iteration = searchRoot(depth, alpha, beta);

                if (aspirationWindows && depth > 1 &&
                    (iteration.value <= alpha || iteration.value >= beta)) {
                    stats.aspirationResearches++;
                    if (iteration.value <= alpha) stats.aspirationFailLow++;
                    if (iteration.value >= beta) stats.aspirationFailHigh++;
                    iteration = searchRoot(depth, -Infinity, Infinity);
                }

                if (!Number.isFinite(iteration.value)) break;
                bestMove = iteration.move;
                bestValue = iteration.value;
                preferredRootMoveKey = getMoveKey(iteration.move);
                completedDepth = depth;
                try {
                    onProgress({
                        phase: 'search',
                        completedDepth,
                        maxDepth,
                        nodes: stats.nodes,
                        cutoffs: stats.cutoffs,
                        transpositionHits: stats.transpositionHits,
                        aspirationResearches: stats.aspirationResearches,
                        value: bestValue,
                        elapsedMs: Math.max(0, this.now() - startedAt)
                    });
                } catch (error) {
                    // Telemetry must never alter search correctness.
                }
            } catch (error) {
                if (error !== SearchEngine.BUDGET_EXHAUSTED) throw error;
                break;
            }
            if (this.now() >= deadline || stats.nodes >= maxNodes) break;
        }

        return {
            move: bestMove,
            value: bestValue,
            completedDepth,
            nodes: stats.nodes,
            cutoffs: stats.cutoffs,
            transpositionHits: stats.transpositionHits,
            aspirationResearches: stats.aspirationResearches,
            aspirationFailLow: stats.aspirationFailLow,
            aspirationFailHigh: stats.aspirationFailHigh,
            elapsedMs: Math.max(0, this.now() - startedAt)
        };
    }
}

SearchEngine.BUDGET_EXHAUSTED = Symbol('search-budget-exhausted');
