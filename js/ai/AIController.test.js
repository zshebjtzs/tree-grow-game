import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../game/GameState.js';
import { AIController } from './AIController.js';
import { RuleEngine } from '../game/RuleEngine.js';

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
    for (const difficulty of ['easy', 'medium', 'hard', 'expert']) {
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


test('all three difficulty levels only return moves accepted by RuleEngine', () => {
    for (const difficulty of ['easy', 'medium', 'hard', 'expert']) {
        const game = new GameState();
        game.currentTurn = 'blue';
        game.addNode(null, 0, 0, 6, 'red');
        const blueRoot = game.addNode(null, 0, 0, 1, 'blue');
        const ai = new AIController(difficulty, line, centers);
        const move = ai.getBestMove(snapshot(game, 6, 1), 'blue');
        assert.ok(move, `${difficulty} should find a legal move`);
        assert.equal(move.parentNodeId, blueRoot.id);
        const restored = GameState.fromJSON(game.toJSON());
        restored.currentTurn = 'blue';
        const parent = restored.getNode(move.parentNodeId);
        const validation = new RuleEngine({ adjacency: line }).canGrow(restored, parent, move.targetAreaId, {
            ownBaseId: 1, enemyBaseId: 6
        });
        assert.equal(validation.allowed, true, `${difficulty} returned an illegal target: ${validation.reason}`);
    }
});

test('all AI difficulties reject a fortress as the only possible attack target', () => {
    const adjacency = {
        1: [2], 2: [1, 3, 4, 5, 6],
        3: [2], 4: [2], 5: [2], 6: [2]
    };
    for (const difficulty of ['easy', 'medium', 'hard', 'expert']) {
        const game = new GameState();
        game.currentTurn = 'blue';
        const blueRoot = game.addNode(null, 0, 0, 1, 'blue');
        game.currentTurn = 'red';
        const redRoot = game.addNode(null, 0, 0, 6, 'red');
        const fortress = game.addNode(redRoot.id, 0, 0, 2, 'red');
        game.addNode(fortress.id, 0, 0, 3, 'red');
        game.addNode(fortress.id, 0, 0, 4, 'red');
        game.addNode(fortress.id, 0, 0, 5, 'red');
        game.currentTurn = 'blue';

        const ai = new AIController(difficulty, adjacency, centers);
        assert.equal(ai.getBestMove(snapshot(game, 6, 1), 'blue'), null, difficulty);
        assert.equal(ai._simulateMove(game, {
            parentNodeId: blueRoot.id,
            targetAreaId: 2,
            x: 10,
            y: 0,
            attacks: true
        }, 'blue', { red: 6, blue: 1 }), null);
    }
});

test('AI returns null when every owned growth parent is frozen', () => {
    const game = new GameState();
    game.currentTurn = 'blue';
    game.addNode(null, 0, 0, 6, 'red');
    const root = game.addNode(null, 0, 0, 1, 'blue');
    root.isFrozen = true;
    const ai = new AIController('hard', line, centers);
    assert.equal(ai.getBestMove(snapshot(game, 6, 1), 'blue'), null);
});

test('AI combat simulation preserves defender freeze until the defender completes its turn', () => {
    const adjacency = {
        1: [2, 6], 2: [1, 3], 3: [2, 4], 4: [3, 5],
        5: [4, 6, 7], 6: [1, 5], 7: [5]
    };
    const game = new GameState();
    game.currentTurn = 'red';
    const redRoot = game.addNode(null, 0, 0, 1, 'red');
    game.currentTurn = 'blue';
    const blueRoot = game.addNode(null, 0, 0, 4, 'blue');
    const branch = game.addNode(blueRoot.id, 0, 0, 5, 'blue');
    game.addNode(branch.id, 0, 0, 7, 'blue');
    game.addNode(branch.id, 0, 0, 6, 'blue');
    game.currentTurn = 'red';
    const ai = new AIController('hard', adjacency, centers);
    const next = ai._simulateMove(game, {
        parentNodeId: redRoot.id, targetAreaId: 6, x: 50, y: 0, attacks: true
    }, 'red', { red: 1, blue: 4 });
    assert.ok(next);
    assert.equal(next.currentTurn, 'blue');
    assert.equal(next.getNode(branch.id).isFrozen, true);
    assert.equal(next.getAliveNodesByOwner('blue').some(node => node.areaId === 6), false);
});


test('AI prioritizes a legal move that removes an immediate enemy base threat', () => {
    const adjacency = {
        1: [4], 2: [3], 3: [2, 4], 4: [1, 3, 6], 5: [6], 6: [4, 5]
    };
    const game = new GameState();
    game.currentTurn = 'red';
    const redRoot = game.addNode(null, 0, 0, 2, 'red');
    const redLeaf = game.addNode(redRoot.id, 20, 0, 3, 'red');
    game.currentTurn = 'blue';
    const blueRoot = game.addNode(null, 60, 0, 6, 'blue');
    game.addNode(blueRoot.id, 40, 0, 4, 'blue');
    game.currentTurn = 'red';

    const ai = new AIController('hard', adjacency, centers);
    const move = ai.getBestMove(snapshot(game, 1, 6), 'red');
    assert.ok(move);
    assert.equal(move.parentNodeId, redLeaf.id);
    assert.equal(move.targetAreaId, 4);
});


test('expert difficulty is accepted and returns a RuleEngine-legal move', () => {
    const game = new GameState();
    game.currentTurn = 'blue';
    game.addNode(null, 0, 0, 6, 'red');
    const blueRoot = game.addNode(null, 0, 0, 1, 'blue');
    const ai = new AIController('expert', line, centers);
    const move = ai.getBestMove(snapshot(game, 6, 1), 'blue');
    assert.ok(move);
    assert.equal(move.parentNodeId, blueRoot.id);
    const restored = GameState.fromJSON(game.toJSON());
    restored.currentTurn = 'blue';
    const validation = new RuleEngine({ adjacency: line }).canGrow(
        restored, restored.getNode(move.parentNodeId), move.targetAreaId,
        { ownBaseId: 1, enemyBaseId: 6 }
    );
    assert.equal(validation.allowed, true);
});

test('difficulty profiles encode distinct strategic priorities and expert search breadth', async () => {
    const { getDifficultyProfile, DIFFICULTY_LEVELS } = await import('./DifficultyProfiles.js');
    assert.deepEqual(DIFFICULTY_LEVELS, ['easy', 'medium', 'hard', 'expert']);
    const easy = getDifficultyProfile('easy');
    const medium = getDifficultyProfile('medium');
    const hard = getDifficultyProfile('hard');
    const expert = getDifficultyProfile('expert');
    assert.ok(easy.expansionWeight > medium.expansionWeight);
    assert.ok(easy.attackWeight < medium.attackWeight);
    assert.ok(hard.attackWeight > medium.attackWeight);
    assert.ok(expert.safetyWeight > hard.safetyWeight);
    assert.ok(expert.structureWeight > hard.structureWeight);
    assert.ok(expert.searchWidth > hard.searchWidth);
    assert.throws(() => getDifficultyProfile('unknown'), /难度无效/);
});


test('hard and expert profiles configure bounded iterative search', async () => {
    const { getDifficultyProfile } = await import('./DifficultyProfiles.js');
    const hard = getDifficultyProfile('hard');
    const expert = getDifficultyProfile('expert');
    assert.equal(hard.maxDepth, 4);
    assert.equal(expert.maxDepth, 5);
    assert.ok(hard.searchBudgetMs > 0 && expert.searchBudgetMs > hard.searchBudgetMs);
    assert.ok(hard.maxNodes > 0 && expert.maxNodes > hard.maxNodes);
});


test('multi-source base-distance search respects occupied blockers and caches position queries', () => {
    const adjacency = {
        1: [2], 2: [1, 3], 3: [2, 4], 4: [3, 5],
        5: [4, 6], 6: [5, 7], 7: [6]
    };
    const game = new GameState();
    game.currentTurn = 'red';
    game.addNode(null, 0, 0, 1, 'red');
    game.addNode(null, 0, 0, 5, 'red');
    game.currentTurn = 'blue';
    game.addNode(null, 0, 0, 3, 'blue');

    const ai = new AIController('hard', adjacency, centers);
    assert.equal(ai._distanceToBase(game, 'red', 7), 2);
    const cachedPosition = ai.distanceCache.get(game);
    assert.ok(cachedPosition instanceof Map);
    assert.equal(cachedPosition.get('red:7'), 2);
    assert.equal(ai._distanceToBase(game, 'red', 7), 2);
    assert.equal(cachedPosition.size, 1);
});


test('GameState.clone creates an independent state without changing serialized data', () => {
    const game = new GameState();
    game.currentTurn = 'red';
    const root = game.addNode(null, 0, 0, 1, 'red');
    const child = game.addNode(root.id, 10, 0, 2, 'red');
    child.isFrozen = true;
    const before = game.toJSON();

    const clone = game.clone();
    assert.deepEqual(clone.toJSON(), before);
    assert.notEqual(clone, game);
    assert.notEqual(clone.nodes[0], game.nodes[0]);
    assert.notEqual(clone.nodes[0].childrenIds, game.nodes[0].childrenIds);

    clone.getNode(root.id).childrenIds.push(99);
    clone.getNode(child.id).isFrozen = false;
    clone.currentTurn = 'blue';
    assert.deepEqual(game.toJSON(), before);
});


test('search reuses root move ordering and orders minimizing replies by opponent-side value', () => {
    const ai = new AIController('hard', line, centers);
    const root = {
        currentTurn: 'blue',
        isGameOver: false,
        toJSON() {
            return { currentTurn: this.currentTurn, lastMove: this.lastMove ?? null };
        }
    };
    const scoredStates = [];
    const appliedReplies = [];
    ai._generateMoves = (state, side) => side === 'red'
        ? [{ targetAreaId: 5 }, { targetAreaId: 4 }]
        : [];
    ai._simulateMove = (state, move, side) => {
        if (side === 'red') appliedReplies.push(move.targetAreaId);
        return {
            currentTurn: side === 'red' ? 'blue' : 'red',
            isGameOver: false,
            lastMove: move.targetAreaId,
            toJSON() {
                return { currentTurn: this.currentTurn, lastMove: this.lastMove ?? null };
            }
        };
    };
    ai._scoreMove = (state, move) => {
        scoredStates.push(state);
        return move.targetAreaId;
    };
    ai._simulatePass = (state, side) => ({
        ...state,
        currentTurn: side === 'red' ? 'blue' : 'red',
        toJSON() {
            return { currentTurn: this.currentTurn, lastMove: this.lastMove ?? null };
        }
    });
    ai._evaluateState = state => state.lastMove || 0;

    ai._searchHard(root, [
        { parentNodeId: 1, targetAreaId: 2, x: 0, y: 0, score: 10 }
    ], 'blue', { red: 6, blue: 1 });

    assert.equal(scoredStates.includes(root), false, 'root actions should not be rescored');
    assert.ok(appliedReplies.length >= 1);
    assert.equal(appliedReplies[0], 5,
        'the opponent-favorable reply must be searched first at a minimizing node');
});
