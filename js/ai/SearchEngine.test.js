import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchEngine } from './SearchEngine.js';

test('alpha-beta search chooses the maximin move', () => {
    const engine = new SearchEngine({ now: () => 0 });
    const result = engine.search({
        rootState: { currentTurn: 'red', isGameOver: false, branch: null, score: 0 },
        rootMoves: ['a', 'b'],
        maxDepth: 2,
        timeBudgetMs: 100,
        getPositionKey: state => JSON.stringify(state),
        applyMove: (state, move, side) => side === 'red'
            ? { currentTurn: 'blue', isGameOver: false, branch: move, score: 0 }
            : { currentTurn: 'red', isGameOver: false, branch: null,
                score: move },
        generateMoves: state => state.currentTurn === 'blue'
            ? (state.branch === 'a' ? [3, 4] : [1, 9])
            : [],
        evaluate: state => state.score,
        orderMoves: (state, moves) => moves
    });
    assert.equal(result.move, 'a');
    assert.equal(result.value, 3);
    assert.equal(result.completedDepth, 2);
    assert.ok(result.cutoffs > 0, 'alpha-beta should prune at least one reply');
});

test('budget exhaustion keeps the last fully completed iteration', () => {
    let clock = 0;
    const engine = new SearchEngine({ now: () => clock++ });
    const result = engine.search({
        rootState: { currentTurn: 'red', isGameOver: false, branch: null, score: 0 },
        rootMoves: ['first', 'second'],
        maxDepth: 5,
        timeBudgetMs: 1000,
        maxNodes: 2,
        getPositionKey: state => JSON.stringify(state),
        applyMove: (state, move, side) => side === 'red'
            ? { currentTurn: 'blue', isGameOver: false, branch: move, score: move === 'first' ? 5 : 1 }
            : { currentTurn: 'red', isGameOver: false, branch: null, score: move },
        generateMoves: state => state.currentTurn === 'blue' ? [0, 1] : [],
        evaluate: state => state.score,
        orderMoves: (state, moves) => moves
    });
    assert.equal(result.completedDepth, 1);
    assert.equal(result.move, 'first');
    assert.equal(result.value, 5);
});


test('search models a skipped turn and continues after freeze cleanup', () => {
    const engine = new SearchEngine({ now: () => 0 });
    const result = engine.search({
        rootState: { currentTurn: 'red', isGameOver: false, phase: 'root', score: 0 },
        rootMoves: ['grow'],
        maxDepth: 3,
        timeBudgetMs: 100,
        getPositionKey: state => JSON.stringify(state),
        applyMove: state => state.phase === 'root'
            ? { currentTurn: 'blue', isGameOver: false, phase: 'after-red', score: 0 }
            : { currentTurn: 'blue', isGameOver: false, phase: 'after-blue', score: 42 },
        generateMoves: state => state.currentTurn === 'blue' ? [] : ['reply'],
        passTurn: state => ({
            currentTurn: 'red',
            isGameOver: false,
            phase: 'after-pass',
            score: state.score
        }),
        evaluate: state => state.score,
        orderMoves: (state, moves) => moves
    });
    assert.equal(result.value, 42);
});


test('alpha-beta result matches exhaustive minimax on a deterministic three-ply tree', () => {
    const movesFor = state => state.ply < 3 ? [0, 1, 2] : [];
    const apply = (state, move) => ({
        currentTurn: state.currentTurn === 'red' ? 'blue' : 'red',
        isGameOver: false,
        ply: state.ply + 1,
        path: [...state.path, move]
    });
    const evaluate = state => {
        const [a = 0, b = 0, c = 0] = state.path;
        return (a + 1) * 11 - b * 7 + c * 3 + (a === c ? 2 : 0);
    };
    const exhaustive = (state, depth, maximizing) => {
        if (depth === 0) return evaluate(state);
        const moves = movesFor(state);
        if (!moves.length) return evaluate(state);
        const values = moves.map(move => exhaustive(apply(state, move), depth - 1, !maximizing));
        return maximizing ? Math.max(...values) : Math.min(...values);
    };

    const root = { currentTurn: 'red', isGameOver: false, ply: 0, path: [] };
    const expected = [0, 1, 2].map(move => ({
        move,
        value: exhaustive(apply(root, move), 2, false)
    })).sort((a, b) => b.value - a.value)[0];

    const engine = new SearchEngine({ now: () => 0 });
    const actual = engine.search({
        rootState: root,
        rootMoves: [0, 1, 2],
        maxDepth: 3,
        timeBudgetMs: 100,
        getPositionKey: state => state.path.join(':') + ':' + state.currentTurn,
        applyMove: apply,
        generateMoves: movesFor,
        evaluate,
        orderMoves: (state, moves) => moves
    });

    assert.equal(actual.move, expected.move);
    assert.equal(actual.value, expected.value);
    assert.equal(actual.completedDepth, 3);
});
