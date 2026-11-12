import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from './GameState.js';
import { resolveCombat } from './CombatResolver.js';

function addChild(game, parent, areaId, owner) {
    game.currentTurn = owner;
    return game.addNode(parent.id, areaId * 10, areaId * 10, areaId, owner);
}

test('fortress repels the invading node without damaging the defender tree', () => {
    const game = new GameState();
    const redRoot = game.addNode(null, 0, 0, 1, 'red');
    const attacker = addChild(game, redRoot, 2, 'red');
    const blueRoot = game.addNode(null, 0, 0, 3, 'blue');
    const fortress = addChild(game, blueRoot, 4, 'blue');
    addChild(game, fortress, 5, 'blue');
    addChild(game, fortress, 6, 'blue');
    addChild(game, fortress, 7, 'blue');

    const result = resolveCombat(game, attacker, fortress);
    assert.deepEqual(result.nodesToDelete, [attacker.id]);
    assert.equal(result.freezeTargetId, null);
});

test('low-degree branching defender loses its complete subtree', () => {
    const game = new GameState();
    const redRoot = game.addNode(null, 0, 0, 1, 'red');
    const attacker = addChild(game, redRoot, 2, 'red');
    const blueRoot = game.addNode(null, 0, 0, 3, 'blue');
    const branch = addChild(game, blueRoot, 4, 'blue');
    const left = addChild(game, branch, 5, 'blue');
    const right = addChild(game, branch, 6, 'blue');

    const result = resolveCombat(game, attacker, branch);
    assert.deepEqual(new Set(result.nodesToDelete), new Set([branch.id, left.id, right.id]));
    assert.equal(result.freezeTargetId, null);
    assert.ok(game.getNode(blueRoot.id));
});

test('chain attack removes the path below a branching point and freezes that point', () => {
    const game = new GameState();
    const redRoot = game.addNode(null, 0, 0, 1, 'red');
    const attacker = addChild(game, redRoot, 2, 'red');
    const blueRoot = game.addNode(null, 0, 0, 3, 'blue');
    const branch = addChild(game, blueRoot, 4, 'blue');
    const chain = addChild(game, branch, 5, 'blue');
    const side = addChild(game, branch, 6, 'blue');
    const defender = addChild(game, chain, 7, 'blue');

    const result = resolveCombat(game, attacker, defender);
    assert.deepEqual(new Set(result.nodesToDelete), new Set([chain.id, defender.id]));
    assert.equal(result.freezeTargetId, branch.id);
    assert.ok(!result.nodesToDelete.includes(side.id));
});

test('uninterrupted chain attack removes the defender root tree', () => {
    const game = new GameState();
    const redRoot = game.addNode(null, 0, 0, 1, 'red');
    const attacker = addChild(game, redRoot, 2, 'red');
    const blueRoot = game.addNode(null, 0, 0, 3, 'blue');
    const child = addChild(game, blueRoot, 4, 'blue');
    const leaf = addChild(game, child, 5, 'blue');

    const result = resolveCombat(game, attacker, child);
    assert.deepEqual(new Set(result.nodesToDelete), new Set([blueRoot.id, child.id, leaf.id]));
    assert.equal(result.freezeTargetId, null);
});
