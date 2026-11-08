import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from './GameState.js';

test('rejects invalid node data and invalid parent references without mutating state', () => {
    const game = new GameState();
    assert.equal(game.addNode(null, NaN, 10, 1, 'red'), null);
    assert.equal(game.addNode(404, 10, 10, 1, 'red'), null);
    assert.equal(game.addNode(null, 10, 10, 0, 'red'), null);
    assert.equal(game.nodes.length, 0);
    assert.equal(game.nodeIdCounter, 0);
});

test('child nodes require an alive parent owned by the acting player', () => {
    const game = new GameState();
    const redRoot = game.addNode(null, 10, 10, 1, 'red');
    assert.ok(redRoot);
    assert.equal(game.addNode(redRoot.id, 20, 20, 2, 'blue'), null);
    const blueRoot = game.addNode(null, 30, 30, 3, 'blue');
    assert.ok(blueRoot);
    assert.equal(game.addNode(blueRoot.id, 40, 40, 4, 'red'), null);
    game.deleteNodes([redRoot.id]);
    assert.equal(game.addNode(redRoot.id, 20, 20, 2, 'red'), null);
    assert.equal(game.nodes.length, 1);
});

test('valid growth links parent and child exactly once', () => {
    const game = new GameState();
    const root = game.addNode(null, 10, 10, 1, 'red');
    const child = game.addNode(root.id, 20, 20, 2, 'red');
    assert.ok(child);
    assert.deepEqual(root.childrenIds, [child.id]);
    assert.equal(child.parentId, root.id);
});


test('deleting a node cascades through descendants and preserves remaining links', () => {
    const game = new GameState();
    const root = game.addNode(null, 0, 0, 1, 'red');
    const branch = game.addNode(root.id, 1, 1, 2, 'red');
    const leaf = game.addNode(branch.id, 2, 2, 3, 'red');
    const otherBranch = game.addNode(root.id, 3, 3, 4, 'red');

    const deleted = game.deleteNodes([branch.id]);
    assert.deepEqual(new Set(deleted), new Set([branch.id, leaf.id]));
    assert.equal(game.getNode(branch.id), undefined);
    assert.equal(game.getNode(leaf.id), undefined);
    assert.deepEqual(root.childrenIds, [otherBranch.id]);
    assert.equal(otherBranch.parentId, root.id);
});

test('deleting multiple overlapping subtrees is safe and idempotent', () => {
    const game = new GameState();
    const root = game.addNode(null, 0, 0, 1, 'red');
    const child = game.addNode(root.id, 1, 1, 2, 'red');
    const leaf = game.addNode(child.id, 2, 2, 3, 'red');

    assert.deepEqual(new Set(game.deleteNodes([root.id, child.id, 999])), new Set([root.id, child.id, leaf.id]));
    assert.equal(game.nodes.length, 0);
    assert.deepEqual(game.deleteNodes([root.id]), []);
});

test('save round-trip preserves frozen state and rejects inconsistent child references', () => {
    const game = new GameState();
    const root = game.addNode(null, 0, 0, 1, 'red');
    const child = game.addNode(root.id, 1, 1, 2, 'red');
    child.isFrozen = true;

    const restored = GameState.fromJSON(JSON.parse(JSON.stringify(game.toJSON())));
    assert.equal(restored.getNode(child.id).isFrozen, true);
    assert.deepEqual(restored.getNode(root.id).childrenIds, [child.id]);

    const invalid = game.toJSON();
    invalid.nodes[0].childrenIds = [];
    assert.throws(() => GameState.fromJSON(invalid), /父子节点关系无效/);
});
