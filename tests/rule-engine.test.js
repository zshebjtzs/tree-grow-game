import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../js/game/GameState.js';
import { RuleEngine } from '../js/game/RuleEngine.js';

function setup() {
    const adjacency = { 1: [2, 3], 2: [1, 3, 4], 3: [1, 2, 4], 4: [2, 3, 5], 5: [4] };
    const engine = new RuleEngine({ adjacency });
    const game = new GameState();
    game.currentTurn = 'red';
    const root = game.addNode(null, 0, 0, 1, 'red');
    game.addNode(null, 0, 0, 5, 'blue');
    return { game, engine, root };
}

test('ordinary growth only permits one adjacent area', () => {
    const { game, engine, root } = setup();
    assert.equal(engine.canGrow(game, root, 2).allowed, true);
    assert.equal(engine.canGrow(game, root, 4).allowed, false);
});

test('fortress-occupied enemy area is rejected without consuming the turn', () => {
    const adjacency = {
        1: [2], 2: [1, 3, 4, 5, 6],
        3: [2], 4: [2], 5: [2], 6: [2]
    };
    const engine = new RuleEngine({ adjacency });
    const game = new GameState();
    game.currentTurn = 'red';
    const redRoot = game.addNode(null, 0, 0, 1, 'red');
    game.currentTurn = 'blue';
    const blueRoot = game.addNode(null, 0, 0, 6, 'blue');
    const fortress = game.addNode(blueRoot.id, 0, 0, 2, 'blue');
    game.addNode(fortress.id, 0, 0, 3, 'blue');
    game.addNode(fortress.id, 0, 0, 4, 'blue');
    game.addNode(fortress.id, 0, 0, 5, 'blue');
    game.currentTurn = 'red';

    const nodeCount = game.getAliveNodes().length;
    const result = engine.canGrow(game, redRoot, 2, {
        ownBaseId: 1, enemyBaseId: 6
    });

    assert.equal(result.allowed, false);
    assert.equal(result.reason, '堡垒节点不能作为攻击目标');
    assert.deepEqual(engine.getLegalGrowthAreas(game, redRoot, [2], {
        ownBaseId: 1, enemyBaseId: 6
    }), []);
    assert.equal(game.currentTurn, 'red');
    assert.equal(game.getAliveNodes().length, nodeCount);
});

test('non-fortress enemy node remains a legal attack target', () => {
    const adjacency = { 1: [2], 2: [1, 3], 3: [2] };
    const engine = new RuleEngine({ adjacency });
    const game = new GameState();
    game.currentTurn = 'red';
    const redRoot = game.addNode(null, 0, 0, 1, 'red');
    game.currentTurn = 'blue';
    const blueRoot = game.addNode(null, 0, 0, 3, 'blue');
    game.addNode(blueRoot.id, 0, 0, 2, 'blue');
    game.currentTurn = 'red';

    assert.equal(engine.canGrow(game, redRoot, 2, {
        ownBaseId: 1, enemyBaseId: 3
    }).allowed, true);
});

test('root first branch may use a path of at most two edges', () => {
    const { game, engine, root } = setup();
    assert.equal(engine.canGrow(game, root, 3).allowed, true);
    assert.equal(engine.canGrow(game, root, 4).allowed, false);
    assert.equal(engine.canGrow(game, root, 5).allowed, false);
});

test('occupied intermediate area blocks root privilege', () => {
    const { game, engine, root } = setup();
    game.addNode(null, 0, 0, 2, 'blue');
    assert.equal(engine.canGrow(game, root, 4).allowed, false);
});

test('frozen and enemy-owned parents are rejected', () => {
    const { game, engine, root } = setup();
    root.isFrozen = true;
    assert.equal(engine.canGrow(game, root, 2).allowed, false);
    root.isFrozen = false;
    root.owner = 'blue';
    assert.equal(engine.canGrow(game, root, 2).allowed, false);
});

test('root first branch can use an alternate short route when the shortest route is occupied', () => {
    const alternateEngine = new RuleEngine({
        adjacency: { 1: [2, 3], 2: [1, 4], 3: [1, 4], 4: [2, 3], 5: [] }
    });
    const game = new GameState();
    const root = game.addNode(null, 0, 0, 1, 'red');
    game.addNode(null, 0, 0, 5, 'red'); // Enables the two-edge first-branch privilege.
    game.addNode(null, 0, 0, 2, 'blue'); // Blocks one route, not every route.
    const result = alternateEngine.canGrow(game, root, 4);
    assert.equal(result.allowed, true);
    assert.deepEqual(result.path, [1, 3, 4]);
});


test('growth accepts a valid neighbor even when the target has no adjacency entry', () => {
    const engine = new RuleEngine({ adjacency: { 1: [2] } });
    const game = new GameState();
    const root = game.addNode(null, 0, 0, 1, 'red');
    const result = engine.canGrow(game, root, 2);
    assert.equal(result.allowed, true);
    assert.deepEqual(result.path, [1, 2]);
});


test('legal growth preview returns exactly the areas accepted by canGrow', () => {
    const { game, engine, root } = setup();
    const areaIds = [1, 2, 3, 4, 5];
    assert.deepEqual(
        engine.getLegalGrowthAreas(game, root, areaIds),
        [2, 3]
    );
});

test('legal growth preview respects occupied intermediate areas and alternate routes', () => {
    const engine = new RuleEngine({
        adjacency: { 1: [2, 3], 2: [1, 4], 3: [1, 4], 4: [2, 3], 5: [] }
    });
    const game = new GameState();
    const root = game.addNode(null, 0, 0, 1, 'red');
    game.addNode(null, 0, 0, 5, 'red'); // Enables the two-edge root privilege.
    game.addNode(null, 0, 0, 2, 'blue'); // Blocks only one route to area 4.
    assert.deepEqual(engine.getLegalGrowthAreas(game, root, [2, 3, 4]), [2, 3, 4]);
    assert.deepEqual(engine.canGrow(game, root, 4).path, [1, 3, 4]);
});

test('legal growth preview rejects invalid parent states and invalid area lists', () => {
    const { game, engine, root } = setup();
    root.isFrozen = true;
    assert.deepEqual(engine.getLegalGrowthAreas(game, root, [2, 3]), []);
    assert.throws(() => engine.getLegalGrowthAreas(game, root, null), TypeError);
});
