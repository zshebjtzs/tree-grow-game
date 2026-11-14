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
        applyMove,
        generateMoves,
        passTurn,
        evaluate,
        orderMoves,
        maxDepth,
        timeBudgetMs,
        maxNodes = Infinity
    }) {
        if (!Array.isArray(rootMoves) || !rootMoves.length) {
            return { move: null, value: evaluate(rootState), completedDepth: 0, nodes: 0, cutoffs: 0 };
        }
        const startedAt = this.now();
        const deadline = startedAt + Math.max(1, timeBudgetMs);
        const stats = { nodes: 0, cutoffs: 0, transpositionHits: 0 };
        const table = new Map();
        let bestMove = rootMoves[0];
        let bestValue = -Infinity;
        let completedDepth = 0;

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
            if (!moves.length) {
                const passed = passTurn?.(state, side);
                return passed ? visit(passed, depth - 1, alpha, beta, !maximizing) : evaluate(state);
            }
            moves = orderMoves(state, moves, maximizing);
            let value = maximizing ? -Infinity : Infinity;

            for (const move of moves) {
                const next = applyMove(state, move, side);
                if (!next) continue;
                const childValue = visit(next, depth - 1, alpha, beta, !maximizing);
                if (maximizing) {
                    value = Math.max(value, childValue);
                    alpha = Math.max(alpha, value);
                } else {
                    value = Math.min(value, childValue);
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
            if (!previous || previous.depth <= depth) table.set(key, { depth, value, bound });
            return value;
        };

        for (let depth = 1; depth <= maxDepth; depth++) {
            let iterationMove = bestMove;
            let iterationValue = -Infinity;
            let alpha = -Infinity;
            const beta = Infinity;
            try {
                const ordered = orderMoves(rootState, rootMoves, true);
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
                completedDepth = depth;
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
