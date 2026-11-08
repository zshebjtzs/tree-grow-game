import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from './GameState.js';
import { RuleEngine } from './RuleEngine.js';

const engine = new RuleEngine({ adjacency: { 1: [2], 2: [1, 3], 3: [2, 5], 4: [], 5: [3] } });

test('ordinary growth must use one adjacent area and cannot cross occupied areas', () => {
    const game = new GameState();
    const root = game.addNode(null, 0, 0, 1, 'red');
    const child = game.addNode(root.id, 1, 1, 2, 'red');
    assert.equal(engine.canGrow(game, child, 3).allowed, true);
    assert.equal(engine.canGrow(game, child, 1).allowed, false);
    assert.equal(engine.canGrow(game, child, 4).allowed, false);
});

test('root first branch can reach at most two edges and cannot pass occupied intermediates', () => {
    const game = new GameState();
    const root = game.addNode(null, 0, 0, 1, 'red');
    game.addNode(null, 1, 1, 4, 'red');
    game.addNode(null, 2, 2, 5, 'red');
    assert.equal(engine.canGrow(game, root, 3).allowed, true);
    assert.equal(engine.canGrow(game, root, 5).allowed, false);
});
