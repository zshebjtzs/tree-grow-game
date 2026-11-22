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
