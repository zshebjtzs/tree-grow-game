import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../js/game/GameState.js';
import { RuleEngine } from '../js/game/RuleEngine.js';
import { MapManager } from '../js/core/MapManager.js';
import { executeGrowthAction } from '../js/game/GrowthActionService.js';

function createFixture() {
    const mapManager = new MapManager(1800, 1200);
    const mapAreas = mapManager.loadMapFromSeeds([
        [300, 300], [900, 300], [1500, 300],
        [300, 900], [900, 900], [1500, 900]
    ]);
    const game = new GameState();
    game.addNode(null, ...mapAreas[0].center, mapAreas[0].id, 'red');
    game.addNode(null, ...mapAreas[5].center, mapAreas[5].id, 'blue');
    const targetAreaId = mapManager.adjacency[1].find(id => id !== 6);
    assert.ok(targetAreaId);
    return {
        game,
        mapManager,
        mapAreas,
        ruleEngine: new RuleEngine(mapManager),
        targetAreaId,
        redRootId: 1
    };
}

function execute(fixture, overrides = {}) {
    return executeGrowthAction({
        gameState: fixture.game,
        ruleEngine: fixture.ruleEngine,
        mapAreas: fixture.mapAreas,
        parentNodeId: fixture.redRootId,
        targetAreaId: fixture.targetAreaId,
        owner: 'red',
        ownBaseId: 1,
        enemyBaseId: 6,
        ...overrides
    });
}

test('shared growth action validates and applies a legal player action', () => {
    const fixture = createFixture();
    const result = execute(fixture);

    assert.equal(result.ok, true);
    assert.equal(result.node.owner, 'red');
    assert.equal(result.node.areaId, fixture.targetAreaId);
    assert.deepEqual(result.action.path, [1, fixture.targetAreaId]);
    assert.equal(result.action.type, 'growth');
    assert.equal(fixture.game.getAliveNodes().length, 3);
});

test('shared growth action rejects wrong-turn actions without mutating state', () => {
    const fixture = createFixture();
    fixture.game.currentTurn = 'blue';
    const before = fixture.game.toJSON();

    const result = execute(fixture);

    assert.equal(result.ok, false);
    assert.match(result.reason, /回合/);
    assert.deepEqual(fixture.game.toJSON(), before);
});

test('shared growth action rejects invalid targets without mutating state', () => {
    const fixture = createFixture();
    const before = fixture.game.toJSON();

    const result = execute(fixture, { targetAreaId: 9999 });

    assert.equal(result.ok, false);
    assert.match(result.reason, /目标区域/);
    assert.deepEqual(fixture.game.toJSON(), before);
});

test('shared growth action delegates frozen-node validation to RuleEngine', () => {
    const fixture = createFixture();
    fixture.game.getNode(fixture.redRootId).isFrozen = true;
    const before = fixture.game.toJSON();

    const result = execute(fixture);

    assert.equal(result.ok, false);
    assert.match(result.reason, /冻结/);
    assert.deepEqual(fixture.game.toJSON(), before);
});

test('shared growth action rejects fortress attacks before creating an invading node', () => {
    const fixture = createFixture();
    const target = fixture.mapAreas.find(area => area.id === fixture.targetAreaId);
    const fortress = fixture.game.addNode(null, ...target.center, target.id, 'blue');
    fixture.game.currentTurn = 'blue';
    for (let i = 0; i < 4; i++) {
        fixture.game.addNode(fortress.id, target.center[0] + i + 1, target.center[1], target.id, 'blue');
    }
    fixture.game.currentTurn = 'red';
    const beforeCount = fixture.game.getAliveNodes().length;

    const result = execute(fixture);

    assert.equal(result.ok, false);
    assert.match(result.reason, /堡垒/);
    assert.equal(fixture.game.getAliveNodes().length, beforeCount);
});
