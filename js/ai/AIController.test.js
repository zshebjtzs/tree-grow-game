import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../game/GameState.js';
import { AIController } from './AIController.js';

test('AI can reconstruct a complete game snapshot and return a legal move', () => {
    const game = new GameState();
    game.currentTurn = 'blue';
    game.addNode(null, 0, 0, 1, 'red');
    const blueRoot = game.addNode(null, 0, 0, 3, 'blue');
    assert.ok(blueRoot);

    const adjacency = {
        1: [2],
        2: [1, 3, 4],
        3: [2, 4],
        4: [2, 3]
    };
    const areaCenters = [[0, 0], [10, 0], [20, 0], [30, 0]];
    const ai = new AIController('hard', adjacency, areaCenters);

    const move = ai.getBestMove({
        ...game.toJSON(),
        redBaseId: 1,
        blueBaseId: 3
    }, 'blue');

    assert.ok(move);
    assert.equal(move.parentNodeId, blueRoot.id);
    assert.ok([2, 4].includes(move.targetAreaId));
});


test('AI root expansion considers map areas independently of direct-neighbor entries', () => {
    const game = new GameState();
    game.currentTurn = 'blue';
    game.addNode(null, 0, 0, 3, 'red');
    const blueRoot = game.addNode(null, 0, 0, 1, 'blue');
    assert.ok(blueRoot);

    // Area 3 is referenced as a neighbor but has no own adjacency entry.
    const ai = new AIController('hard', { 1: [2, 3], 2: [1] }, [[0, 0], [10, 0], [20, 0]]);
    const move = ai.getBestMove({
        ...game.toJSON(),
        redBaseId: 3,
        blueBaseId: 1
    }, 'blue');

    assert.ok(move);
    assert.equal(move.parentNodeId, blueRoot.id);
    assert.equal(move.targetAreaId, 3);
});


test('AI rejects an unsupported player side instead of returning an empty move', () => {
    const game = new GameState();
    const root = game.addNode(null, 0, 0, 1, 'red');
    assert.ok(root);
    const ai = new AIController('hard', { 1: [2], 2: [1] }, [[0, 0], [10, 0]]);
    assert.throws(() => ai.getBestMove({
        ...game.toJSON(),
        redBaseId: 1,
        blueBaseId: 2
    }, 'green'), /玩家阵营无效/);
});
