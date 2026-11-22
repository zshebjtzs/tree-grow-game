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
    const game = position();
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
            return position({ vulnerable: move.targetAreaId === risky.targetAreaId });
        }
        if (side === 'red' && state.vulnerable && move.attacks) {
            return position({ blueRoots: 0, isGameOver: true });
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
