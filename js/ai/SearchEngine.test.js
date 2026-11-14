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
        applyMove: (state, move, side) => side === 'red'
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
