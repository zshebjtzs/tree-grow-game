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
