import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../game/GameState.js';
import { TreeGrowAIAdapter } from './TreeGrowAIAdapter.js';
import { getDifficultyProfile } from './DifficultyProfiles.js';
import { StrategicPhaseDetector } from './StrategicPhaseDetector.js';

function createAdapter(adjacency, areaCount = 12) {
    return new TreeGrowAIAdapter({
        adjacency,
        areaCenters: Array.from({ length: areaCount }, (_, index) => [index * 10, 0]),
        profile: getDifficultyProfile('medium')
    });
}

function addNode(game, parentId, areaId, side) {
    return game.addNode(parentId, areaId * 10, 0, areaId, side);
}

test('strategic analysis is deterministic for an unchanged position', () => {
    const adapter = createAdapter({
        1: [2, 3], 2: [1, 4], 3: [1, 5], 4: [2, 6], 5: [3, 7],
        6: [4], 7: [5], 10: [11], 11: [10, 12], 12: [11]
    });
    const game = new GameState();
    game.currentTurn = 'red';
    const rootA = addNode(game, null, 1, 'red');
    const branchA = addNode(game, rootA.id, 2, 'red');
    addNode(game, branchA.id, 4, 'red');
    const rootB = addNode(game, null, 3, 'red');
    addNode(game, rootB.id, 5, 'red');
    game.currentTurn = 'blue';
    const blueRoot = addNode(game, null, 10, 'blue');
    addNode(game, blueRoot.id, 11, 'blue');
    const bases = { red: 1, blue: 12 };

    const first = adapter.positionEvaluator.getStrategicAnalysis(game, 'red', bases);
    const second = adapter.positionEvaluator.getStrategicAnalysis(game, 'red', bases);
    assert.deepEqual(first, second);
    assert.ok(first.position.multiRootCoordination > 0);
    assert.ok(first.phase.multiRoot > 0);
});

test('overlapping strategic signals preserve expansion and defensive pressure together', () => {
    const adapter = createAdapter({
        1: [2], 2: [1, 3, 4], 3: [2, 5], 4: [2, 6],
        5: [3], 6: [4], 10: [11], 11: [10, 12], 12: [11]
    });
    const game = new GameState();
    game.currentTurn = 'red';
    const root = addNode(game, null, 1, 'red');
    const trunk = addNode(game, root.id, 2, 'red');
    addNode(game, trunk.id, 3, 'red');
    game.currentTurn = 'blue';
    const enemyRoot = addNode(game, null, 10, 'blue');
    addNode(game, enemyRoot.id, 11, 'blue');
    const bases = { red: 1, blue: 12 };

    const result = adapter.positionEvaluator.getStrategicAnalysis(game, 'red', bases);
    assert.ok(result.phase.expansion > 0);
    assert.ok(result.phase.defense >= 0);
    assert.ok(Array.isArray(result.phase.dominant));
    assert.ok(result.weights.safetyWeight >= getDifficultyProfile('medium').safetyWeight);
});

test('dynamic weights respond to position signals without changing the profile', () => {
    const adapter = createAdapter({
        1: [2], 2: [1, 3, 4], 3: [2], 4: [2],
        10: [11], 11: [10, 12], 12: [11]
    });
    const game = new GameState();
    game.currentTurn = 'red';
    const root = addNode(game, null, 1, 'red');
    const branch = addNode(game, root.id, 2, 'red');
    addNode(game, branch.id, 3, 'red');
    game.currentTurn = 'blue';
    const enemyRoot = addNode(game, null, 10, 'blue');
    addNode(game, enemyRoot.id, 11, 'blue');
    const bases = { red: 1, blue: 12 };
    const profile = getDifficultyProfile('medium');
    const before = { ...profile };

    const analysis = adapter.positionEvaluator.getStrategicAnalysis(game, 'red', bases);
    assert.ok(analysis.weights.progressWeight >= profile.progressWeight);
    assert.ok(analysis.weights.safetyWeight >= profile.safetyWeight);
    assert.deepEqual({ ...profile }, before, 'dynamic evaluation must not mutate shared profiles');
});

test('multi-root coordination rewards independent active root frontiers', () => {
    const adapter = createAdapter({
        1: [2, 3], 2: [1, 4], 3: [1, 5], 4: [2], 5: [3, 6], 6: [5],
        10: [11], 11: [10, 12], 12: [11]
    });
    const game = new GameState();
    game.currentTurn = 'red';
    const firstRoot = addNode(game, null, 1, 'red');
    addNode(game, firstRoot.id, 2, 'red');
    const secondRoot = addNode(game, null, 3, 'red');
    addNode(game, secondRoot.id, 5, 'red');
    game.currentTurn = 'blue';
    addNode(game, null, 10, 'blue');
    const bases = { red: 1, blue: 12 };

    const analysis = adapter.positionEvaluator.getStrategicAnalysis(game, 'red', bases);
    assert.equal(analysis.position.activeRoots, 2);
    assert.ok(analysis.position.multiRootCoordination > 0);
    assert.ok(analysis.spatialScore >= 0);
});


test('phase detector exposes root safety and distinct attack-defense transitions', () => {
    const detector = new StrategicPhaseDetector();
    const defensive = detector.detect({
        expansionPotential: 0.4,
        defensivePressure: 0.8,
        rootSafety: 0.2,
        siegePressure: 0.3,
        multiRootCoordination: 0.5,
        tacticalPressure: 0.1,
        frontierControl: 0.2
    });
    assert.equal(defensive.rootSafety, 0.2);
    assert.ok(defensive.defenseTransition > defensive.attackTransition);

    const attacking = detector.detect({
        expansionPotential: 0.5,
        defensivePressure: 0.1,
        rootSafety: 0.9,
        siegePressure: 0.8,
        multiRootCoordination: 0.4,
        tacticalPressure: 0.95,
        frontierControl: 0.7
    });
    assert.ok(attacking.attackTransition > attacking.defenseTransition);
});
