import { performance } from 'node:perf_hooks';
import { GameState } from '../js/game/GameState.js';
import { ReplaySaveValidator } from '../js/replay/ReplaySaveValidator.js';
import { encodeSaveFile } from '../js/storage/SaveCodec.js';

function makeSave(actionCount) {
    const mapSeeds = Array.from({ length: 50 }, (_, i) => [
        90 + (i % 10) * 170,
        100 + Math.floor(i / 10) * 200
    ]);
    const initial = new GameState();
    initial.addNode(null, mapSeeds[0][0], mapSeeds[0][1], 1, 'red');
    initial.addNode(null, mapSeeds[1][0], mapSeeds[1][1], 2, 'blue');

    const states = [];
    for (const turn of ['red', 'blue']) {
        const state = initial.clone();
        state.currentTurn = turn;
        states.push({
            gameState: state.toJSON(),
            matchTracker: null,
            lastMatchResult: null
        });
    }

    const actions = Array.from({ length: actionCount }, (_, index) => {
        const side = index % 2 === 0 ? 'red' : 'blue';
        return {
            id: index + 1,
            sequence: index + 1,
            side,
            action: { type: 'skip', owner: side },
            before: states[index % 2],
            after: states[(index + 1) % 2],
            completedAt: index + 1
        };
    });

    return {
        schemaVersion: 2,
        gameState: states[actionCount % 2].gameState,
        mapSeeds,
        redBaseId: 1,
        blueBaseId: 2,
        gamePhase: 'playing',
        isAIMode: false,
        playerSide: 'red',
        difficulty: 'medium',
        matchTracker: null,
        lastMatchResult: null,
        matchHistory: {
            schemaVersion: 1,
            rulesetVersion: 1,
            historyIncomplete: false,
            initialSnapshot: states[0],
            actions,
            nextActionId: actionCount + 1
        }
    };
}

for (const count of [100, 1000, 5000, 10000]) {
    const save = makeSave(count);
    const jsonStart = performance.now();
    const json = JSON.stringify(save);
    const serializeMs = performance.now() - jsonStart;

    const validateStart = performance.now();
    ReplaySaveValidator.validate(save);
    const validateMs = performance.now() - validateStart;

    const encodeStart = performance.now();
    const encoded = await encodeSaveFile(save);
    const encodeMs = performance.now() - encodeStart;

    console.log(JSON.stringify({
        actions: count,
        jsonBytes: Buffer.byteLength(json),
        savedBytes: encoded.size,
        compressionRatio: Number((encoded.size / Buffer.byteLength(json)).toFixed(3)),
        serializeMs: Number(serializeMs.toFixed(1)),
        validateMs: Number(validateMs.toFixed(1)),
        encodeMs: Number(encodeMs.toFixed(1))
    }));
}
