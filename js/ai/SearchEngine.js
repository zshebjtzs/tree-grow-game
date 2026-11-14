// js/ai/SearchEngine.js
/**
 * Iterative-deepening alpha-beta search with a depth-aware transposition table.
 * Search is synchronous and intended to run inside AIWorker, never the UI thread.
 */
export class SearchEngine {
    constructor({ now = () => performance.now() } = {}) {
        this.now = now;
    }

    search({
        rootState,
        rootMoves,
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
        onProgress = () => {}
    }) {
        if (!Array.isArray(rootMoves) || !rootMoves.length) {
            return { move: null, value: evaluate(rootState), completedDepth: 0, nodes: 0, cutoffs: 0 };
        }
        const startedAt = this.now();
        const deadline = startedAt + Math.max(1, timeBudgetMs);
        const stats = { nodes: 0, cutoffs: 0, transpositionHits: 0 };
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
            if (state.isGameOver || depth === 0) return evaluate(state);

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

            const side = state.currentTurn;
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

        for (let depth = 1; depth <= maxDepth; depth++) {
            let iterationMove = bestMove;
            let iterationValue = -Infinity;
            let alpha = -Infinity;
            const beta = Infinity;
            try {
                let ordered = orderMoves(rootState, rootMoves, true, checkBudget);
                ordered = promoteMove(ordered, preferredRootMoveKey);
                for (const move of ordered) {
                    const next = applyMove(rootState, move, rootState.currentTurn);
                    if (!next) continue;
                    const value = next.isGameOver
                        ? evaluate(next)
                        : visit(next, depth - 1, alpha, beta, false);
                    if (value > iterationValue) {
                        iterationValue = value;
                        iterationMove = move;
                    }
                    alpha = Math.max(alpha, iterationValue);
                }
                if (!Number.isFinite(iterationValue)) break;
                bestMove = iterationMove;
                bestValue = iterationValue;
                preferredRootMoveKey = getMoveKey(iterationMove);
                completedDepth = depth;
                try {
                    onProgress({
                        phase: 'search',
                        completedDepth,
                        maxDepth,
                        nodes: stats.nodes,
                        cutoffs: stats.cutoffs,
                        transpositionHits: stats.transpositionHits,
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
            elapsedMs: Math.max(0, this.now() - startedAt)
        };
    }
}

SearchEngine.BUDGET_EXHAUSTED = Symbol('search-budget-exhausted');
