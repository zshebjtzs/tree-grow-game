import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from './GameState.js';
import { resolveCombat } from './CombatResolver.js';
import { createCombatEvent } from '../presentation/CombatEvent.js';

function addChild(game, parent, areaId, owner) {
    game.currentTurn = owner;
    return game.addNode(parent.id, areaId * 10, areaId * 10, areaId, owner);
}

test('combat resolver rejects fortress targets as an invariant guard', () => {
    const game = new GameState();
    const redRoot = game.addNode(null, 0, 0, 1, 'red');
    const attacker = addChild(game, redRoot, 2, 'red');
    const blueRoot = game.addNode(null, 0, 0, 3, 'blue');
    const fortress = addChild(game, blueRoot, 4, 'blue');
    addChild(game, fortress, 5, 'blue');
    addChild(game, fortress, 6, 'blue');
    addChild(game, fortress, 7, 'blue');

    const nodeCount = game.getAliveNodes().length;
    assert.throws(() => resolveCombat(game, attacker, fortress), /堡垒节点不能作为攻击目标/);
    assert.equal(game.getAliveNodes().length, nodeCount);
    assert.equal(game.getNode(attacker.id), attacker);
    assert.equal(game.getNode(fortress.id), fortress);
});

test('direct attack on a branching node destroys its complete tree when no ancestor branch exists', () => {
    const game = new GameState();
    const redRoot = game.addNode(null, 0, 0, 1, 'red');
    const attacker = addChild(game, redRoot, 2, 'red');
    const blueRoot = game.addNode(null, 0, 0, 3, 'blue');
    const branch = addChild(game, blueRoot, 4, 'blue');
    const left = addChild(game, branch, 5, 'blue');
    const right = addChild(game, branch, 6, 'blue');

    const result = resolveCombat(game, attacker, branch);
    assert.deepEqual(new Set(result.nodesToDelete), new Set([blueRoot.id, branch.id, left.id, right.id]));
    assert.equal(result.freezeTargetId, null);
    assert.ok(!result.nodesToDelete.includes(attacker.id));
    game.deleteNodes(result.nodesToDelete);
    assert.equal(game.getNode(blueRoot.id), undefined);
    assert.equal(game.getAliveNodesByOwner('blue').length, 0);
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

test('chain destruction does not stop at a branching root and removes its entire tree', () => {
    const game = new GameState();
    const redRoot = game.addNode(null, 0, 0, 1, 'red');
    const attacker = addChild(game, redRoot, 2, 'red');
    const blueRoot = game.addNode(null, 0, 0, 3, 'blue');
    const attackedBranch = addChild(game, blueRoot, 4, 'blue');
    const defender = addChild(game, attackedBranch, 5, 'blue');
    const siblingBranch = addChild(game, blueRoot, 6, 'blue');
    const siblingLeaf = addChild(game, siblingBranch, 7, 'blue');

    const result = resolveCombat(game, attacker, defender);
    assert.deepEqual(
        new Set(result.nodesToDelete),
        new Set([blueRoot.id, attackedBranch.id, defender.id, siblingBranch.id, siblingLeaf.id])
    );
    assert.equal(result.freezeTargetId, null);

    game.deleteNodes(result.nodesToDelete);
    assert.equal(game.getNode(blueRoot.id), undefined);
    assert.equal(game.getPlayerRootNodes('blue').length, 0);
    assert.equal(game.getAliveNodesByOwner('blue').length, 0);
    assert.equal(game.addNode(blueRoot.id, 80, 80, 8, 'blue'), null, 'destroyed AI root cannot be used for further growth');
});


test('direct attack on a branching node stops at the nearest ancestor branching node', () => {
    const game = new GameState();
    const redRoot = game.addNode(null, 0, 0, 1, 'red');
    const attacker = addChild(game, redRoot, 2, 'red');
    const blueRoot = game.addNode(null, 0, 0, 3, 'blue');
    const ancestorBranch = addChild(game, blueRoot, 4, 'blue');
    const attackedBranch = addChild(game, ancestorBranch, 5, 'blue');
    const attackedLeaf = addChild(game, attackedBranch, 6, 'blue');
    const protectedSibling = addChild(game, ancestorBranch, 7, 'blue');

    const result = resolveCombat(game, attacker, attackedBranch);
    assert.deepEqual(
        new Set(result.nodesToDelete),
        new Set([attackedBranch.id, attackedLeaf.id])
    );
    assert.equal(result.freezeTargetId, ancestorBranch.id);
    assert.ok(!result.nodesToDelete.includes(ancestorBranch.id));
    assert.ok(!result.nodesToDelete.includes(protectedSibling.id));
});

test('combat event reports whole-tree destruction for direct branching-node attack', () => {
    const game = new GameState();
    const redRoot = game.addNode(null, 0, 0, 1, 'red');
    const attacker = addChild(game, redRoot, 2, 'red');
    const blueRoot = game.addNode(null, 0, 0, 3, 'blue');
    const branch = addChild(game, blueRoot, 4, 'blue');
    addChild(game, branch, 5, 'blue');
    addChild(game, branch, 6, 'blue');

    const result = resolveCombat(game, attacker, branch);
    const event = createCombatEvent(game, attacker, branch, result);
    assert.equal(event.outcome, 'tree-destroyed');
    assert.match(event.description, /整棵/);
    assert.ok(event.affectedNodes.some(node => node.id === blueRoot.id));
});

test('combat event reports protected ancestor branch when directly attacking a descendant branch', () => {
    const game = new GameState();
    const redRoot = game.addNode(null, 0, 0, 1, 'red');
    const attacker = addChild(game, redRoot, 2, 'red');
    const blueRoot = game.addNode(null, 0, 0, 3, 'blue');
    const ancestorBranch = addChild(game, blueRoot, 4, 'blue');
    const attackedBranch = addChild(game, ancestorBranch, 5, 'blue');
    addChild(game, attackedBranch, 6, 'blue');
    addChild(game, ancestorBranch, 7, 'blue');

    const result = resolveCombat(game, attacker, attackedBranch);
    const event = createCombatEvent(game, attacker, attackedBranch, result);
    assert.equal(event.outcome, 'branch-cut');
    assert.equal(event.freezeTarget.id, ancestorBranch.id);
});
