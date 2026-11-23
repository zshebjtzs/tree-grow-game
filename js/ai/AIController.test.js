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
    for (const difficulty of ['beginner', 'easy', 'medium', 'advanced', 'hard', 'expert']) {
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


test('all six difficulty levels only return moves accepted by RuleEngine', () => {
    for (const difficulty of ['beginner', 'easy', 'medium', 'advanced', 'hard', 'expert']) {
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
    for (const difficulty of ['beginner', 'easy', 'medium', 'advanced', 'hard', 'expert']) {
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

test('generated legal moves are not revalidated during simulation, while external moves remain validated', () => {
    const game = new GameState();
    game.currentTurn = 'blue';
    const redRoot = game.addNode(null, 0, 0, 6, 'red');
    const blueRoot = game.addNode(null, 0, 0, 1, 'blue');
    const ai = new AIController('hard', line, centers);
    const bases = { red: 6, blue: 1 };

    const originalCanGrow = ai.ruleEngine.canGrow.bind(ai.ruleEngine);
    let validationCalls = 0;
    ai.ruleEngine.canGrow = (...args) => {
        validationCalls++;
        return originalCanGrow(...args);
    };

    const generated = ai._generateMoves(game, 'blue', bases);
    assert.ok(generated.length > 0);
    const callsAfterGeneration = validationCalls;
    const legalMove = generated[0];
    const simulated = ai._simulateMove(game, legalMove, 'blue', bases, { alreadyValidated: true });
    assert.ok(simulated);
    assert.equal(validationCalls, callsAfterGeneration,
        'a move returned by _generateMoves must not repeat RuleEngine validation');

    const invalidMove = {
        parentNodeId: blueRoot.id,
        targetAreaId: 1,
        x: centers[0][0],
        y: centers[0][1]
    };
    assert.equal(ai._simulateMove(game, invalidMove, 'blue', bases), null);
    assert.ok(validationCalls > callsAfterGeneration,
        'untrusted/external moves must still go through RuleEngine validation');
    assert.equal(redRoot.areaId, 6);
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

test('all difficulty profiles share evaluation weights and vary only by search budget', async () => {
    const { getDifficultyProfile, DIFFICULTY_LEVELS } = await import('./DifficultyProfiles.js');
    assert.deepEqual(DIFFICULTY_LEVELS, ['beginner', 'easy', 'medium', 'advanced', 'hard', 'expert']);
    const profiles = DIFFICULTY_LEVELS.map(getDifficultyProfile);
    const weightKeys = [
        'progressWeight', 'attackWeight', 'rootAttackWeight',
        'expansionWeight', 'safetyWeight', 'structureWeight', 'branchingWeight',
        'rootSafetyWeight', 'rootChainRiskWeight', 'softDistanceWeight',
        'growthHeadroomWeight', 'baseThreatWeight', 'siegePreparationWeight',
        'siegeFortressWeight'
    ];
    const baselineWeights = Object.fromEntries(weightKeys.map(key => [key, profiles[0][key]]));
    for (const profile of profiles) {
        assert.deepEqual(
            Object.fromEntries(weightKeys.map(key => [key, profile[key]])),
            baselineWeights
        );
        assert.ok(profile.maxDepth > 0);
        assert.ok(profile.searchBudgetMs > 0);
        assert.ok(profile.maxNodes > 0);
        assert.equal('selection' in profile, false);
        assert.equal('searchWidth' in profile, false);
    }
    for (let index = 1; index < profiles.length; index++) {
        assert.ok(profiles[index].maxDepth > profiles[index - 1].maxDepth);
        assert.ok(profiles[index].searchBudgetMs > profiles[index - 1].searchBudgetMs);
        assert.ok(profiles[index].maxNodes > profiles[index - 1].maxNodes);
    }
    assert.deepEqual(
        DIFFICULTY_LEVELS.map(getDifficultyProfile).map(profile => profile.label),
        ['入门', '简单', '普通', '进阶', '困难', '专家']
    );
    assert.throws(() => getDifficultyProfile('unknown'), /难度无效/);
});


test('all six difficulties configure bounded iterative search', async () => {
    const { getDifficultyProfile } = await import('./DifficultyProfiles.js');
    const expectedDepths = [1, 2, 4, 5, 7, 8];
    const profiles = ['beginner', 'easy', 'medium', 'advanced', 'hard', 'expert']
        .map(getDifficultyProfile);

    assert.deepEqual(profiles.map(profile => profile.maxDepth), expectedDepths);
    for (let index = 0; index < profiles.length; index++) {
        assert.ok(profiles[index].searchBudgetMs > 0);
        assert.ok(profiles[index].maxNodes > 0);
        if (index > 0) {
            assert.ok(profiles[index].searchBudgetMs > profiles[index - 1].searchBudgetMs);
            assert.ok(profiles[index].maxNodes > profiles[index - 1].maxNodes);
        }
    }
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


test('search reuses prepared root states and orders opponent replies by their own value', () => {
    const ai = new AIController('hard', line, centers);
    const root = {
        currentTurn: 'blue',
        isGameOver: false,
        toJSON() {
            return { currentTurn: this.currentTurn, lastMove: this.lastMove ?? null };
        }
    };
    const scoredStates = [];
    const rootChildScores = [];
    const searchedReplies = [];
    let rootSimulations = 0;
    let rootChild = null;
    let rootChildKeySerializations = 0;

    ai._generateMoves = (state, side) => side === 'red'
        ? [{ targetAreaId: 5 }, { targetAreaId: 4 }]
        : [];
    ai._simulateMove = (state, move, side) => {
        if (state === root) rootSimulations++;
        const next = {
            currentTurn: side === 'red' ? 'blue' : 'red',
            isGameOver: false,
            lastMove: move.targetAreaId,
            toJSON() {
                if (next === rootChild) rootChildKeySerializations++;
                return { currentTurn: this.currentTurn, lastMove: this.lastMove ?? null };
            }
        };
        if (state === root) rootChild = next;
        return next;
    };
    ai._scoreMove = (state, move, side, bases, next) => {
        scoredStates.push(state);
        if (state === rootChild) rootChildScores.push(state);
        assert.ok(next, 'move ordering should score the already prepared child state');
        return move.targetAreaId;
    };
    ai._simulatePass = (state, side) => ({
        ...state,
        currentTurn: side === 'red' ? 'blue' : 'red',
        toJSON() {
            return { currentTurn: this.currentTurn, lastMove: this.lastMove ?? null };
        }
    });
    ai._evaluateState = state => {
        if (state.currentTurn === 'blue' && state.lastMove !== 2) {
            searchedReplies.push(state.lastMove);
        }
        return state.lastMove || 0;
    };

    ai._search(root, [
        { parentNodeId: 1, targetAreaId: 2, x: 0, y: 0, score: 10 }
    ], 'blue', { red: 6, blue: 1 });

    assert.equal(rootSimulations, 1, 'root child state should be prepared once and reused across depths');
    assert.equal(rootChildKeySerializations, 1,
        'an immutable root child position key should be serialized only once');
    assert.equal(scoredStates.includes(root), false, 'root actions should not be rescored');
    assert.equal(rootChildScores.length, 2,
        'the reused root child should not have its internal move ordering recomputed at every depth');
    assert.ok(searchedReplies.length >= 1);
    assert.equal(searchedReplies[0], 5,
        'the opponent-favorable reply must be traversed first at a minimizing node');
});


test('AI decision explanation reports measurable route and search evidence', () => {
    const game = new GameState();
    game.currentTurn = 'blue';
    game.addNode(null, 0, 0, 6, 'red');
    const blueRoot = game.addNode(null, 0, 0, 1, 'blue');
    const ai = new AIController('hard', line, centers);
    const progress = [];
    ai.onProgress = snapshot => progress.push(snapshot);

    const move = ai.getBestMove(snapshot(game, 6, 1), 'blue');
    assert.ok(move);
    assert.equal(move.parentNodeId, blueRoot.id);
    assert.equal(ai.lastDecisionExplanation.title, 'AI 行动分析');
    assert.ok(ai.lastDecisionExplanation.details.some(detail => detail.includes('图论距离')));
    assert.ok(ai.lastDecisionExplanation.search.completedDepth > 0);
    assert.ok(ai.lastDecisionExplanation.search.nodes > 0);
    assert.ok(ai.lastSearchStats.preparationMs >= 0);
    assert.ok(ai.lastSearchStats.totalMs >= ai.lastSearchStats.preparationMs);
    assert.equal(ai.lastSearchStats.deadlineMs, ai.profile.searchBudgetMs);
    assert.equal(typeof ai.lastSearchStats.deadlineExceeded, 'boolean');
    assert.ok(progress.some(item => item.phase === 'evaluating'));
    assert.ok(progress.some(item => item.phase === 'search'));
    assert.equal(progress.at(-1).phase, 'complete');
});

test('AI explains an immediate win as a verified tactical result', () => {
    const game = new GameState();
    game.currentTurn = 'blue';
    const blueRoot = game.addNode(null, 0, 0, 5, 'blue');
    game.addNode(null, 0, 0, 6, 'red');
    const ai = new AIController('easy', line, centers);
    const move = ai.getBestMove(snapshot(game, 6, 1), 'blue');
    assert.equal(move.parentNodeId, blueRoot.id);
    assert.equal(move.targetAreaId, 6);
    assert.match(ai.lastDecisionExplanation.summary, /立即获胜/);
});


test('AI excludes an already-grown root while retaining unused roots as growth candidates', () => {
    const game = new GameState();
    game.currentTurn = 'blue';

    const usedRoot = game.addNode(null, 0, 0, 1, 'blue');
    const unusedRootA = game.addNode(null, 0, 0, 3, 'blue');
    const unusedRootB = game.addNode(null, 0, 0, 5, 'blue');
    game.addNode(usedRoot.id, 10, 0, 2, 'blue');

    assert.equal(usedRoot.hasUsedRootGrowth, true);
    assert.equal(unusedRootA.hasUsedRootGrowth, false);
    assert.equal(unusedRootB.hasUsedRootGrowth, false);

    const ai = new AIController('hard', line, centers);
    const moves = ai._generateMoves(game, 'blue', { red: 6, blue: 1 });
    const parentIds = new Set(moves.map(move => move.parentNodeId));

    assert.equal(parentIds.has(usedRoot.id), false,
        'an already-grown root with a surviving child must never be selected again');
    assert.equal(parentIds.has(unusedRootA.id), true,
        'an unused root must remain eligible for its first growth');
    assert.equal(parentIds.has(unusedRootB.id), true,
        'another unused root must remain eligible for its first growth');
});

test('AI never generates a second root branch after the original branch is destroyed', () => {
    const game = new GameState();
    game.currentTurn = 'blue';
    const root = game.addNode(null, 0, 0, 1, 'blue');
    const firstBranch = game.addNode(root.id, 10, 0, 2, 'blue');
    game.deleteNodes([firstBranch.id]);
    assert.deepEqual(root.childrenIds, []);
    assert.equal(root.hasUsedRootGrowth, true);

    const ai = new AIController('hard', line, centers);
    assert.deepEqual(ai._generateMoves(game, 'blue', { red: 6, blue: 1 }), []);
    assert.equal(ai.getBestMove(snapshot(game, 6, 1), 'blue'), null);
});


test('deep search receives every legal root candidate without a static width cutoff', () => {
    const ai = new AIController('hard', line, centers);
    const game = new GameState();
    game.currentTurn = 'red';
    game.addNode(null, 0, 0, 1, 'red');
    const candidates = Array.from({ length: 14 }, (_, index) => ({
        parentNodeId: 1,
        targetAreaId: index + 2,
        x: index * 10,
        y: 0,
        score: 100 - index,
        _nextState: {}
    }));
    let receivedMoves = null;
    ai.searchEngine.search = options => {
        receivedMoves = options.rootMoves;
        return {
            move: options.rootMoves[0],
            value: 0,
            completedDepth: 0,
            nodes: 0,
            cutoffs: 0,
            transpositionHits: 0,
            elapsedMs: 0
        };
    };

    ai._search(game, candidates, 'red', { red: 1, blue: 50 });
    assert.equal(receivedMoves.length, candidates.length);
    assert.deepEqual(receivedMoves, candidates);
});


test('all six difficulties execute the shared search pipeline on non-terminal positions', () => {
    for (const difficulty of ['beginner', 'easy', 'medium', 'advanced', 'hard', 'expert']) {
        const game = new GameState();
        game.currentTurn = 'blue';
        game.addNode(null, 0, 0, 6, 'red');
        game.addNode(null, 0, 0, 1, 'blue');
        const ai = new AIController(difficulty, line, centers);
        const move = ai.getBestMove(snapshot(game, 6, 1), 'blue');

        assert.ok(move, `${difficulty} should return a legal move`);
        assert.ok(ai.lastSearchStats, `${difficulty} should use SearchEngine`);
        assert.ok(ai.lastSearchStats.completedDepth >= 1,
            `${difficulty} should complete at least one search iteration`);
    }
});


test('AIController rejects adapters that do not satisfy the game-mode contract', () => {
    assert.throws(
        () => new AIController('medium', line, centers, {}),
        /AI 适配器接口无效/
    );
});
