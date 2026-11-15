import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../js/game/GameState.js';
import { MapManager } from '../js/core/MapManager.js';
import { createTutorialScenario } from '../js/tutorial/TutorialScenarioFactory.js';
import { TutorialSession } from '../js/tutorial/TutorialSession.js';

function createScenario() {
    const mapManager = new MapManager(1800, 1200);
    const mapSeeds = [
        [300, 300], [900, 300], [1500, 300],
        [300, 900], [900, 900], [1500, 900]
    ];
    const mapAreas = mapManager.loadMapFromSeeds(mapSeeds);
    const game = new GameState();
    game.addNode(null, ...mapAreas[0].center, 1, 'red');
    game.addNode(null, ...mapAreas[5].center, 6, 'blue');
    return {
        id: 'test-growth-intro',
        mapSeeds,
        gameState: game.toJSON(),
        redBaseId: 1,
        blueBaseId: 6
    };
}

test('tutorial scenario factory rebuilds a deterministic, isolated map and state', () => {
    const scenario = createScenario();
    const first = createTutorialScenario(scenario);
    const second = createTutorialScenario(scenario);

    assert.deepEqual(first.mapSeeds, second.mapSeeds);
    assert.deepEqual(first.mapManager.adjacency, second.mapManager.adjacency);
    assert.deepEqual(first.game.toJSON(), second.game.toJSON());
    assert.notEqual(first.game, second.game);
    assert.notEqual(first.mapManager, second.mapManager);
    assert.equal(first.sessionType, 'tutorial');
});

test('tutorial scenario factory rejects node coordinates outside their declared area', () => {
    const scenario = createScenario();
    scenario.gameState.nodes[0].x = 1790;
    scenario.gameState.nodes[0].y = 1190;

    assert.throws(() => createTutorialScenario(scenario), /坐标与所属区域不一致/);
});

test('tutorial scenario factory rejects invalid or overlapping base references', () => {
    const scenario = createScenario();
    scenario.blueBaseId = scenario.redBaseId;

    assert.throws(() => createTutorialScenario(scenario), /基地引用无效/);
});

test('tutorial session uses the shared growth action and reset restores the scenario', () => {
    const session = new TutorialSession(createScenario());
    const runtime = session.runtime;
    const targetAreaId = runtime.mapManager.adjacency[1].find(id => id !== 6);
    assert.ok(targetAreaId);

    const result = session.performGrowth({
        parentNodeId: 1,
        targetAreaId,
        owner: 'red'
    });

    assert.equal(result.ok, true);
    assert.equal(session.actions.length, 1);
    assert.equal(session.runtime.game.getAliveNodes().length, 3);

    const resetRuntime = session.reset();
    assert.notEqual(resetRuntime, runtime);
    assert.equal(session.status, 'active');
    assert.equal(session.actions.length, 0);
    assert.equal(session.runtime.game.getAliveNodes().length, 2);
});

test('tutorial session rejects actions after exit', () => {
    const session = new TutorialSession(createScenario());
    session.exit();

    const result = session.performGrowth({
        parentNodeId: 1,
        targetAreaId: 2,
        owner: 'red'
    });

    assert.equal(session.status, 'ended');
    assert.equal(result.ok, false);
    assert.match(result.reason, /活动状态/);
    assert.equal(session.runtime, null);
});
