import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../js/game/GameState.js';
import { MatchHistory } from '../js/game/MatchHistory.js';
import { runReplayImport } from '../js/replay/ReplayImportTask.js';
import { encodeSaveFile } from '../js/storage/SaveCodec.js';

function createSave() {
    const seeds = Array.from({ length: 50 }, (_, i) => [90 + (i % 10) * 170, 100 + Math.floor(i / 10) * 200]);
    const game = new GameState();
    game.addNode(null, seeds[0][0], seeds[0][1], 1, 'red');
    game.addNode(null, seeds[1][0], seeds[1][1], 2, 'blue');
    const snapshot = MatchHistory.capture({ gameState: game.toJSON(), matchTracker: null, lastMatchResult: null });
    return {
        schemaVersion: 2, gameState: game.toJSON(), mapSeeds: seeds, redBaseId: 1, blueBaseId: 2,
        gamePhase: 'playing', isAIMode: true, playerSide: 'blue', difficulty: 'hard',
        matchTracker: null, lastMatchResult: null, matchHistory: MatchHistory.start(snapshot).toJSON()
    };
}
test('imports compressed saves and reports staged progress with PVE metadata', async () => {
    const progress = [];
    const result = await runReplayImport(await encodeSaveFile(createSave()), { onProgress: value => progress.push(value) });
    assert.equal(result.metadata.mode, 'pve');
    assert.equal(result.metadata.playerSide, 'blue');
    assert.equal(result.metadata.difficulty, 'hard');
    assert.deepEqual(progress.map(item => item.progress), [8, 28, 96]);
});
test('normalizes legacy saves without history into an incomplete replay segment', async () => {
    const data = createSave(); delete data.matchHistory;
    const result = await runReplayImport(new Blob([JSON.stringify(data)]));
    assert.equal(result.data.matchHistory.historyIncomplete, true);
    assert.equal(result.data.matchHistory.actions.length, 0);
    assert.equal(result.warnings.length, 1);
});
test('rejects corrupt history without returning partial replay data', async () => {
    const data = createSave(); data.matchHistory.actions = [{ id: 1 }];
    await assert.rejects(() => runReplayImport(new Blob([JSON.stringify(data)])), /棋谱行动记录无效/);
});

test('imports a valid legacy JSON replay larger than 20 MiB without a size rejection', async () => {
    const data = createSave();
    data.largeUnusedField = 'x'.repeat(20 * 1024 * 1024 + 128);
    const file = new Blob([JSON.stringify(data)], { type: 'application/json' });
    assert.ok(file.size > 20 * 1024 * 1024);
    const result = await runReplayImport(file);
    assert.equal(result.metadata.mode, 'pve');
    assert.equal(result.data.matchHistory.actions.length, 0);
});
