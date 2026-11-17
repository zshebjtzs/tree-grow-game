import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../js/game/GameState.js';
import { MatchHistory } from '../js/game/MatchHistory.js';
import { ReplaySaveValidator } from '../js/replay/ReplaySaveValidator.js';

function createFixture({ includeHistory = true } = {}) {
    const seeds = Array.from({ length: 50 }, (_, i) => [
        90 + (i % 10) * 170,
        100 + Math.floor(i / 10) * 200
    ]);
    const initial = new GameState();
    initial.addNode(null, seeds[0][0], seeds[0][1], 1, 'red');
    initial.addNode(null, seeds[1][0], seeds[1][1], 2, 'blue');
    const before = MatchHistory.capture({ gameState: initial.toJSON(), matchTracker: null, lastMatchResult: null });
    const afterGame = initial.clone();
    const child = afterGame.addNode(1, seeds[2][0], seeds[2][1], 3, 'red');
    afterGame.currentTurn = 'blue';
    const after = MatchHistory.capture({ gameState: afterGame.toJSON(), matchTracker: null, lastMatchResult: null });
    const history = MatchHistory.start(before);
    history.recordAction({
        side: 'red',
        action: { type: 'growth', owner: 'red', parentNodeId: 1, targetAreaId: 3, nodeId: child.id, isAttack: false },
        beforeSnapshot: before,
        afterSnapshot: after,
        completedAt: 10
    });
    const data = {
        schemaVersion: 2,
        gameState: afterGame.toJSON(),
        mapSeeds: seeds,
        redBaseId: 1,
        blueBaseId: 2,
        gamePhase: 'playing',
        isAIMode: false,
        playerSide: 'red',
        difficulty: 'medium',
        matchTracker: null,
        lastMatchResult: null,
        ...(includeHistory ? { matchHistory: history.toJSON() } : {})
    };
    return { data, before, after };
}

test('validates a complete history and returns an isolated normalized save', () => {
    const { data } = createFixture();
    const result = ReplaySaveValidator.validate(data);
    assert.equal(result.history.actionCount, 1);
    assert.equal(result.warnings.length, 0);
    assert.equal(result.metadata.redBaseId, 1);
    result.data.matchHistory.actions.length = 0;
    assert.equal(data.matchHistory.actions.length, 1);
});

test('legacy save without history is replayable only as its saved position', () => {
    const { data } = createFixture({ includeHistory: false });
    const result = ReplaySaveValidator.validate(data);
    assert.equal(result.history.actionCount, 0);
    assert.equal(result.history.historyIncomplete, true);
    assert.equal(result.warnings.length, 1);
});

test('rejects invalid map, broken action chain, and mismatched history tip', () => {
    const invalidMap = createFixture().data;
    invalidMap.mapSeeds[0][0] = 9999;
    assert.throws(() => ReplaySaveValidator.validate(invalidMap), /地图种子/);

    const brokenChain = createFixture().data;
    brokenChain.matchHistory.actions[0].before.gameState.currentTurn = 'blue';
    assert.throws(() => ReplaySaveValidator.validate(brokenChain), /无法衔接/);

    const mismatchedTip = createFixture().data;
    mismatchedTip.gameState.currentTurn = 'red';
    assert.throws(() => ReplaySaveValidator.validate(mismatchedTip), /末端快照/);
});

test('rejects invalid node coordinates and unknown action types', () => {
    const invalidNode = createFixture().data;
    invalidNode.gameState.nodes[0].x = 1799;
    assert.throws(() => ReplaySaveValidator.validate(invalidNode), /地图区域不一致/);

    const invalidAction = createFixture().data;
    invalidAction.matchHistory.actions[0].action.type = 'teleport';
    assert.throws(() => ReplaySaveValidator.validate(invalidAction), /未知行动类型/);
});

test('skip actions are retained as timeline steps without requiring a map change', () => {
    const { data, after } = createFixture();
    const history = MatchHistory.fromJSON(data.matchHistory);
    const skipped = structuredClone(after);
    skipped.gameState.currentTurn = 'red';
    history.recordAction({
        side: 'blue',
        action: { type: 'skip', owner: 'blue' },
        beforeSnapshot: after,
        afterSnapshot: skipped,
        completedAt: 20
    });
    data.matchHistory = history.toJSON();
    data.gameState = skipped.gameState;
    const result = ReplaySaveValidator.validate(data);
    assert.equal(result.history.actionCount, 2);
    assert.equal(result.history.actions[1].action.type, 'skip');
});

test('rejects a growth record whose path or node sequence is inconsistent', () => {
    const disconnectedPath = createFixture().data;
    disconnectedPath.matchHistory.actions[0].action.path = [1, 1, 3];
    assert.throws(() => ReplaySaveValidator.validate(disconnectedPath), /不连通的地图路径/);

    const invalidNodeSequence = createFixture().data;
    invalidNodeSequence.matchHistory.actions[0].action.nodeId = 9;
    assert.throws(() => ReplaySaveValidator.validate(invalidNodeSequence), /新节点编号/);
});

test('rejects a history action recorded for the wrong side to move', () => {
    const wrongTurn = createFixture().data;
    wrongTurn.matchHistory.initialSnapshot.gameState.currentTurn = 'blue';
    wrongTurn.matchHistory.actions[0].before.gameState.currentTurn = 'blue';
    assert.throws(() => ReplaySaveValidator.validate(wrongTurn), /行动方与行动前回合不一致/);
});
