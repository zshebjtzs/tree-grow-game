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


test('compact position keys preserve search-relevant state without serializing snapshots', async () => {
    const { getPositionKey } = await import('./PositionKey.js');
    const state = {
        currentTurn: 'red',
        nodeIdCounter: 2,
        isGameOver: false,
        nodes: [{
            id: 1, owner: 'red', parentId: null, areaId: 1,
            isRoot: true, isDestroyed: false, isFrozen: false, childrenIds: [2],
            x: 10, y: 20
        }, {
            id: 2, owner: 'red', parentId: 1, areaId: 2,
            isRoot: false, isDestroyed: false, isFrozen: true, childrenIds: [],
            x: 30, y: 40
        }],
        toJSON() { throw new Error('position key must not allocate a JSON snapshot'); }
    };
    const key = getPositionKey(state);
    assert.equal(typeof key, 'string');
    assert.equal(getPositionKey(state), key);
    const changedFreeze = {
        ...state,
        nodes: state.nodes.map((node, index) =>
            index === 1 ? { ...node, isFrozen: false } : node
        )
    };
    assert.notEqual(getPositionKey(changedFreeze), key);
    assert.notEqual(getPositionKey({ ...state, currentTurn: 'blue' }), key);
    assert.notEqual(getPositionKey({ ...state, nodeIdCounter: 3 }), key);
});


test('transposition-table best reply is promoted before heuristic move order', () => {
    const engine = new SearchEngine({ now: () => 0 });
    const observedOrders = [];
    const root = { id: 'root', currentTurn: 'red', isGameOver: false };
    const child = { id: 'child', currentTurn: 'blue', isGameOver: false };
    const applyMove = (state, move) => {
        if (state.id === 'root') return child;
        return {
            id: move === 'best' ? 'best-leaf' : 'weak-leaf',
            currentTurn: 'red',
            isGameOver: false,
            score: move === 'best' ? 1 : 9
        };
    };
    const result = engine.search({
        rootState: root,
        rootMoves: ['root-move'],
        maxDepth: 3,
        timeBudgetMs: 100,
        getPositionKey: state => state.id,
        getMoveKey: move => move,
        applyMove,
        generateMoves: state => state.id === 'child' ? ['weak', 'best'] : [],
        evaluate: state => state.score ?? 0,
        orderMoves: (state, moves) => {
            if (state.id === 'child') observedOrders.push([...moves]);
            return moves;
        }
    });

    assert.equal(result.completedDepth, 3);
    assert.deepEqual(observedOrders[0], ['weak', 'best']);
    assert.deepEqual(observedOrders[1], ['weak', 'best']);
});


test('principal variation search matches full-window alpha-beta', () => {
    const run = principalVariationSearch => new SearchEngine({ now: () => 0 }).search({
        rootState: { id: 'root', currentTurn: 'red', isGameOver: false, ply: 0, path: [] },
        rootMoves: [0, 1, 2],
        maxDepth: 4,
        timeBudgetMs: 1000,
        getPositionKey: state => `${state.ply}:${state.currentTurn}:${state.path.join(',')}`,
        getMoveKey: move => move,
        applyMove: (state, move) => ({
            id: `p${state.ply + 1}`,
            currentTurn: state.currentTurn === 'red' ? 'blue' : 'red',
            isGameOver: false,
            ply: state.ply + 1,
            path: [...state.path, move]
        }),
        generateMoves: state => state.ply < 4 ? [0, 1, 2] : [],
        evaluate: state => {
            const [a = 0, b = 0, c = 0, d = 0] = state.path;
            return (a * 17) - (b * 13) + (c * 7) - (d * 5) +
                (a === d ? 11 : 0) + (b === c ? 3 : 0);
        },
        orderMoves: (state, moves) => moves,
        principalVariationSearch
    });

    const pvs = run(true);
    const fullWindow = run(false);
    assert.equal(pvs.completedDepth, 4);
    assert.equal(pvs.move, fullWindow.move);
    assert.equal(pvs.value, fullWindow.value);
});


test('search progress reports only fully completed iterative-deepening depths', () => {
    const progress = [];
    const engine = new SearchEngine({ now: () => 0 });
    const result = engine.search({
        rootState: { currentTurn: 'red', isGameOver: false, ply: 0 },
        rootMoves: [0, 1],
        maxDepth: 3,
        timeBudgetMs: 100,
        getPositionKey: state => `${state.ply}:${state.currentTurn}`,
        applyMove: state => ({
            currentTurn: state.currentTurn === 'red' ? 'blue' : 'red',
            isGameOver: false,
            ply: state.ply + 1
        }),
        generateMoves: state => state.ply < 3 ? [0, 1] : [],
        evaluate: state => state.ply * 10,
        orderMoves: (state, moves) => moves,
        onProgress: snapshot => progress.push(snapshot)
    });

    assert.equal(result.completedDepth, 3);
    assert.deepEqual(progress.map(item => item.completedDepth), [1, 2, 3]);
    assert.ok(progress.every(item => item.phase === 'search'));
    assert.ok(progress.every(item => item.nodes > 0 && item.elapsedMs >= 0));
});
