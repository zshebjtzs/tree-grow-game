import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../game/GameState.js';
import { resolveCombat } from '../game/CombatResolver.js';
import { TreeGrowAIAdapter } from './TreeGrowAIAdapter.js';
import { getDifficultyProfile } from './DifficultyProfiles.js';

function createAdapter() {
    const adjacency = {
        1: [2], 2: [1, 3], 3: [2, 4], 4: [3, 5],
        5: [4, 6], 6: [5], 7: [8], 8: [7], 9: [10], 10: [9]
    };
    return new TreeGrowAIAdapter({
        adjacency,
        areaCenters: Array.from({ length: 10 }, (_, index) => [index * 10, 0]),
        profile: getDifficultyProfile('medium')
    });
}

function addNode(game, parentId, areaId, owner) {
    return game.addNode(parentId, areaId * 10, 0, areaId, owner);
}

test('AI simulation matches authoritative combat cascade that destroys an entire root chain', () => {
    const adapter = createAdapter();
    const game = new GameState();
    game.currentTurn = 'red';
    const root = addNode(game, null, 1, 'red');
    const first = addNode(game, root.id, 2, 'red');
    const second = addNode(game, first.id, 3, 'red');
    const leaf = addNode(game, second.id, 4, 'red');
    game.currentTurn = 'blue';
    const blueRoot = addNode(game, null, 6, 'blue');
    const attacker = addNode(game, blueRoot.id, 5, 'blue');

    const move = { parentNodeId: attacker.id, targetAreaId: 4, x: 40, y: 0 };
    const simulated = adapter.simulateMove(game, move, 'blue', { red: 1, blue: 6 }, {
        alreadyValidated: true
    });

    const authoritative = game.clone();
    authoritative.currentTurn = 'blue';
    const attackNode = authoritative.addNode(attacker.id, 40, 0, 4, 'blue');
    const defender = authoritative.getNode(leaf.id);
    const combat = resolveCombat(authoritative, attackNode, defender);
    authoritative.deleteNodes(combat.nodesToDelete);
    if (combat.freezeTargetId) authoritative.getNode(combat.freezeTargetId).isFrozen = true;
    authoritative.isGameOver = !authoritative.getPlayerRootNodes('red').length;
    if (!authoritative.isGameOver) {
        for (const node of authoritative.getAliveNodesByOwner('blue')) node.isFrozen = false;
        authoritative.switchTurn();
    }

    assert.deepEqual(simulated.toJSON(), authoritative.toJSON());
    assert.equal(simulated.isGameOver, true);
    assert.equal(simulated.getPlayerRootNodes('red').length, 0);
    assert.equal(simulated.getAliveNodesByOwner('red').length, 0);
});

test('AI simulation preserves a sibling branch and freezes the actual combat stop node', () => {
    const adapter = createAdapter();
    const game = new GameState();
    game.currentTurn = 'red';
    const root = addNode(game, null, 1, 'red');
    const fork = addNode(game, root.id, 2, 'red');
    const attackedLeaf = addNode(game, fork.id, 3, 'red');
    const sibling = addNode(game, fork.id, 4, 'red');
    game.currentTurn = 'blue';
    const blueRoot = addNode(game, null, 6, 'blue');
    const attacker = addNode(game, blueRoot.id, 5, 'blue');

    const simulated = adapter.simulateMove(game, {
        parentNodeId: attacker.id, targetAreaId: 3, x: 30, y: 0
    }, 'blue', { red: 1, blue: 6 }, { alreadyValidated: true });

    const authoritative = game.clone();
    authoritative.currentTurn = 'blue';
    const attackNode = authoritative.addNode(attacker.id, 30, 0, 3, 'blue');
    const combat = resolveCombat(authoritative, attackNode, authoritative.getNode(attackedLeaf.id));
    authoritative.deleteNodes(combat.nodesToDelete);
    if (combat.freezeTargetId) authoritative.getNode(combat.freezeTargetId).isFrozen = true;
    authoritative.isGameOver = !authoritative.getPlayerRootNodes('red').length;
    if (!authoritative.isGameOver) {
        for (const node of authoritative.getAliveNodesByOwner('blue')) node.isFrozen = false;
        authoritative.switchTurn();
    }

    assert.deepEqual(simulated.toJSON(), authoritative.toJSON());
    assert.ok(simulated.getNode(root.id));
    assert.ok(simulated.getNode(fork.id));
    assert.ok(simulated.getNode(sibling.id));
    assert.equal(simulated.getNode(fork.id).isFrozen, true);
    assert.equal(simulated.getNode(attackedLeaf.id), undefined);
    assert.equal(simulated.currentTurn, 'red');
});
