import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../game/GameState.js';
import { getPositionKey } from './PositionKey.js';

function createRootState() {
    const game = new GameState();
    game.currentTurn = 'red';
    const root = game.addNode(null, 0, 0, 1, 'red');
    return { game, root };
}

test('position key distinguishes roots that have and have not used first growth', () => {
    const used = createRootState();
    const firstBranch = used.game.addNode(used.root.id, 10, 0, 2, 'red');
    used.game.deleteNodes([firstBranch.id]);

    const unused = createRootState();
    // Match the historical node ID counter after the removed branch.
    unused.game.nodeIdCounter = used.game.nodeIdCounter;

    assert.deepEqual(used.root.childrenIds, []);
    assert.deepEqual(unused.root.childrenIds, []);
    assert.equal(used.root.hasUsedRootGrowth, true);
    assert.equal(unused.root.hasUsedRootGrowth, false);

    assert.notEqual(
        getPositionKey(used.game),
        getPositionKey(unused.game),
        'different root-growth history must never share a transposition key'
    );
});

test('position key remains stable across cloned search states', () => {
    const { game, root } = createRootState();
    const child = game.addNode(root.id, 10, 0, 2, 'red');
    game.deleteNodes([child.id]);

    const clone = game.clone();
    assert.equal(root.hasUsedRootGrowth, true);
    assert.equal(clone.getNode(root.id).hasUsedRootGrowth, true);
    assert.equal(getPositionKey(clone), getPositionKey(game));
});

test('position key distinguishes frozen and destroyed node state', () => {
    const { game, root } = createRootState();
    const frozen = game.clone();
    frozen.getNode(root.id).isFrozen = true;
    const destroyed = game.clone();
    destroyed.getNode(root.id).isDestroyed = true;

    assert.notEqual(getPositionKey(game), getPositionKey(frozen));
    assert.notEqual(getPositionKey(game), getPositionKey(destroyed));
});
