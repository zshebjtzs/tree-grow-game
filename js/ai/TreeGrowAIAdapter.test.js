import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../game/GameState.js';
import { resolveCombat } from '../game/CombatResolver.js';
import { TreeGrowAIAdapter } from './TreeGrowAIAdapter.js';
import { getDifficultyProfile } from './DifficultyProfiles.js';

function createAdapter() {
    const adjacency = {
        1: [2], 2: [1, 3], 3: [2, 4], 4: [3, 5],
        5: [4, 6], 6: [5], 7: [8], 8: [7], 9: [10], 10: [9]
    };
    return new TreeGrowAIAdapter({
        adjacency,
        areaCenters: Array.from({ length: 10 }, (_, index) => [index * 10, 0]),
        profile: getDifficultyProfile('medium')
    });
}

function addNode(game, parentId, areaId, owner) {
    return game.addNode(parentId, areaId * 10, 0, areaId, owner);
}

test('AI simulation matches authoritative combat cascade that destroys an entire root chain', () => {
    const adapter = createAdapter();
    const game = new GameState();
    game.currentTurn = 'red';
    const root = addNode(game, null, 1, 'red');
    const first = addNode(game, root.id, 2, 'red');
    const second = addNode(game, first.id, 3, 'red');
    const leaf = addNode(game, second.id, 4, 'red');
    game.currentTurn = 'blue';
    const blueRoot = addNode(game, null, 6, 'blue');
    const attacker = addNode(game, blueRoot.id, 5, 'blue');

    const move = { parentNodeId: attacker.id, targetAreaId: 4, x: 40, y: 0 };
    const simulated = adapter.simulateMove(game, move, 'blue', { red: 1, blue: 6 }, {
        alreadyValidated: true
    });

    const authoritative = game.clone();
    authoritative.currentTurn = 'blue';
    const attackNode = authoritative.addNode(attacker.id, 40, 0, 4, 'blue');
    const defender = authoritative.getNode(leaf.id);
    const combat = resolveCombat(authoritative, attackNode, defender);
    authoritative.deleteNodes(combat.nodesToDelete);
    if (combat.freezeTargetId) authoritative.getNode(combat.freezeTargetId).isFrozen = true;
    authoritative.isGameOver = !authoritative.getPlayerRootNodes('red').length;
    if (!authoritative.isGameOver) {
        for (const node of authoritative.getAliveNodesByOwner('blue')) node.isFrozen = false;
        authoritative.switchTurn();
    }

    assert.deepEqual(simulated.toJSON(), authoritative.toJSON());
    assert.equal(simulated.isGameOver, true);
    assert.equal(simulated.getPlayerRootNodes('red').length, 0);
    assert.equal(simulated.getAliveNodesByOwner('red').length, 0);
});

test('AI simulation preserves a sibling branch and freezes the actual combat stop node', () => {
    const adapter = createAdapter();
    const game = new GameState();
    game.currentTurn = 'red';
    const root = addNode(game, null, 1, 'red');
    const fork = addNode(game, root.id, 2, 'red');
    const attackedLeaf = addNode(game, fork.id, 3, 'red');
    const sibling = addNode(game, fork.id, 4, 'red');
    game.currentTurn = 'blue';
    const blueRoot = addNode(game, null, 6, 'blue');
    const attacker = addNode(game, blueRoot.id, 5, 'blue');

    const simulated = adapter.simulateMove(game, {
        parentNodeId: attacker.id, targetAreaId: 3, x: 30, y: 0
    }, 'blue', { red: 1, blue: 6 }, { alreadyValidated: true });

    const authoritative = game.clone();
    authoritative.currentTurn = 'blue';
    const attackNode = authoritative.addNode(attacker.id, 30, 0, 3, 'blue');
    const combat = resolveCombat(authoritative, attackNode, authoritative.getNode(attackedLeaf.id));
    authoritative.deleteNodes(combat.nodesToDelete);
    if (combat.freezeTargetId) authoritative.getNode(combat.freezeTargetId).isFrozen = true;
    authoritative.isGameOver = !authoritative.getPlayerRootNodes('red').length;
    if (!authoritative.isGameOver) {
        for (const node of authoritative.getAliveNodesByOwner('blue')) node.isFrozen = false;
        authoritative.switchTurn();
    }

    assert.deepEqual(simulated.toJSON(), authoritative.toJSON());
    assert.ok(simulated.getNode(root.id));
    assert.ok(simulated.getNode(fork.id));
    assert.ok(simulated.getNode(sibling.id));
    assert.equal(simulated.getNode(fork.id).isFrozen, true);
    assert.equal(simulated.getNode(attackedLeaf.id), undefined);
    assert.equal(simulated.currentTurn, 'red');
});


test('forced material-gain analysis proves a real frozen-branch cascade using authoritative rules', () => {
    const adjacency = {
        1: [2], 2: [1, 5], 5: [2, 8],
        6: [7], 7: [6, 8, 11], 8: [5, 7, 9, 10],
        9: [8], 10: [8], 11: [7], 12: []
    };
    const adapter = new TreeGrowAIAdapter({
        adjacency,
        areaCenters: Array.from({ length: 10 }, (_, index) => [index * 10, 0]),
        profile: getDifficultyProfile('medium')
    });
    const game = new GameState();
    game.currentTurn = 'blue';
    const blueRoot = addNode(game, null, 1, 'blue');
    const blueBranch = addNode(game, blueRoot.id, 2, 'blue');

    game.currentTurn = 'red';
    const redRoot = addNode(game, null, 6, 'red');
    const redTrunk = addNode(game, redRoot.id, 7, 'red');
    const redBranch = addNode(game, redTrunk.id, 8, 'red');
    addNode(game, redBranch.id, 9, 'red');
    addNode(game, redBranch.id, 10, 'red');
    addNode(game, redTrunk.id, 11, 'red');
    // This branch is frozen by an earlier combat interaction. Its descendants
    // have no other legal growth targets, so the opponent's only response is pass.
    redBranch.isFrozen = true;
    game.currentTurn = 'blue';

    const bases = { blue: 1, red: 12 };
    const candidate = adapter.generateMoves(game, 'blue', bases)
        .find(move => move.targetAreaId === 5);
    assert.ok(candidate, 'the blue branch must be able to grow into area 5');
    candidate._nextState = adapter.simulateMove(
        game, candidate, 'blue', bases, { alreadyValidated: true }
    );

    const result = adapter.tacticalAnalyzer.findForcedMaterialGainInTwoMoves(
        game,
        [candidate],
        'blue',
        bases,
        (state, move, side, matchBases) => adapter.simulateMove(
            state, move, side, matchBases, { alreadyValidated: true }
        ),
        (state, side, matchBases) => adapter.generateMoves(state, side, matchBases),
        (state, side) => adapter.simulatePass(state, side)
    );

    assert.deepEqual(result.moves, [candidate]);
    assert.equal(result.complete, true);
    assert.equal(result.guaranteedRootLoss, 0);
    assert.equal(result.guaranteedCascadeLoss, 2);
    assert.equal(result.guaranteedNodeLoss, 3);

    const afterPass = adapter.simulatePass(candidate._nextState, 'red');
    const attack = adapter.generateMoves(afterPass, 'blue', bases)
        .find(move => move.targetAreaId === 8);
    assert.ok(attack, 'the blue branch must be able to attack the frozen branch after the pass');
    const afterAttack = adapter.simulateMove(
        afterPass, attack, 'blue', bases, { alreadyValidated: true }
    );
    assert.equal(afterAttack.getPlayerRootNodes('red').length, 1);
    assert.equal(afterAttack.getAliveNodesByOwner('red').length, 3);
    assert.ok(afterAttack.getAliveNodesByOwner('red').some(node => node.areaId === 11),
        'the sibling branch must survive the cascade');
});


test('three-action tactical sequence uses authoritative pass and combat transitions end to end', () => {
    const adjacency = {
        1: [2], 2: [1, 4], 4: [2, 5], 5: [4, 8],
        6: [7], 7: [6, 8, 11], 8: [5, 7, 9, 10],
        9: [8], 10: [8], 11: [7], 12: []
    };
    const adapter = new TreeGrowAIAdapter({
        adjacency,
        areaCenters: Array.from({ length: 12 }, (_, index) => [index * 10, 0]),
        profile: getDifficultyProfile('medium')
    });
    const game = new GameState();
    game.currentTurn = 'blue';
    const blueRoot = addNode(game, null, 1, 'blue');
    const blueBranch = addNode(game, blueRoot.id, 2, 'blue');

    game.currentTurn = 'red';
    const redRoot = addNode(game, null, 6, 'red');
    const redTrunk = addNode(game, redRoot.id, 7, 'red');
    const redBranch = addNode(game, redTrunk.id, 8, 'red');
    addNode(game, redBranch.id, 9, 'red');
    addNode(game, redBranch.id, 10, 'red');
    addNode(game, redTrunk.id, 11, 'red');
    for (const node of game.getAliveNodesByOwner('red')) node.isFrozen = true;
    game.currentTurn = 'blue';

    const bases = { blue: 1, red: 12 };
    const candidate = adapter.generateMoves(game, 'blue', bases)
        .find(move => move.targetAreaId === 4);
    assert.ok(candidate, 'the first blue move must reach area 4');
    candidate._nextState = adapter.simulateMove(
        game, candidate, 'blue', bases, { alreadyValidated: true }
    );

    const result = adapter.tacticalAnalyzer.findForcedTacticalSequenceInThreeMoves(
        game,
        [candidate],
        'blue',
        bases,
        (state, move, side, matchBases) => adapter.simulateMove(
            state, move, side, matchBases, { alreadyValidated: true }
        ),
        (state, side, matchBases) => adapter.generateMoves(state, side, matchBases),
        (state, side) => adapter.simulatePass(state, side)
    );

    assert.deepEqual(result.moves, [candidate]);
    assert.equal(result.complete, true);
    assert.equal(result.sequence.length, 3);
    assert.equal(result.sequence[1].targetAreaId, 5);
    assert.equal(result.sequence[2].targetAreaId, 8);
    assert.equal(result.guaranteedRootLoss, 0);
    assert.equal(result.guaranteedCascadeLoss, 2);
    assert.equal(result.guaranteedNodeGain, 3);
    assert.equal(result.guaranteedSelfLoss, 0);
});
