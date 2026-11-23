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


test('search never exceeds the configured node budget', () => {
    const engine = new SearchEngine({ now: () => 0 });
    const result = engine.search({
        rootState: { currentTurn: 'red', isGameOver: false, ply: 0 },
        rootMoves: ['first', 'second'],
        maxDepth: 4,
        timeBudgetMs: 100,
        maxNodes: 1,
        getPositionKey: state => `${state.ply}:${state.currentTurn}`,
        applyMove: state => ({
            currentTurn: state.currentTurn === 'red' ? 'blue' : 'red',
            isGameOver: false,
            ply: state.ply + 1
        }),
        generateMoves: state => state.ply < 4 ? ['reply-a', 'reply-b'] : [],
        evaluate: state => state.ply,
        orderMoves: (state, moves) => moves
    });

    assert.equal(result.nodes, 1);
    assert.ok(result.nodes <= 1);
    assert.equal(result.completedDepth, 0,
        'an incomplete first iteration must not be reported as completed');
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


test('search engine uses adapter callbacks instead of assuming a TreeGrow state shape', () => {
    const engine = new SearchEngine({ now: () => 0 });
    const result = engine.search({
        rootState: { turn: 'north', terminal: false, value: 0 },
        rootMoves: ['safe', 'winning'],
        isTerminal: state => state.terminal,
        getSideToMove: state => state.turn,
        getPositionKey: state => `${state.turn}:${state.terminal}:${state.value}`,
        applyMove: (state, move, side) => ({
            turn: side === 'north' ? 'south' : 'north',
            terminal: move === 'winning',
            value: move === 'winning' ? 10 : 0
        }),
        generateMoves: () => [],
        passTurn: state => ({
            turn: state.turn === 'north' ? 'south' : 'north',
            terminal: true,
            value: -1
        }),
        evaluate: state => state.value,
        orderMoves: (state, moves) => moves,
        maxDepth: 2,
        timeBudgetMs: 100,
        maxNodes: 100
    });

    assert.equal(result.move, 'winning');
    assert.equal(result.value, 10);
    assert.equal(result.completedDepth, 2);
});


test('aspiration windows re-search fail-high iterations and preserve full-window results', () => {
    const run = aspirationWindows => new SearchEngine({ now: () => 0 }).search({
        rootState: { turn: 'red', phase: 'root', score: 0 },
        rootMoves: ['a', 'b'],
        maxDepth: 2,
        timeBudgetMs: 100,
        getPositionKey: state => `${state.phase}:${state.turn}:${state.rootMove || ''}`,
        getMoveKey: move => move,
        applyMove: (state, move, side) => state.phase === 'root'
            ? { turn: 'blue', phase: 'reply', rootMove: move, score: 0 }
            : { turn: 'red', phase: 'leaf', rootMove: state.rootMove,
                score: state.rootMove === 'a' ? 500 : 400 },
        generateMoves: state => state.phase === 'reply' ? ['reply'] : [],
        evaluate: state => state.score,
        orderMoves: (state, moves) => moves,
        aspirationWindows,
        aspirationWindow: 100
    });

    const windowed = run(true);
    const fullWindow = run(false);
    assert.equal(windowed.completedDepth, 2);
    assert.equal(windowed.move, fullWindow.move);
    assert.equal(windowed.value, fullWindow.value);
    assert.equal(windowed.aspirationResearches, 1);
    assert.equal(windowed.aspirationFailHigh, 1);
    assert.equal(windowed.aspirationFailLow, 0);
    assert.equal(windowed.aspirationOneSidedResearches, 1);
});

test('aspiration fail-low re-search matches full-window alpha-beta', () => {
    const run = aspirationWindows => new SearchEngine({ now: () => 0 }).search({
        rootState: { turn: 'red', phase: 'root', score: 0 },
        rootMoves: ['a', 'b'],
        maxDepth: 2,
        timeBudgetMs: 100,
        getPositionKey: state => `${state.phase}:${state.turn}:${state.rootMove || ''}`,
        getMoveKey: move => move,
        applyMove: (state, move) => state.phase === 'root'
            ? { turn: 'blue', phase: 'reply', rootMove: move, score: 500 }
            : { turn: 'red', phase: 'leaf', rootMove: state.rootMove, score: 0 },
        generateMoves: state => state.phase === 'reply' ? ['reply'] : [],
        evaluate: state => state.score,
        orderMoves: (state, moves) => moves,
        aspirationWindows,
        aspirationWindow: 100
    });

    const result = run(true);
    const fullWindow = run(false);
    assert.equal(result.completedDepth, 2);
    assert.equal(result.value, 0);
    assert.equal(result.move, fullWindow.move);
    assert.equal(result.value, fullWindow.value);
    assert.equal(result.aspirationResearches, 1);
    assert.equal(result.aspirationFailLow, 1);
    assert.equal(result.aspirationOneSidedResearches, 1);
});


test('PVS and aspiration windows match full-window alpha-beta across deterministic random trees', () => {
    let totalAspirationResearches = 0;

    for (let seed = 1; seed <= 50; seed++) {
        let randomState = seed >>> 0;
        const random = () => {
            randomState = (randomState * 1664525 + 1013904223) >>> 0;
            return randomState / 0x100000000;
        };
        const nodes = new Map();
        let nextId = 0;
        const build = (depth, side) => {
            const id = `seed-${seed}-node-${nextId++}`;
            const node = {
                id,
                currentTurn: side,
                isGameOver: depth === 4,
                depth,
                score: Math.floor(random() * 2001) - 1000,
                children: []
            };
            nodes.set(id, node);
            if (depth < 4) {
                const childCount = 2 + Math.floor(random() * 3);
                for (let index = 0; index < childCount; index++) {
                    const child = build(depth + 1, side === 'red' ? 'blue' : 'red');
                    node.children.push(child.id);
                }
            }
            return node;
        };
        const root = build(0, 'red');
        const rootMoves = [...root.children];
        const run = (principalVariationSearch, aspirationWindows) =>
            new SearchEngine({ now: () => 0 }).search({
                rootState: root,
                rootMoves,
                isTerminal: state => state.isGameOver,
                getSideToMove: state => state.currentTurn,
                getPositionKey: state => state.id,
                getMoveKey: move => move,
                applyMove: (state, move) => nodes.get(move),
                generateMoves: state => state.children,
                evaluate: state => state.score,
                orderMoves: (state, moves) => moves,
                maxDepth: 4,
                timeBudgetMs: 1000,
                maxNodes: 100000,
                principalVariationSearch,
                aspirationWindows,
                aspirationWindow: 25
            });

        const baseline = run(false, false);
        const pvsOnly = run(true, false);
        const aspirationOnly = run(false, true);
        const combined = run(true, true);
        for (const candidate of [pvsOnly, aspirationOnly, combined]) {
            assert.equal(candidate.completedDepth, 4, `seed ${seed} must complete depth 4`);
            assert.equal(candidate.move, baseline.move, `seed ${seed} selected a different move`);
            assert.equal(candidate.value, baseline.value, `seed ${seed} changed the minimax value`);
        }
        totalAspirationResearches += combined.aspirationResearches;
    }

    assert.ok(totalAspirationResearches > 0,
        'the randomized sample should exercise fail-high or fail-low recovery');
});


test('budget exhaustion during aspiration re-search preserves the last completed depth', () => {
    const engine = new SearchEngine({ now: () => 0 });
    let orderCalls = 0;
    const result = engine.search({
        rootState: { turn: 'red', phase: 'root', score: 0 },
        rootMoves: ['a', 'b'],
        maxDepth: 2,
        maxNodes: 100,
        timeBudgetMs: 100,
        getPositionKey: state => `${state.phase}:${state.turn}:${state.rootMove || ''}`,
        getMoveKey: move => move,
        applyMove: (state, move) => state.phase === 'root'
            ? { turn: 'blue', phase: 'reply', rootMove: move, score: 0 }
            : { turn: 'red', phase: 'leaf', rootMove: state.rootMove,
                score: state.rootMove === 'a' ? 500 : 400 },
        generateMoves: state => state.phase === 'reply' ? ['reply'] : [],
        isTerminal: state => state.phase === 'leaf',
        evaluate: state => state.score,
        orderMoves: (state, moves) => {
            orderCalls++;
            if (orderCalls === 4) throw SearchEngine.BUDGET_EXHAUSTED;
            return moves;
        },
        aspirationWindows: true,
        aspirationWindow: 100
    });

    assert.equal(orderCalls, 4);
    assert.equal(result.completedDepth, 1);
    assert.equal(result.move, 'a');
    assert.equal(result.value, 0);
    assert.equal(result.aspirationResearches, 1);
});

test('PVS and aspiration match alpha-beta across random DAGs with transpositions', () => {
    for (let seed = 101; seed <= 120; seed++) {
        let randomState = seed >>> 0;
        const random = () => {
            randomState = (randomState * 1664525 + 1013904223) >>> 0;
            return randomState / 0x100000000;
        };
        const nodes = new Map();
        const layers = [];
        for (let depth = 0; depth <= 4; depth++) {
            const count = depth === 0 ? 1 : 5;
            const layer = [];
            for (let index = 0; index < count; index++) {
                const id = `dag-${seed}-d${depth}-n${index}`;
                const node = {
                    id,
                    depth,
                    currentTurn: depth % 2 === 0 ? 'red' : 'blue',
                    isGameOver: depth === 4,
                    score: Math.floor(random() * 2001) - 1000,
                    children: []
                };
                nodes.set(id, node);
                layer.push(node);
            }
            layers.push(layer);
        }
        for (let depth = 0; depth < 4; depth++) {
            for (const node of layers[depth]) {
                const candidates = [...layers[depth + 1]];
                for (let index = candidates.length - 1; index > 0; index--) {
                    const target = Math.floor(random() * (index + 1));
                    [candidates[index], candidates[target]] = [candidates[target], candidates[index]];
                }
                const childCount = 2 + Math.floor(random() * 3);
                node.children = candidates.slice(0, childCount).map(child => child.id);
            }
        }

        const root = layers[0][0];
        const run = (principalVariationSearch, aspirationWindows) =>
            new SearchEngine({ now: () => 0 }).search({
                rootState: root,
                rootMoves: [...root.children],
                isTerminal: state => state.isGameOver,
                getSideToMove: state => state.currentTurn,
                getPositionKey: state => state.id,
                getMoveKey: move => move,
                applyMove: (state, move) => nodes.get(move),
                generateMoves: state => state.children,
                evaluate: state => state.score,
                orderMoves: (state, moves) => moves,
                maxDepth: 4,
                timeBudgetMs: 1000,
                maxNodes: 100000,
                principalVariationSearch,
                aspirationWindows,
                aspirationWindow: 25
            });

        const baseline = run(false, false);
        const pvsOnly = run(true, false);
        const aspirationOnly = run(false, true);
        const combined = run(true, true);
        for (const [name, candidate] of [
            ['PVS', pvsOnly],
            ['aspiration', aspirationOnly],
            ['combined', combined]
        ]) {
            assert.equal(candidate.completedDepth, 4, `DAG seed ${seed} ${name} must complete depth 4`);
            assert.equal(candidate.value, baseline.value, `DAG seed ${seed} ${name} changed minimax value`);
            assert.equal(candidate.move, baseline.move, `DAG seed ${seed} ${name} changed root move`);
        }
        assert.ok(baseline.transpositionHits > 0, `DAG seed ${seed} should exercise transpositions`);
    }
});


test('search honors an absolute deadline shared with decision preparation', () => {
    const fallback = { id: 'prepared-root-move' };
    const engine = new SearchEngine({ now: () => 100 });
    const result = engine.search({
        rootState: { currentTurn: 'red' },
        rootMoves: [fallback],
        maxDepth: 4,
        timeBudgetMs: 1000,
        deadline: 99,
        maxNodes: 100,
        getPositionKey: () => 'root',
        applyMove: () => null,
        generateMoves: () => [],
        evaluate: () => 0,
        orderMoves: (_state, moves) => moves
    });

    assert.equal(result.move, fallback);
    assert.equal(result.completedDepth, 0);
    assert.equal(result.nodes, 0,
        'the search phase must not restart a fresh budget after preparation used the shared deadline');
});
