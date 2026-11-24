import test from 'node:test';
import assert from 'node:assert/strict';
import { OffensiveStrategyAnalyzer } from './OffensiveStrategyAnalyzer.js';

function state({ own = 2, enemy = 3, ownRoots = 1, enemyRoots = 1, isGameOver = false } = {}) {
    const ownNodes = Array.from({ length: own }, (_, id) => ({ id, areaId: id + 1 }));
    const enemyNodes = Array.from({ length: enemy }, (_, id) => ({ id: id + 10, areaId: id + 10 }));
    return {
        isGameOver,
        getAliveNodesByOwner: side => side === 'red' ? ownNodes : enemyNodes,
        getPlayerRootNodes: side => Array.from(
            { length: side === 'red' ? ownRoots : enemyRoots }, (_, id) => ({ id })
        )
    };
}

test('offensive analysis detects root destruction and cascade opportunities from simulated outcomes', () => {
    const analyzer = new OffensiveStrategyAnalyzer();
    const before = state({ own: 3, enemy: 4, enemyRoots: 2 });
    const rootAttack = {
        parentNodeId: 7,
        targetAreaId: 10,
        attacks: true,
        _nextState: state({ own: 3, enemy: 1, enemyRoots: 1 })
    };
    const quietMove = {
        parentNodeId: 8,
        targetAreaId: 9,
        attacks: false,
        _nextState: state({ own: 4, enemy: 4, enemyRoots: 2 })
    };

    const result = analyzer.analyze(before, 'red', [rootAttack, quietMove]);

    assert.equal(result.candidateCount, 2);
    assert.equal(result.attackCandidateCount, 1);
    assert.equal(result.rootAttackCount, 1);
    assert.equal(result.cascadeAttackCount, 1);
    assert.equal(result.highValueAttackCount, 1);
    assert.equal(result.maxEnemyNodeLoss, 3);
    assert.equal(result.maxEnemyRootLoss, 1);
    assert.equal(result.opportunities[0].targetAreaId, 10);
    assert.equal(result.opportunities[0].cascadeLoss, 2);
});

test('offensive analysis recognizes an immediate win and accounts for own losses', () => {
    const analyzer = new OffensiveStrategyAnalyzer();
    const before = state({ own: 3, enemy: 2 });
    const winningAttack = {
        parentNodeId: 4,
        targetAreaId: 10,
        attacks: true,
        _nextState: state({ own: 2, enemy: 0, enemyRoots: 0, isGameOver: true })
    };

    const result = analyzer.analyze(before, 'red', [winningAttack]);

    assert.equal(result.immediateWinningAttackCount, 1);
    assert.equal(result.highValueAttackCount, 1);
    assert.equal(result.opportunities[0].immediateWin, true);
    assert.equal(result.opportunities[0].ownNodeLoss, 1);
});

test('offensive analysis ignores non-attack moves and unavailable simulations', () => {
    const analyzer = new OffensiveStrategyAnalyzer();
    const before = state();
    const result = analyzer.analyze(before, 'red', [
        { attacks: false, _nextState: state() },
        { attacks: true, _nextState: null }
    ]);

    assert.equal(result.attackCandidateCount, 0);
    assert.equal(result.highValueAttackCount, 0);
    assert.deepEqual(result.opportunities, []);
});
