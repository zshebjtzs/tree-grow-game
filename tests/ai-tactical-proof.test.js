import test from 'node:test';
import assert from 'node:assert/strict';
import { TacticalAnalyzer } from '../js/ai/TacticalAnalyzer.js';
import { SearchEngine } from '../js/ai/SearchEngine.js';

function createState(key, redIds, blueIds) {
    const nodes = [
        ...redIds.map((id, index) => ({
            id, owner: 'red', areaId: index + 1, isRoot: index === 0
        })),
        ...blueIds.map((id, index) => ({
            id, owner: 'blue', areaId: index + 11, isRoot: index === 0
        }))
    ];
    return {
        key,
        nodes,
        isGameOver: false,
        currentTurn: 'red',
        getAliveNodes() { return nodes; },
        getAliveNodesByOwner(side) { return nodes.filter(node => node.owner === side); },
        getPlayerRootNodes(side) {
            return nodes.filter(node => node.owner === side && node.isRoot);
        }
    };
}

const red = ['r0', 'r1', 'r2', 'r3'];
const blue = ['b0', 'b1', 'b2', 'b3', 'b4'];
const bases = { red: 1, blue: 50 };
const pass = state => state;
const simulate = (_state, move) => move.nextState;
const nodeIds = state => ({
    red: state.getAliveNodesByOwner('red').map(node => node.id),
    blue: state.getAliveNodesByOwner('blue').map(node => node.id)
});

test('two-ply material proof reports the defender worst-case branch', () => {
    const analyzer = new TacticalAnalyzer();
    const root = createState('root', red.slice(0, 2), blue);
    const afterCandidate = createState('candidate', red.slice(0, 2), blue);
    const afterReplyA = createState('reply-a', red.slice(0, 2), blue);
    const afterReplyB = createState('reply-b', red.slice(0, 2), blue);
    const afterAttackA = createState('attack-a', red.slice(0, 2), ['b0']);
    const afterAttackB = createState('attack-b', red.slice(0, 2), ['b0', 'b4']);

    const candidate = { id: 'candidate', nextState: afterCandidate };
    const replyA = { id: 'reply-a', nextState: afterReplyA };
    const replyB = { id: 'reply-b', nextState: afterReplyB };
    const attackA = { attacks: true, targetAreaId: 12, nextState: afterAttackA };
    const attackB = { attacks: true, targetAreaId: 12, nextState: afterAttackB };
    const moveMap = new Map([
        [afterCandidate, [replyA, replyB]],
        [afterReplyA, [attackA]],
        [afterReplyB, [attackB]]
    ]);

    const result = analyzer.findForcedMaterialGainInTwoMoves(
        root, [candidate], 'red', bases, simulate,
        state => moveMap.get(state) || [], pass,
        { maxNodes: 100 }
    );

    assert.equal(result.complete, true);
    assert.deepEqual(result.moves, [candidate]);
    assert.equal(result.guaranteedNodeLoss, 3);
    assert.equal(result.guaranteedCascadeLoss, 2);
    assert.equal(result.guaranteedNetNodeGain, 3);
});

test('two-ply material proof charges losses from the candidate and opponent reply', () => {
    const analyzer = new TacticalAnalyzer();
    const root = createState('root', ['r0', 'r1', 'r2', 'r3'], blue);
    const afterCandidate = createState('candidate', ['r0', 'r3'], blue);
    const afterReply = createState('reply', ['r0'], blue);
    const afterAttack = createState('attack', ['r0'], ['b0', 'b4']);
    const candidate = { nextState: afterCandidate };
    const reply = { nextState: afterReply };
    const attack = { attacks: true, targetAreaId: 12, nextState: afterAttack };
    const moveMap = new Map([
        [afterCandidate, [reply]],
        [afterReply, [attack]]
    ]);

    const result = analyzer.findForcedMaterialGainInTwoMoves(
        root, [candidate], 'red', bases, simulate,
        state => moveMap.get(state) || [], pass,
        { maxNodes: 100 }
    );

    // Three enemy nodes are lost, but three own nodes are lost along the line:
    // net gain is only one, so this is not a forced material gain.
    assert.equal(result.complete, true);
    assert.deepEqual(result.moves, []);
});

test('three-action proof uses the worst defender branch and cumulative exchange', () => {
    const analyzer = new TacticalAnalyzer();
    const root = createState('root', ['r0', 'r1'], blue);
    const afterCandidate = createState('candidate', ['r0', 'r1'], blue);
    const firstA = createState('first-a', ['r0', 'r1'], blue);
    const firstB = createState('first-b', ['r0', 'r1'], blue);
    const setupAState = createState('setup-a', ['r0', 'r1'], blue);
    const setupBState = createState('setup-b', ['r0', 'r1'], blue);
    const secondA = createState('second-a', ['r0', 'r1'], blue);
    const secondB = createState('second-b', ['r0', 'r1'], blue);
    const finalA = createState('final-a', ['r0', 'r1'], ['b0']);
    const finalB = createState('final-b', ['r0', 'r1'], ['b0', 'b4']);

    const candidate = { nextState: afterCandidate };
    const initialProbe = { targetAreaId: 16, nextState: afterCandidate };
    const firstReplyA = { attacks: true, nextState: firstA };
    const firstReplyB = { nextState: firstB };
    const setupA = { targetAreaId: 17, nextState: setupAState };
    const setupB = { targetAreaId: 18, nextState: setupBState };
    const secondReplyA = { attacks: true, nextState: secondA };
    const secondReplyB = { nextState: secondB };
    const attackA = { attacks: true, targetAreaId: 12, nextState: finalA };
    const attackB = { attacks: true, targetAreaId: 12, nextState: finalB };

    const moveMap = new Map([
        [afterCandidate, [initialProbe]],
        [firstA, [setupA]],
        [firstB, [setupB]],
        [setupAState, [secondReplyA]],
        [setupBState, [secondReplyB]],
        [secondA, [attackA]],
        [secondB, [attackB]]
    ]);
    const result = analyzer.findForcedTacticalSequenceInThreeMoves(
        root, [candidate], 'red', bases, simulate,
        (state, side) => state === afterCandidate && side === 'blue'
            ? [firstReplyA, firstReplyB]
            : moveMap.get(state) || [], pass,
        { maxNodes: 200 }
    );

    assert.equal(result.complete, true);
    assert.deepEqual(result.moves, [candidate]);
    assert.equal(result.guaranteedNodeGain, 3);
    assert.equal(result.guaranteedCascadeLoss, 2);
    assert.ok(result.opponentAttackReplies > 0);
});

test('search completes beyond the old wall-clock budget when node budget allows', () => {
    let clock = 0;
    const engine = new SearchEngine({ now: () => (clock += 100) });
    const leafA = { key: 'leaf-a', side: 'blue', score: 4, moves: [] };
    const leafB = { key: 'leaf-b', side: 'blue', score: 9, moves: [] };
    const childA = { key: 'child-a', side: 'blue', score: 0 };
    const childB = { key: 'child-b', side: 'blue', score: 0 };
    const root = { key: 'root', side: 'red' };
    const moveA = { key: 'a', next: childA };
    const moveB = { key: 'b', next: childB };
    const tree = new Map([
        [root, [moveA, moveB]],
        [childA, [{ key: 'a1', next: leafA }]],
        [childB, [{ key: 'b1', next: leafB }]]
    ]);
    const result = engine.search({
        rootState: root,
        rootMoves: [moveA, moveB],
        isTerminal: state => state.moves?.length === 0,
        getSideToMove: state => state.side,
        getPositionKey: state => state.key,
        getMoveKey: move => move.key,
        applyMove: (_state, move) => move.next,
        generateMoves: state => tree.get(state) || [],
        passTurn: state => state,
        evaluate: state => state.score,
        orderMoves: (_state, moves) => moves,
        maxDepth: 3,
        timeBudgetMs: 1,
        deadline: Infinity,
        maxNodes: 100
    });

    assert.equal(result.completedDepth, 3);
    assert.equal(result.rootEvaluations, 2);
    assert.ok(clock > 1);
    assert.equal(result.move, moveB);
});

test('search budget also accounts for mandatory root evaluation work', () => {
    const engine = new SearchEngine({ now: () => 0 });
    const root = { key: 'root', side: 'red' };
    const weak = { key: 'weak', side: 'blue', score: 1 };
    const strong = { key: 'strong', side: 'blue', score: 7 };
    const moveA = { key: 'a', next: weak };
    const moveB = { key: 'b', next: strong };
    const result = engine.search({
        rootState: root,
        rootMoves: [moveA, moveB],
        getSideToMove: state => state.side,
        getPositionKey: state => state.key,
        getMoveKey: move => move.key,
        applyMove: (_state, move) => move.next,
        generateMoves: () => [],
        orderMoves: (_state, moves) => moves,
        passTurn: state => state,
        evaluate: state => state.score,
        maxDepth: 4,
        timeBudgetMs: 1,
        deadline: Infinity,
        maxNodes: 0
    });
    assert.equal(result.completedDepth, 0);
    assert.equal(result.move, moveA);
    assert.equal(result.rootEvaluations, 0);
    assert.ok(result.workUnits > 0);
});


test('material proof does not call a net-negative root trade a guaranteed gain', () => {
    const analyzer = new TacticalAnalyzer();
    const root = createState('root', ['r0', 'r1', 'r2', 'r3'], ['b0', 'b1', 'b2']);
    const afterCandidate = createState('candidate', ['r0', 'r1', 'r2', 'r3'], ['b0', 'b1', 'b2']);
    const afterReply = createState('reply', ['r0', 'r1', 'r2', 'r3'], ['b0', 'b1', 'b2']);
    // The attack removes one enemy root but costs the attacker three ordinary nodes.
    const afterAttack = createState('attack', ['r0'], ['b1', 'b2']);
    const candidate = { nextState: afterCandidate };
    const reply = { nextState: afterReply };
    const attack = { attacks: true, targetAreaId: 11, nextState: afterAttack };
    const moveMap = new Map([
        [afterCandidate, [reply]],
        [afterReply, [attack]]
    ]);
    const result = analyzer.findForcedMaterialGainInTwoMoves(
        root, [candidate], 'red', bases, simulate,
        state => moveMap.get(state) || [], pass,
        { maxNodes: 100 }
    );
    assert.equal(result.complete, true);
    assert.deepEqual(result.moves, []);
});

test('mandatory-defense budget exhaustion preserves every legal candidate', () => {
    const analyzer = new TacticalAnalyzer();
    const game = createState('root', ['r0'], ['b0']);
    const moves = [{ id: 'a' }, { id: 'b' }];
    const result = analyzer.findMandatoryDefenses(
        game, moves, 'red', bases, simulate,
        () => [{ targetAreaId: 50, attacks: false }],
        { maxNodes: 0 }
    );
    assert.equal(result.complete, false);
    assert.equal(result.hasImmediateThreat, false);
    assert.deepEqual(result.moves, moves);
    assert.ok(result.nodes > 0);
});
