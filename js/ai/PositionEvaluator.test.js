import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../game/GameState.js';
import { TreeGrowAIAdapter } from './TreeGrowAIAdapter.js';
import { getDifficultyProfile } from './DifficultyProfiles.js';

function createAdapter(adjacency, areaCount) {
    return new TreeGrowAIAdapter({
        adjacency,
        areaCenters: Array.from({ length: areaCount }, (_, index) => [index * 10, 0]),
        profile: getDifficultyProfile('medium')
    });
}

function addRoot(game, areaId, side) {
    return game.addNode(null, areaId * 10, 0, areaId, side);
}

test('unsafe root and full descendant metrics follow the authoritative combat ancestor rule', () => {
    const adjacency = {
        1: [2], 2: [1, 3], 3: [2, 4], 4: [3, 5], 5: [4],
        6: [7], 7: [6, 8, 9, 10], 8: [7], 9: [7], 10: [7]
    };
    const adapter = createAdapter(adjacency, 10);
    const game = new GameState();
    game.currentTurn = 'red';
    const root = addRoot(game, 1, 'red');
    const first = game.addNode(root.id, 20, 0, 2, 'red');
    const second = game.addNode(first.id, 30, 0, 3, 'red');
    game.addNode(second.id, 40, 0, 4, 'red');
    game.currentTurn = 'blue';
    addRoot(game, 9, 'blue');

    const metrics = adapter.positionEvaluator.getStructuralMetrics(
        game, 'red', { red: 1, blue: 9 }
    );
    assert.equal(metrics.unsafeRoots, 1);
    assert.equal(metrics.rootChainRisk, 3);

    const safeGame = new GameState();
    safeGame.currentTurn = 'red';
    const safeRoot = addRoot(safeGame, 6, 'red');
    const fork = safeGame.addNode(safeRoot.id, 70, 0, 7, 'red');
    safeGame.addNode(fork.id, 80, 0, 8, 'red');
    safeGame.addNode(fork.id, 90, 0, 9, 'red');
    safeGame.addNode(fork.id, 100, 0, 10, 'red');
    safeGame.currentTurn = 'blue';
    addRoot(safeGame, 5, 'blue');

    const safeMetrics = adapter.positionEvaluator.getStructuralMetrics(
        safeGame, 'red', { red: 6, blue: 5 }
    );
    assert.equal(safeMetrics.unsafeRoots, 0);
    assert.equal(safeMetrics.rootChainRisk, 0);

    const forkedGame = new GameState();
    forkedGame.currentTurn = 'red';
    const forkedRoot = addRoot(forkedGame, 6, 'red');
    const twoWayFork = forkedGame.addNode(forkedRoot.id, 70, 0, 7, 'red');
    forkedGame.addNode(twoWayFork.id, 80, 0, 8, 'red');
    forkedGame.addNode(twoWayFork.id, 90, 0, 9, 'red');
    forkedGame.currentTurn = 'blue';
    addRoot(forkedGame, 5, 'blue');
    const forkedMetrics = adapter.positionEvaluator.getStructuralMetrics(
        forkedGame, 'red', { red: 6, blue: 5 }
    );
    assert.equal(forkedMetrics.unsafeRoots, 1,
        'a degree-3 first child is still attackable and does not protect its root');
    assert.equal(forkedMetrics.rootChainRisk, 3,
        'all descendants below a vulnerable fork are exposed, not only one chain');
});

test('terminal base invasion is scored as a win for the side that moved', () => {
    const adjacency = { 1: [2], 2: [1, 3], 3: [2] };
    const adapter = createAdapter(adjacency, 3);
    const game = new GameState();
    game.currentTurn = 'red';
    const redRoot = addRoot(game, 1, 'red');
    const attacker = game.addNode(redRoot.id, 20, 0, 2, 'red');
    game.currentTurn = 'blue';
    addRoot(game, 3, 'blue');
    game.currentTurn = 'red';

    const bases = { red: 1, blue: 3 };
    const terminal = adapter.simulateMove(game, {
        parentNodeId: attacker.id,
        targetAreaId: 3,
        x: 20,
        y: 0
    }, 'red', bases);

    assert.ok(terminal);
    assert.equal(terminal.isGameOver, true);
    assert.equal(terminal.currentTurn, 'red',
        'base invasion ends the game before the turn switches');
    assert.equal(adapter.positionEvaluator.evaluateState(terminal, 'red', bases), 100000);
    assert.equal(adapter.positionEvaluator.evaluateState(terminal, 'blue', bases), -100000);
});

test('soft distance preserves a gradient through an enemy-occupied intermediate area', () => {
    const adjacency = { 1: [2], 2: [1, 3], 3: [2] };
    const adapter = createAdapter(adjacency, 3);
    const game = new GameState();
    game.currentTurn = 'red';
    addRoot(game, 1, 'red');
    game.currentTurn = 'blue';
    addRoot(game, 3, 'blue');
    game.addNode(2, 20, 0, 2, 'blue');

    assert.equal(adapter.distanceToBase(game, 'red', 3), Infinity);
    assert.equal(adapter.softDistanceToBase(game, 'red', 3), 4);
});

test('growth headroom, base threats, and siege metrics use legal RuleEngine actions', () => {
    const adjacency = {
        1: [2], 2: [1, 3, 4, 5, 6],
        3: [2], 4: [2], 5: [2], 6: [2]
    };
    const adapter = createAdapter(adjacency, 6);
    const game = new GameState();
    game.currentTurn = 'red';
    const root = addRoot(game, 1, 'red');
    const attacker = game.addNode(root.id, 20, 0, 2, 'red');
    game.addNode(attacker.id, 40, 0, 4, 'red');
    game.addNode(attacker.id, 50, 0, 5, 'red');
    game.currentTurn = 'blue';
    addRoot(game, 3, 'blue');

    const before = JSON.stringify(game.toJSON());
    const metrics = adapter.positionEvaluator.getStructuralMetrics(
        game, 'red', { red: 1, blue: 3 }
    );
    assert.equal(metrics.growthHeadroom, 1);
    assert.equal(metrics.baseThreatCount, 1);
    assert.equal(metrics.siegePreFortressCount, 1);
    assert.equal(metrics.siegeFortressCount, 0);
    assert.equal(game.currentTurn, 'blue');
    assert.equal(JSON.stringify(game.toJSON()), before);

    const fortressGame = game.clone();
    fortressGame.currentTurn = 'red';
    const fortress = fortressGame.addNode(attacker.id, 60, 0, 6, 'red');
    assert.ok(fortress);
    const fortressMetrics = adapter.positionEvaluator.getStructuralMetrics(
        fortressGame, 'red', { red: 1, blue: 3 }
    );
    assert.equal(fortressMetrics.siegePreFortressCount, 0);
    assert.equal(fortressMetrics.siegeFortressCount, 1);
});

test('structural metrics are cached per immutable state and side', () => {
    const adjacency = { 1: [2], 2: [1, 3], 3: [2] };
    const adapter = createAdapter(adjacency, 3);
    const game = new GameState();
    game.currentTurn = 'red';
    addRoot(game, 1, 'red');
    game.currentTurn = 'blue';
    addRoot(game, 3, 'blue');
    const bases = { red: 1, blue: 3 };

    const first = adapter.positionEvaluator.getStructuralMetrics(game, 'red', bases);
    const second = adapter.positionEvaluator.getStructuralMetrics(game, 'red', bases);
    assert.strictEqual(first, second);
});


test('growth metrics exclude frozen parents and attacks against fortress bases', () => {
    const adjacency = {
        1: [2], 2: [1, 3], 3: [2, 4, 5, 6, 7],
        4: [3], 5: [3], 6: [3], 7: [3]
    };
    const adapter = createAdapter(adjacency, 7);
    const game = new GameState();
    game.currentTurn = 'red';
    const root = addRoot(game, 1, 'red');
    const attacker = game.addNode(root.id, 20, 0, 2, 'red');
    game.currentTurn = 'blue';
    const enemyRoot = addRoot(game, 3, 'blue');
    game.addNode(enemyRoot.id, 40, 0, 4, 'blue');
    game.addNode(enemyRoot.id, 50, 0, 5, 'blue');
    game.addNode(enemyRoot.id, 60, 0, 6, 'blue');
    game.addNode(enemyRoot.id, 70, 0, 7, 'blue');

    const fortressMetrics = adapter.positionEvaluator.getStructuralMetrics(
        game, 'red', { red: 1, blue: 3 }
    );
    assert.equal(enemyRoot.getDegree(), 4);
    assert.equal(fortressMetrics.baseThreatCount, 0);
    assert.equal(fortressMetrics.growthHeadroom, 0);

    const frozenGame = game.clone();
    frozenGame.getNode(attacker.id).isFrozen = true;
    const frozenMetrics = adapter.positionEvaluator.getStructuralMetrics(
        frozenGame, 'red', { red: 1, blue: 3 }
    );
    assert.equal(frozenMetrics.baseThreatCount, 0);
    assert.equal(frozenMetrics.growthHeadroom, 0);
});


test('evaluation rewards protecting the first branch with an actual fortress', () => {
    const adjacency = {
        1: [2], 2: [1, 3, 4, 5],
        3: [2], 4: [2], 5: [2], 8: [9], 9: [8]
    };
    const adapter = createAdapter(adjacency, 9);
    const unsafeGame = new GameState();
    unsafeGame.currentTurn = 'red';
    const root = addRoot(unsafeGame, 1, 'red');
    const firstBranch = unsafeGame.addNode(root.id, 20, 0, 2, 'red');
    unsafeGame.addNode(firstBranch.id, 30, 0, 3, 'red');
    unsafeGame.addNode(firstBranch.id, 40, 0, 4, 'red');
    unsafeGame.currentTurn = 'blue';
    addRoot(unsafeGame, 9, 'blue');

    const safeGame = unsafeGame.clone();
    safeGame.currentTurn = 'red';
    safeGame.addNode(firstBranch.id, 50, 0, 5, 'red');

    const bases = { red: 1, blue: 9 };
    const unsafeScore = adapter.positionEvaluator.evaluateState(unsafeGame, 'red', bases);
    const safeScore = adapter.positionEvaluator.evaluateState(safeGame, 'red', bases);
    assert.ok(safeScore > unsafeScore + 2000,
        'a degree-4 first child should receive the shared root-safety bonus');
});

test('soft distance is evaluated lazily only when the hard route is blocked', () => {
    const adjacency = { 1: [2], 2: [1, 3], 3: [2] };
    const adapter = createAdapter(adjacency, 3);
    const game = new GameState();
    game.currentTurn = 'red';
    addRoot(game, 1, 'red');
    game.currentTurn = 'blue';
    const blueRoot = addRoot(game, 3, 'blue');
    const bases = { red: 1, blue: 3 };

    const originalSoftDistance = adapter.softDistanceToBase.bind(adapter);
    let softDistanceCalls = 0;
    adapter.softDistanceToBase = (...args) => {
        softDistanceCalls++;
        return originalSoftDistance(...args);
    };

    adapter.positionEvaluator.evaluateState(game, 'red', bases);
    assert.equal(softDistanceCalls, 0,
        'reachable hard routes must not trigger fallback Dijkstra searches');

    const blocked = game.clone();
    blocked.currentTurn = 'blue';
    blocked.addNode(blueRoot.id, 20, 0, 2, 'blue');
    adapter.positionEvaluator.evaluateState(blocked, 'red', bases);
    assert.equal(softDistanceCalls, 1,
        'only the side whose hard route is blocked should compute soft distance');
});


test('first-root growth candidate generation is limited to reachable unoccupied paths', () => {
    const adjacency = {
        1: [2, 4], 2: [1, 3], 3: [2],
        4: [1, 5], 5: [4], 8: []
    };
    const adapter = createAdapter(adjacency, 8);
    const game = new GameState();
    game.currentTurn = 'red';
    const root = addRoot(game, 1, 'red');
    addRoot(game, 8, 'red');
    game.currentTurn = 'blue';
    addRoot(game, 4, 'blue');
    game.currentTurn = 'red';

    const context = adapter.ruleEngine.createGrowthContext(game, 'red');
    const targets = adapter.getRootGrowthTargets(root, context);
    assert.deepEqual(new Set(targets), new Set([2, 3, 4]));
    assert.ok(!targets.includes(5),
        'an occupied intermediate area must not be traversed');
    assert.ok(!targets.includes(6) && !targets.includes(7),
        'unreachable map areas must not be scanned as root-growth candidates');

    const legal = targets.filter(target => adapter.ruleEngine.canGrow(game, root, target, {
        ownBaseId: 1,
        enemyBaseId: 4,
        context
    }).allowed);
    assert.deepEqual(legal.sort((a, b) => a - b), [2, 3, 4],
        'candidate pruning must preserve the exact legal root-growth targets');
});


test('position evaluation is cached per immutable state and remains zero-sum', () => {
    const adjacency = { 1: [2], 2: [1, 3], 3: [2] };
    const adapter = createAdapter(adjacency, 3);
    const game = new GameState();
    game.currentTurn = 'red';
    addRoot(game, 1, 'red');
    game.currentTurn = 'blue';
    addRoot(game, 3, 'blue');
    const bases = { red: 1, blue: 3 };

    const originalDistance = adapter.distanceToBase.bind(adapter);
    let distanceCalls = 0;
    adapter.distanceToBase = (...args) => {
        distanceCalls++;
        return originalDistance(...args);
    };

    const redScore = adapter.positionEvaluator.evaluateState(game, 'red', bases);
    const callsAfterFirstEvaluation = distanceCalls;
    assert.equal(adapter.positionEvaluator.evaluateState(game, 'red', bases), redScore);
    assert.equal(distanceCalls, callsAfterFirstEvaluation,
        're-evaluating the same immutable state and perspective must use the cache');

    const blueScore = adapter.positionEvaluator.evaluateState(game, 'blue', bases);
    assert.equal(redScore + blueScore, 0,
        'the shared fixed-weight evaluator must be symmetric between both sides');
});


test('unused roots are not counted as exposed root chains', () => {
    const adjacency = { 1: [2], 2: [1, 3], 3: [2, 4], 4: [3] };
    const adapter = createAdapter(adjacency, 4);
    const game = new GameState();
    game.currentTurn = 'red';
    addRoot(game, 1, 'red');
    game.currentTurn = 'blue';
    addRoot(game, 4, 'blue');

    const metrics = adapter.positionEvaluator.getStructuralMetrics(
        game, 'red', { red: 1, blue: 4 }
    );
    assert.equal(metrics.unsafeRoots, 0,
        'a root without a first branch has no exposed subtree');
    assert.equal(metrics.rootChainRisk, 0);
});

test('losing an exposed root cannot improve the position evaluation', () => {
    const adjacency = {
        1: [2], 2: [1, 3], 3: [2, 4], 4: [3],
        5: [6], 6: [5]
    };
    const adapter = createAdapter(adjacency, 6);
    const game = new GameState();
    game.currentTurn = 'red';
    const exposedRoot = addRoot(game, 1, 'red');
    game.addNode(exposedRoot.id, 20, 0, 2, 'red');
    addRoot(game, 5, 'red');
    game.currentTurn = 'blue';
    addRoot(game, 4, 'blue');

    const bases = { red: 1, blue: 4 };
    const before = adapter.positionEvaluator.evaluateState(game, 'red', bases);
    const afterRootLoss = game.clone();
    afterRootLoss.deleteNodes([exposedRoot.id]);
    const after = adapter.positionEvaluator.evaluateState(afterRootLoss, 'red', bases);

    assert.ok(after < before,
        'destroying a vulnerable root must remain a net loss after its exposure penalty disappears');
    assert.equal(
        adapter.positionEvaluator.evaluateState(afterRootLoss, 'red', bases) +
        adapter.positionEvaluator.evaluateState(afterRootLoss, 'blue', bases),
        0,
        'root survival scoring must remain zero-sum'
    );
});

test('move ordering penalizes exposing a previously unused root', () => {
    const adjacency = { 1: [2, 3], 2: [1, 3], 3: [1, 2, 4], 4: [3] };
    const adapter = createAdapter(adjacency, 4);
    const game = new GameState();
    game.currentTurn = 'red';
    const root = addRoot(game, 1, 'red');
    game.currentTurn = 'blue';
    addRoot(game, 4, 'blue');
    game.currentTurn = 'red';

    const move = {
        parentNodeId: root.id,
        targetAreaId: 2,
        x: 20,
        y: 0,
        attacks: false
    };
    const next = adapter.simulateMove(game, move, 'red', { red: 1, blue: 4 });
    assert.ok(next);
    const score = adapter.positionEvaluator.scoreMove(
        game, move, 'red', { red: 1, blue: 4 }, next
    );
    assert.ok(score < -2000,
        'static move ordering must account for the newly exposed first root branch');
});
