import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../js/game/GameState.js';
import { RuleEngine } from '../js/game/RuleEngine.js';

function setup() {
    const adjacency = { 1: [2, 3], 2: [1, 3, 4], 3: [1, 2, 4], 4: [2, 3, 5], 5: [4] };
    const engine = new RuleEngine({ adjacency });
    const game = new GameState();
    game.currentTurn = 'red';
    const root = game.addNode(null, 0, 0, 1, 'red');
    game.addNode(null, 0, 0, 5, 'blue');
    return { game, engine, root };
}

test('ordinary growth only permits one adjacent area', () => {
    const { game, engine, root } = setup();
    assert.equal(engine.canGrow(game, root, 2).allowed, true);
    assert.equal(engine.canGrow(game, root, 4).allowed, false);
});

test('root first branch may use a path of at most two edges', () => {
    const { game, engine, root } = setup();
    assert.equal(engine.canGrow(game, root, 3).allowed, true);
    assert.equal(engine.canGrow(game, root, 4).allowed, false);
    assert.equal(engine.canGrow(game, root, 5).allowed, false);
});

test('occupied intermediate area blocks root privilege', () => {
    const { game, engine, root } = setup();
    game.addNode(null, 0, 0, 2, 'blue');
    assert.equal(engine.canGrow(game, root, 4).allowed, false);
});

test('frozen and enemy-owned parents are rejected', () => {
    const { game, engine, root } = setup();
    root.isFrozen = true;
    assert.equal(engine.canGrow(game, root, 2).allowed, false);
    root.isFrozen = false;
    root.owner = 'blue';
    assert.equal(engine.canGrow(game, root, 2).allowed, false);
});
