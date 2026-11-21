import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplayAudioScheduler } from '../js/replay/ReplayAudioScheduler.js';
import { ReplayAnimationController } from '../js/replay/ReplayAnimationController.js';

function makeTimeline({
    action = { type: 'growth', owner: 'red', nodeId: 2 },
    events = [],
    beforeTurn = 'red',
    afterTurn = 'blue',
    beforeGameOver = false,
    afterGameOver = false,
    segments = []
} = {}) {
    return {
        step: 1,
        action,
        events,
        beforeSnapshot: { gameState: { currentTurn: beforeTurn, isGameOver: beforeGameOver } },
        afterSnapshot: { gameState: { currentTurn: afterTurn, isGameOver: afterGameOver } },
        segments
    };
}

function fakeAudio({ state = 'running', muted = false, volume = 0.32 } = {}) {
    const played = [];
    let stopCalls = 0;
    let unlockResolve = null;
    return {
        played,
        get stopCalls() { return stopCalls; },
        muted,
        volume,
        context: { state },
        play(name) { played.push(name); return true; },
        stopAll() { stopCalls++; },
        unlock() {
            if (state === 'running') return Promise.resolve(true);
            return new Promise(resolve => { unlockResolve = resolve; });
        },
        resolveUnlock(value = true) { unlockResolve?.(value); }
    };
}

test('replay audio follows growth, combat, destruction, freeze, and turn event order', () => {
    const audio = fakeAudio();
    const scheduler = new ReplayAudioScheduler({ audioController: audio, now: () => 100 });
    const timeline = makeTimeline({
        events: [
            { type: 'GROWTH', nodeId: 2 },
            { type: 'COMBAT', destroyedNodes: 3 },
            { type: 'FREEZE', nodeId: 1 }
        ],
        segments: [{ type: 'growth' }, { type: 'combat' }]
    });
    const context = scheduler.beginAction(timeline);
    scheduler.onSegmentStart(context, timeline.segments[0]);
    scheduler.onSegmentComplete(context, timeline.segments[0]);
    scheduler.onSegmentStart(context, timeline.segments[1]);
    scheduler.onSegmentComplete(context, timeline.segments[1]);
    scheduler.completeAction(context);
    assert.deepEqual(audio.played, ['growth', 'combat', 'destroy', 'freeze', 'turn']);
});

test('victory replaces the normal turn cue after combat resolution', () => {
    const audio = fakeAudio();
    const scheduler = new ReplayAudioScheduler({ audioController: audio, now: () => 100 });
    const timeline = makeTimeline({
        events: [
            { type: 'COMBAT', destroyedNodes: 2 },
            { type: 'ROOT_DESTROYED', count: 1 },
            { type: 'VICTORY', side: 'blue' }
        ],
        afterGameOver: true,
        beforeTurn: 'red',
        afterTurn: 'red',
        segments: [{ type: 'combat' }]
    });
    const context = scheduler.beginAction(timeline);
    scheduler.onSegmentStart(context, timeline.segments[0]);
    scheduler.onSegmentComplete(context, timeline.segments[0]);
    scheduler.completeAction(context);
    assert.deepEqual(audio.played, ['growth', 'combat', 'destroy', 'victory']);
});

test('freeze-only combat emits combat, freeze, and turn cues without a combat segment', () => {
    const audio = fakeAudio();
    const scheduler = new ReplayAudioScheduler({ audioController: audio, now: () => 100 });
    const timeline = makeTimeline({
        events: [{ type: 'COMBAT', destroyedNodes: 0 }, { type: 'FREEZE', nodeId: 3 }]
    });
    const context = scheduler.beginAction(timeline);
    scheduler.completeAction(context);
    assert.deepEqual(audio.played, ['growth', 'combat', 'freeze', 'turn']);
});

test('skip actions emit only the turn cue', () => {
    const audio = fakeAudio();
    const scheduler = new ReplayAudioScheduler({ audioController: audio, now: () => 100 });
    const timeline = makeTimeline({
        action: { type: 'skip', owner: 'red' },
        events: []
    });
    const context = scheduler.beginAction(timeline);
    scheduler.completeAction(context);
    assert.deepEqual(audio.played, ['turn']);
});

test('4x playback suppresses repeated skip-turn cues that are too close together', () => {
    const audio = fakeAudio();
    let now = 0;
    const scheduler = new ReplayAudioScheduler({ audioController: audio, now: () => now });
    scheduler.setSpeed(4);
    let context = scheduler.beginAction(makeTimeline({ action: { type: 'skip', owner: 'red' } }));
    scheduler.completeAction(context);
    now = 60;
    context = scheduler.beginAction(makeTimeline({
        action: { type: 'skip', owner: 'blue' }, beforeTurn: 'blue', afterTurn: 'red'
    }));
    scheduler.completeAction(context);
    now = 120;
    context = scheduler.beginAction(makeTimeline({
        action: { type: 'skip', owner: 'red' }, beforeTurn: 'red', afterTurn: 'blue'
    }));
    scheduler.completeAction(context);
    assert.deepEqual(audio.played, ['turn', 'turn']);
});

test('cancelling an action stops active sounds and drops cues waiting for audio unlock', async () => {
    const audio = fakeAudio({ state: 'suspended' });
    const scheduler = new ReplayAudioScheduler({ audioController: audio, now: () => 100 });
    const context = scheduler.beginAction(makeTimeline());
    scheduler.cancel(context);
    audio.resolveUnlock(true);
    await Promise.resolve();
    assert.deepEqual(audio.played, []);
    assert.equal(audio.stopCalls, 1);
});

test('ReplayAnimationController forwards segment lifecycle and cancels audio with animation', async () => {
    const node = { id: 1, x: 10, y: 10, owner: 'red', parentId: null, childrenIds: [], isRoot: true, isDestroyed: false };
    const child = { id: 2, x: 20, y: 20, owner: 'red', parentId: 1, childrenIds: [], isRoot: false, isDestroyed: false };
    const before = { gameState: { nodes: [node], currentTurn: 'red', isGameOver: false }, matchTracker: { events: [] }, lastMatchResult: null };
    const after = { gameState: { nodes: [node, child], currentTurn: 'blue', isGameOver: false }, matchTracker: { events: [] }, lastMatchResult: null };
    const entry = { action: { type: 'growth', owner: 'red', nodeId: 2 }, side: 'red', events: [] };
    const session = {
        totalSteps: 1,
        getSnapshotViewAt(step) { return step === 0 ? before : after; },
        getTimelineEntryAt() { return entry; }
    };
    let frameCallback = null;
    const animationController = {
        play({ onComplete }) { frameCallback = onComplete; },
        cancel() { frameCallback = null; },
        setSpeed(speed) { return speed; },
        destroy() {}
    };
    const calls = [];
    const audioScheduler = {
        beginAction(timeline) { calls.push(['begin', timeline.step]); return { id: 1 }; },
        onSegmentStart(context, segment) { calls.push(['start', segment.type]); },
        onSegmentComplete(context, segment) { calls.push(['complete', segment.type]); },
        completeAction() { calls.push(['finish']); },
        cancel() { calls.push(['cancel']); },
        setSpeed() {}
    };
    const controller = new ReplayAnimationController({
        session,
        renderFrame() {},
        animationController,
        audioScheduler
    });
    const done = controller.playStep(1);
    assert.deepEqual(calls.slice(0, 3), [['cancel'], ['begin', 1], ['start', 'growth']]);
    frameCallback();
    assert.equal(await done, true);
    assert.deepEqual(calls, [
        ['cancel'], ['begin', 1], ['start', 'growth'], ['complete', 'growth'], ['finish']
    ]);
    controller.destroy();
    assert.equal(calls.at(-1)[0], 'cancel');
});
