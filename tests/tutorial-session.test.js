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

test('tutorial session validates a base invasion through the shared rules and combat resolver', async () => {
    const { resolveCombat } = await import('../js/game/CombatResolver.js');
    const { buildScenario } = await import('../js/tutorial/TutorialController.js');
    const scenario = buildScenario('attack', 'base-invasion-lesson');
    const targetAreaId = scenario.blueBaseId;
    const session = new TutorialSession(scenario);
    const result = session.performGrowth({
        parentNodeId: 1,
        targetAreaId,
        owner: 'red'
    });

    assert.equal(result.ok, true);
    // Entering the enemy base is the direct-victory action, not an ordinary area attack.\n    assert.equal(result.action.isAttack, false);
    const defender = session.runtime.game.getAliveNodes().find(node =>
        node.owner === 'blue' && node.areaId === targetAreaId
    );
    const combat = resolveCombat(session.runtime.game, result.node, defender);
    session.runtime.game.deleteNodes(combat.nodesToDelete);
    assert.equal(session.runtime.game.getAliveNodes().some(node => node.owner === 'blue'), false);
    assert.equal(session.runtime.game.getAliveNodes().some(node => node.id === result.node.id), true);
});

test('visual structure lesson builds a valid branch, fortress, and frozen node fixture', async () => {
    const { buildScenario } = await import('../js/tutorial/TutorialController.js');
    const scenario = buildScenario('structures', 'structure-lesson');
    const runtime = createTutorialScenario(scenario);
    const redNodes = runtime.game.getAliveNodesByOwner('red');
    const branch = redNodes.find(node => node.childrenIds.length === 2);
    const fortress = redNodes.find(node => node.getDegree() > 3);
    const frozen = redNodes.find(node => node.isFrozen);

    assert.ok(branch, 'lesson should contain a non-fortress branching point');
    assert.ok(fortress, 'lesson should contain a fortress');
    assert.ok(frozen, 'lesson should contain a frozen node');
    assert.equal(branch.getDegree(), 3);
    assert.equal(fortress.getDegree(), 4);
});

test('combat lesson fixture demonstrates branch-backtracking freeze with production resolver', async () => {
    const { buildScenario } = await import('../js/tutorial/TutorialController.js');
    const { resolveCombat } = await import('../js/game/CombatResolver.js');
    const session = new TutorialSession(buildScenario('combat', 'combat-lesson'));
    const runtime = session.runtime;
    const targetAreaId = runtime.mapManager.adjacency[runtime.redBaseId].find(id =>
        runtime.game.getAliveNodes().some(node => node.owner === 'blue' && node.areaId === id)
    );
    assert.ok(targetAreaId, 'the blue defender should be adjacent to the red root');

    const result = session.performGrowth({
        parentNodeId: runtime.game.getPlayerRootNodes('red')[0].id,
        targetAreaId,
        owner: 'red'
    });
    assert.equal(result.ok, true);
    assert.equal(result.action.isAttack, true);

    const defender = runtime.game.getAliveNodes().find(node =>
        node.owner === 'blue' && node.areaId === targetAreaId
    );
    const combat = resolveCombat(runtime.game, result.node, defender);
    assert.ok(combat.freezeTargetId, 'the combat should identify the non-root branching ancestor');
    const frozenId = combat.freezeTargetId;
    runtime.game.deleteNodes(combat.nodesToDelete);
    runtime.game.getNode(frozenId).isFrozen = true;

    assert.equal(runtime.game.getNode(frozenId).isFrozen, true);
    assert.equal(runtime.game.getNode(frozenId).isRoot, false);
    assert.equal(runtime.game.getNode(frozenId).childrenIds.length, 1);
});

test('all non-combat tutorial lesson scenarios rebuild with the intended turn state', async () => {
    const { buildScenario } = await import('../js/tutorial/TutorialController.js');
    for (const mode of ['info', 'grow', 'turn', 'practice', 'finish']) {
        const runtime = createTutorialScenario(buildScenario(mode, 'lesson-' + mode));
        assert.equal(runtime.game.getPlayerRootNodes('red').length, 1, mode);
        assert.equal(runtime.game.getPlayerRootNodes('blue').length, 1, mode);
        assert.equal(runtime.game.currentTurn, mode === 'turn' ? 'blue' : 'red', mode);
    }
});
