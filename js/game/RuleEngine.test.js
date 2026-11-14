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


test('cached growth context preserves ordinary-move validation results', () => {
    const ruleEngine = new RuleEngine({
        adjacency: { 1: [2], 2: [1, 3, 5], 3: [2, 4], 4: [3], 5: [2] }
    });
    const game = new GameState();
    game.currentTurn = 'red';
    game.addNode(null, 0, 0, 1, 'red');
    const parent = game.addNode(1, 10, 0, 2, 'red');
    game.currentTurn = 'blue';
    game.addNode(null, 40, 0, 5, 'blue');
    game.currentTurn = 'red';

    const context = ruleEngine.createGrowthContext(game, 'red');
    const options = { ownBaseId: 1, enemyBaseId: 5 };
    for (const target of [1, 2, 3, 4, 5]) {
        assert.deepEqual(
            ruleEngine.canGrow(game, parent, target, options),
            ruleEngine.canGrow(game, parent, target, { ...options, context }),
            `context result differs for target area ${target}`
        );
    }
});

test('cached growth context preserves first-root-branch distance validation', () => {
    const ruleEngine = new RuleEngine({
        adjacency: { 1: [2], 2: [1, 3], 3: [2, 4], 4: [3] }
    });
    const game = new GameState();
    game.currentTurn = 'red';
    const root = game.addNode(null, 0, 0, 1, 'red');
    game.addNode(null, 30, 0, 4, 'red');
    const context = ruleEngine.createGrowthContext(game, 'red');

    for (const target of [2, 3, 4]) {
        assert.deepEqual(
            ruleEngine.canGrow(game, root, target),
            ruleEngine.canGrow(game, root, target, { context }),
            `root-context result differs for target area ${target}`
        );
    }
});
