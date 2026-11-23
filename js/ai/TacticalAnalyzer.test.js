import test from 'node:test';
import assert from 'node:assert/strict';
import { TacticalAnalyzer } from './TacticalAnalyzer.js';

function position({ blueRoots = 1, redRoots = 1, vulnerable = false, isGameOver = false } = {}) {
    return {
        currentTurn: 'blue',
        isGameOver,
        getPlayerRootNodes(side) {
            if (side === 'blue') return Array.from({ length: blueRoots }, (_, id) => ({ id }));
            return Array.from({ length: redRoots }, (_, id) => ({ id }));
        },
        getAliveNodesByOwner(side) {
            return this.getPlayerRootNodes(side);
        },
        vulnerable
    };
}

test('defense ranking rejects a move that exposes a root to immediate destruction', () => {
    const analyzer = new TacticalAnalyzer();
    const game = position({ blueRoots: 2 });
    const safe = { parentNodeId: 1, targetAreaId: 4 };
    const risky = { parentNodeId: 2, targetAreaId: 5 };

    const generateMoves = (state, side) => {
        if (side === 'red' && state.vulnerable) {
            return [{ parentNodeId: 9, targetAreaId: 5, attacks: true }];
        }
        return [];
    };
    const simulateMove = (state, move, side) => {
        if (side === 'blue') {
            return position({ blueRoots: 2, vulnerable: move.targetAreaId === risky.targetAreaId });
        }
        if (side === 'red' && state.vulnerable && move.attacks) {
            return position({ blueRoots: 1 });
        }
        return state;
    };

    const selected = analyzer.rankDefenses(
        game, [safe, risky], 'blue', { red: 6, blue: 1 }, simulateMove, generateMoves
    );
    assert.deepEqual(selected, [safe]);
});

test('root-risk screening preserves all candidates when no immediate root loss exists', () => {
    const analyzer = new TacticalAnalyzer();
    const game = position();
    const moves = [
        { parentNodeId: 1, targetAreaId: 4 },
        { parentNodeId: 2, targetAreaId: 5 }
    ];
    const generateMoves = () => [];
    const simulateMove = state => state;

    assert.deepEqual(
        analyzer.rankDefenses(
            game, moves, 'blue', { red: 6, blue: 1 }, simulateMove, generateMoves
        ),
        moves
    );
});


test('defense ranking avoids multi-node cascade when root risk is equal', () => {
    const analyzer = new TacticalAnalyzer();
    const game = {
        ...position(),
        getAliveNodesByOwner(side) {
            return Array.from({ length: side === 'blue' ? 4 : 1 }, (_, id) => ({ id }));
        }
    };
    const safe = { parentNodeId: 1, targetAreaId: 4 };
    const exposed = { parentNodeId: 2, targetAreaId: 5 };
    const generateMoves = (state, side) => side === 'red' && state.cascade
        ? [{ parentNodeId: 9, targetAreaId: 5, attacks: true }]
        : [];
    const simulateMove = (state, move, side) => {
        if (side === 'blue') {
            const cascade = move.targetAreaId === exposed.targetAreaId;
            return {
                ...position({ vulnerable: cascade }),
                cascade,
                getAliveNodesByOwner(owner) {
                    return Array.from({ length: owner === 'blue' ? 4 : 1 }, (_, id) => ({ id }));
                }
            };
        }
        if (side === 'red' && state.cascade && move.attacks) {
            return {
                ...position(),
                getAliveNodesByOwner(owner) {
                    return Array.from({ length: owner === 'blue' ? 1 : 1 }, (_, id) => ({ id }));
                }
            };
        }
        return state;
    };

    assert.deepEqual(
        analyzer.rankDefenses(
            game, [safe, exposed], 'blue', { red: 6, blue: 1 }, simulateMove, generateMoves
        ),
        [safe]
    );
});


test('defense ranking rejects a move that creates an immediate enemy base invasion', () => {
    const analyzer = new TacticalAnalyzer();
    const game = position();
    const safe = { parentNodeId: 1, targetAreaId: 4 };
    const exposed = { parentNodeId: 2, targetAreaId: 5 };
    const generateMoves = (state, side) => side === 'red' && state.exposesBase
        ? [{ parentNodeId: 9, targetAreaId: 1, attacks: false }]
        : [];
    const simulateMove = (state, move, side) => side === 'blue'
        ? { ...position(), exposesBase: move.targetAreaId === exposed.targetAreaId }
        : state;

    assert.deepEqual(
        analyzer.rankDefenses(
            game, [safe, exposed], 'blue', { red: 6, blue: 1 }, simulateMove, generateMoves
        ),
        [safe]
    );
});


test('immediate-win scan simulates attacks only after checking direct base entries', () => {
    const analyzer = new TacticalAnalyzer();
    const game = position();
    const moves = [
        { parentNodeId: 1, targetAreaId: 6, attacks: false },
        { parentNodeId: 2, targetAreaId: 7, attacks: false },
        { parentNodeId: 3, targetAreaId: 8, attacks: true }
    ];
    const calls = [];
    const generateMoves = () => moves;
    const simulateMove = (_state, move) => {
        calls.push(move.targetAreaId);
        return {
            isGameOver: true,
            getPlayerRootNodes: side => side === 'blue' ? [] : [{}]
        };
    };

    const count = analyzer.countImmediateWinningMoves(
        game, 'red', { red: 1, blue: 6 }, generateMoves, simulateMove
    );

    assert.equal(count, 2);
    assert.deepEqual(calls, [8]);
});


test('tactical reply generation and attack simulation are reused per candidate position', () => {
    const analyzer = new TacticalAnalyzer();
    const root = position();
    const candidates = [
        { parentNodeId: 1, targetAreaId: 4, _nextState: position() },
        { parentNodeId: 2, targetAreaId: 5, _nextState: position() }
    ];
    let generated = 0;
    let simulatedAttacks = 0;
    const generateMoves = (_state, side) => {
        generated++;
        return side === 'red' && _state !== root
            ? [{ targetAreaId: 8, attacks: true }]
            : [];
    };
    const simulateMove = (state, move, side) => {
        if (side === 'red') simulatedAttacks++;
        return state;
    };

    analyzer.rankDefenses(
        root, candidates, 'blue', { red: 6, blue: 1 }, simulateMove, generateMoves
    );

    assert.equal(generated, 3,
        'generate opponent replies once for the current position and once per candidate position');
    assert.equal(simulatedAttacks, 2,
        'each candidate position should simulate its attack reply only once');
});

test('cascade loss counts descendants correctly when the directly attacked target is a root', () => {
    const analyzer = new TacticalAnalyzer();
    const root = { id: 1, areaId: 2 };
    const child = { id: 2, areaId: 3 };
    const grandchild = { id: 3, areaId: 4 };
    const game = {
        isGameOver: false,
        getAliveNodesByOwner: side => side === 'blue' ? [root, child, grandchild] : [{ id: 9 }],
        getPlayerRootNodes: side => side === 'blue' ? [root] : [{ id: 9 }]
    };
    const next = {
        isGameOver: false,
        getAliveNodesByOwner: side => side === 'blue' ? [] : [{ id: 9 }],
        getPlayerRootNodes: side => side === 'blue' ? [] : [{ id: 9 }]
    };
    const risk = analyzer.measureAttackRisk(
        game, 'blue', 'red', { red: 6, blue: 1 },
        () => [{ targetAreaId: 2, attacks: true }],
        () => next
    );

    assert.equal(risk.maxRootLoss, 1);
    assert.equal(risk.maxNodeLoss, 3);
    assert.equal(risk.maxCascadeLoss, 2,
        'both non-root descendants are cascade losses; the attacked root is not subtracted twice');
});
