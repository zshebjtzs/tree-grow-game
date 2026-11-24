import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../game/GameState.js';
import { TreeGrowAIAdapter } from './TreeGrowAIAdapter.js';
import { PositionEvaluator } from './PositionEvaluator.js';
import { DisadvantageRiskAnalyzer } from './DisadvantageRiskAnalyzer.js';
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

test('unsafe root and single-chain metrics follow the authoritative combat ancestor rule', () => {
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
    assert.equal(forkedMetrics.rootChainRisk, 1);
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


test('exchange scoring subtracts own destroyed nodes instead of rewarding gross enemy losses', () => {
    const evaluator = Object.create(PositionEvaluator.prototype);
    evaluator.disadvantageRiskAnalyzer = new DisadvantageRiskAnalyzer();
    evaluator.profile = { advantageConversionWeight: 0.3 };
    evaluator.distanceToBase = (_state, side) => side === 'red' ? 2 : Infinity;
    evaluator.getStrategicAnalysis = () => ({
        weights: {
            progressWeight: 1, attackWeight: 1, rootAttackWeight: 1,
            expansionWeight: 1, safetyWeight: 1, branchingWeight: 1,
            structureWeight: 1
        },
        spatialScore: 0
    });
    evaluator.getAdvantageConversionFactor = () => 0;
    evaluator.getDisadvantageRiskFactor = () => 0;
    const before = {
        getAliveNodesByOwner: side => side === 'red'
            ? [{ id: 1 }, { id: 5 }]
            : [{ id: 2 }, { id: 3 }],
        getPlayerRootNodes: side => side === 'red' ? [{ id: 1 }] : [{ id: 2 }]
    };
    const after = {
        getAliveNodesByOwner: side => side === 'red'
            ? [{ id: 1 }, { id: 4 }]
            : [{ id: 2 }],
        getPlayerRootNodes: side => side === 'red' ? [{ id: 1 }] : [{ id: 2 }],
        getAliveNodes: () => [],
        getNode: () => null
    };
    const score = evaluator.scoreMove(
        before, { attacks: true, targetAreaId: 3 }, 'red',
        { red: 1, blue: 6 }, after
    );

    assert.equal(score, 0,
        'one enemy node lost and one own node lost must produce zero net exchange reward');
});

test('advantage conversion is gated by a positive position advantage', () => {
    const evaluator = Object.create(PositionEvaluator.prototype);
    evaluator.disadvantageRiskAnalyzer = new DisadvantageRiskAnalyzer();
    evaluator.profile = {
        advantageConversionThreshold: 250,
        advantageConversionScale: 1500
    };
    evaluator.evaluateState = () => 250;
    assert.equal(evaluator.getAdvantageConversionFactor({}, 'red', { red: 1, blue: 6 }), 0);

    evaluator.evaluateState = () => 1000;
    assert.equal(evaluator.getAdvantageConversionFactor({}, 'red', { red: 1, blue: 6 }), 0.5);

    evaluator.evaluateState = () => 5000;
    assert.equal(evaluator.getAdvantageConversionFactor({}, 'red', { red: 1, blue: 6 }), 1);
});

test('advantage conversion increases ordering value only when the position is favorable', () => {
    const createEvaluator = factor => {
        const evaluator = Object.create(PositionEvaluator.prototype);
    evaluator.disadvantageRiskAnalyzer = new DisadvantageRiskAnalyzer();
        evaluator.profile = { advantageConversionWeight: 0.3 };
        evaluator.distanceToBase = (state, side) => state.isBefore
            ? (side === 'red' ? 4 : Infinity)
            : (side === 'red' ? 3 : Infinity);
        evaluator.getStrategicAnalysis = () => ({
            weights: {
                progressWeight: 1, attackWeight: 1, rootAttackWeight: 1,
                expansionWeight: 1, safetyWeight: 1, branchingWeight: 1,
                structureWeight: 1
            },
            spatialScore: 0
        });
        evaluator.getAdvantageConversionFactor = () => factor;
        evaluator.getDisadvantageRiskFactor = () => 0;
        return evaluator;
    };
    const before = {
        isBefore: true,
        getAliveNodesByOwner: side => side === 'red' ? [{ id: 1 }] : [{ id: 2 }]
    };
    const after = {
        isBefore: false,
        getAliveNodesByOwner: side => side === 'red' ? [{ id: 1 }, { id: 3 }] : [{ id: 2 }],
        getAliveNodes: () => [],
        getNode: () => null
    };
    const move = { attacks: false, targetAreaId: 3 };
    const bases = { red: 1, blue: 6 };
    const neutralScore = createEvaluator(0).scoreMove(before, move, 'red', bases, after);
    const favorableScore = createEvaluator(1).scoreMove(before, move, 'red', bases, after);

    assert.ok(favorableScore > neutralScore,
        'a favorable position should value concrete progress toward converting the advantage');
});


test('disadvantage risk adds bounded initiative value to concrete forward progress', () => {
    const createEvaluator = riskFactor => {
        const evaluator = Object.create(PositionEvaluator.prototype);
    evaluator.disadvantageRiskAnalyzer = new DisadvantageRiskAnalyzer();
        evaluator.profile = { advantageConversionWeight: 0.3, disadvantageProgressWeight: 80 };
        evaluator.distanceToBase = (state, side) => state.before
            ? (side === 'red' ? 4 : Infinity)
            : (side === 'red' ? 3 : Infinity);
        evaluator.getStrategicAnalysis = () => ({
            weights: {
                progressWeight: 1, attackWeight: 1, rootAttackWeight: 1,
                expansionWeight: 1, safetyWeight: 1, branchingWeight: 1,
                structureWeight: 1
            },
            spatialScore: 0
        });
        evaluator.getAdvantageConversionFactor = () => 0;
        evaluator.getDisadvantageRiskFactor = () => riskFactor;
        return evaluator;
    };
    const before = {
        before: true,
        getAliveNodesByOwner: side => side === 'red' ? [{ id: 1 }] : [{ id: 2 }]
    };
    const after = {
        before: false,
        getAliveNodesByOwner: side => side === 'red' ? [{ id: 1 }, { id: 3 }] : [{ id: 2 }],
        getAliveNodes: () => []
    };
    const move = { attacks: false, targetAreaId: 3 };
    const bases = { red: 1, blue: 6 };
    const neutral = createEvaluator(0).scoreMove(before, move, 'red', bases, after);
    const comeback = createEvaluator(1).scoreMove(before, move, 'red', bases, after);

    assert.equal(comeback - neutral, 80,
        'risk preference should add only its configured bounded value to concrete progress');
});


test('minimax evaluation recognizes comeback initiative only when the side is behind', () => {
    const createEvaluator = (tacticalPressure, redDistance = Infinity, blueDistance = 1) => {
        const evaluator = Object.create(PositionEvaluator.prototype);
        evaluator.profile = {
            disadvantageRiskThreshold: 250,
            disadvantageRiskScale: 1500,
            disadvantageTacticalPotentialWeight: 320,
            disadvantageSiegePotentialWeight: 180,
            disadvantageFrontierPotentialWeight: 90
        };
        evaluator.evaluationCache = new WeakMap();
        evaluator.disadvantageRiskAnalyzer = new DisadvantageRiskAnalyzer();
        evaluator.distanceToBase = (_game, side) => side === 'red' ? redDistance : blueDistance;
        evaluator.getStructuralMetrics = () => ({
            unsafeRoots: 0,
            rootChainRisk: 0,
            growthHeadroom: 0,
            baseThreatCount: 0,
            siegePreFortressCount: 0,
            siegeFortressCount: 0,
            softDistanceToBase: Infinity
        });
        const weights = {
            softDistanceWeight: 0,
            rootSafetyWeight: 0,
            rootChainRiskWeight: 0,
            growthHeadroomWeight: 0,
            baseThreatWeight: 0,
            siegePreparationWeight: 0,
            siegeFortressWeight: 0,
            structureWeight: 0
        };
        evaluator.getStrategicAnalysis = (_game, side) => ({
            weights,
            spatialScore: 0,
            position: {
                tacticalPressure: side === 'red' ? tacticalPressure : 0,
                siegePressure: 0,
                frontierControl: 0
            }
        });
        evaluator._structureValue = () => 0;
        return evaluator;
    };
    const game = {
        currentTurn: 'red',
        isGameOver: false,
        getPlayerRootNodes: side => [{ id: side }],
        getAliveNodesByOwner: side => [{ id: side }]
    };
    const bases = { red: 1, blue: 2 };
    const quietBehind = createEvaluator(0).evaluateState(game, 'red', bases);
    const initiativeBehind = createEvaluator(1).evaluateState(game, 'red', bases);
    assert.ok(initiativeBehind > quietBehind,
        'tactical initiative must affect the minimax state value, not just move ordering');

    const quietAhead = createEvaluator(0, 1, Infinity).evaluateState(game, 'red', bases);
    const initiativeAhead = createEvaluator(1, 1, Infinity).evaluateState(game, 'red', bases);
    assert.equal(initiativeAhead, quietAhead,
        'the comeback bonus must remain inactive when the evaluated side is ahead');
});


test('root safety and root-chain penalties use each side own strategic weights', () => {
    const evaluator = Object.create(PositionEvaluator.prototype);
    evaluator.evaluationCache = new WeakMap();
    evaluator.profile = {
        disadvantageRiskThreshold: 250,
        disadvantageRiskScale: 1500,
        disadvantageTacticalPotentialWeight: 0,
        disadvantageSiegePotentialWeight: 0
    };
    evaluator.disadvantageRiskAnalyzer = new DisadvantageRiskAnalyzer();
    evaluator.distanceToBase = () => Infinity;
    evaluator.getStructuralMetrics = (_game, side) => side === 'red'
        ? {
            unsafeRoots: 1, rootChainRisk: 3, growthHeadroom: 0,
            baseThreatCount: 0, siegePreFortressCount: 0,
            siegeFortressCount: 0, softDistanceToBase: Infinity
        }
        : {
            unsafeRoots: 1, rootChainRisk: 2, growthHeadroom: 0,
            baseThreatCount: 0, siegePreFortressCount: 0,
            siegeFortressCount: 0, softDistanceToBase: Infinity
        };
    evaluator.getStrategicAnalysis = (_game, side) => ({
        weights: {
            softDistanceWeight: 0,
            rootSafetyWeight: side === 'red' ? 10 : 100,
            rootChainRiskWeight: side === 'red' ? 5 : 50,
            growthHeadroomWeight: 0,
            baseThreatWeight: 0,
            siegePreparationWeight: 0,
            siegeFortressWeight: 0,
            structureWeight: 0
        },
        position: { tacticalPressure: 0, siegePressure: 0 },
        spatialScore: 0
    });
    evaluator._structureValue = () => 0;

    const game = {
        isGameOver: false,
        getPlayerRootNodes: () => [{ id: 1 }],
        getAliveNodesByOwner: () => [{ id: 1 }]
    };

    // Enemy exposure is positive at enemy-side weights (100 + 2*50);
    // own exposure is negative at own-side weights (10 + 3*5).
    assert.equal(
        evaluator.evaluateState(game, 'red', { red: 1, blue: 50 }),
        175
    );
});
