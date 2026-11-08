import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../game/GameState.js';
import { AIController } from './AIController.js';

const centers = Array.from({ length: 6 }, (_, i) => [i * 10, 0]);
const line = { 1: [2], 2: [1, 3], 3: [2, 4], 4: [3, 5], 5: [4, 6], 6: [5] };

function snapshot(game, redBaseId, blueBaseId) {
    return { ...game.toJSON(), redBaseId, blueBaseId };
}

test('AI reconstructs a game snapshot and returns a legal move', () => {
    const game = new GameState();
    game.currentTurn = 'blue';
    game.addNode(null, 0, 0, 1, 'red');
    const blueRoot = game.addNode(null, 0, 0, 3, 'blue');
    const ai = new AIController('hard', line, centers);
    const move = ai.getBestMove(snapshot(game, 1, 3), 'blue');
    assert.ok(move);
    assert.equal(move.parentNodeId, blueRoot.id);
    assert.ok([2, 4, 5].includes(move.targetAreaId));
});

test('root first branch can target map areas without a direct adjacency entry', () => {
    const game = new GameState();
    game.currentTurn = 'blue';
    game.addNode(null, 0, 0, 3, 'red');
    const blueRoot = game.addNode(null, 0, 0, 1, 'blue');
    const ai = new AIController('hard', { 1: [2, 3], 2: [1] }, centers.slice(0, 3));
    const move = ai.getBestMove(snapshot(game, 3, 1), 'blue');
    assert.ok(move);
    assert.equal(move.parentNodeId, blueRoot.id);
    assert.equal(move.targetAreaId, 3);
});

test('all difficulties take an immediate legal winning move', () => {
    for (const difficulty of ['easy', 'medium', 'hard']) {
        const game = new GameState();
        game.currentTurn = 'blue';
        game.addNode(null, 0, 0, 6, 'red');
        const blueRoot = game.addNode(null, 0, 0, 5, 'blue');
        const ai = new AIController(difficulty, line, centers);
        const move = ai.getBestMove(snapshot(game, 6, 1), 'blue');
        assert.equal(move.parentNodeId, blueRoot.id);
        assert.equal(move.targetAreaId, 6);
    }
});

test('AI values moves that reduce the legal route distance to the enemy base', () => {
    const game = new GameState();
    game.currentTurn = 'blue';
    game.addNode(null, 0, 0, 6, 'red');
    const blueRoot = game.addNode(null, 0, 0, 1, 'blue');
    const ai = new AIController('hard', line, centers);
    const move = ai.getBestMove(snapshot(game, 6, 1), 'blue');
    assert.equal(move.parentNodeId, blueRoot.id);
    assert.equal(move.targetAreaId, 2);
});

test('AI rejects an unsupported player side and invalid difficulty', () => {
    const game = new GameState();
    game.addNode(null, 0, 0, 1, 'red');
    assert.throws(() => new AIController('extreme', line, centers), /难度无效/);
    const ai = new AIController('hard', line, centers);
    assert.throws(() => ai.getBestMove(snapshot(game, 1, 2), 'green'), /玩家阵营无效/);
});
