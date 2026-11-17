import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplaySession } from '../js/replay/ReplaySession.js';
import { ReplayController } from '../js/replay/ReplayController.js';
import { formatReplaySide, formatReplayAction, formatReplayEvent } from '../js/replay/ReplayFormatter.js';

const snapshot = value => ({
    gameState: { marker: value },
    matchTracker: { totalTurns: value },
    lastMatchResult: null
});

function saveData() {
    return {
        schemaVersion: 2,
        mapSeeds: { seed: 123 },
        redBaseId: 1,
        blueBaseId: 8,
        isAIMode: true,
        playerSide: 'blue',
        difficulty: 'hard',
        matchHistory: {
            schemaVersion: 1,
            rulesetVersion: 1,
            historyIncomplete: false,
            initialSnapshot: snapshot(0),
            actions: [
                { id: 1, sequence: 1, side: 'red', action: { type: 'growth', owner: 'red' }, before: snapshot(0), after: snapshot(1), completedAt: 1 },
                { id: 2, sequence: 2, side: 'blue', action: { type: 'skip', owner: 'blue' }, before: snapshot(1), after: snapshot(2), completedAt: 2 }
            ],
            nextActionId: 3
        }
    };
}

test('session restores initial and arbitrary action snapshots without mutating saved data', () => {
    const data = saveData();
    const session = new ReplaySession(data);
    assert.equal(session.totalSteps, 2);
    assert.equal(session.getCurrentSnapshot().gameState.marker, 0);
    assert.equal(session.goTo(2).gameState.marker, 2);
    assert.equal(session.getActionAt(2).action.type, 'skip');
    const returned = session.getCurrentSnapshot();
    returned.gameState.marker = 99;
    assert.equal(session.getCurrentSnapshot().gameState.marker, 2);
    assert.equal(data.matchHistory.actions[1].after.gameState.marker, 2);
});

test('session rejects missing or malformed history and invalid steps', () => {
    assert.throws(() => new ReplaySession({}), TypeError);
    const invalid = saveData();
    invalid.matchHistory.actions[0].sequence = 4;
    assert.throws(() => new ReplaySession(invalid), TypeError);
    const session = new ReplaySession(saveData());
    assert.throws(() => session.goTo(-1), RangeError);
    assert.throws(() => session.goTo(3), RangeError);
    assert.equal(session.getActionAt(0), null);
});

test('controller supports first, previous, next, last, and arbitrary navigation', () => {
    const session = new ReplaySession(saveData());
    const events = [];
    const controller = new ReplayController(session, { onChange: event => events.push(event) });
    controller.next();
    assert.equal(controller.currentStep, 1);
    controller.goTo(2);
    assert.equal(controller.currentStep, 2);
    controller.previous();
    assert.equal(controller.currentStep, 1);
    controller.first();
    assert.equal(controller.currentStep, 0);
    controller.last();
    assert.equal(controller.currentStep, 2);
    assert.equal(events.length, 5);
    assert.equal(controller.next().gameState.marker, 2);
});

test('controller playback advances at selected speed and stops at the end', () => {
    const session = new ReplaySession(saveData());
    const scheduled = new Map();
    let nextId = 1;
    const scheduler = {
        setInterval(callback, delay) {
            const id = nextId++;
            scheduled.set(id, { callback, delay });
            return id;
        },
        clearInterval(id) { scheduled.delete(id); }
    };
    const controller = new ReplayController(session, { scheduler });
    controller.setSpeed(2);
    assert.equal(controller.play(), true);
    const firstTimer = [...scheduled.values()][0];
    assert.equal(firstTimer.delay, 500);
    firstTimer.callback();
    assert.equal(controller.currentStep, 1);
    const activeTimer = [...scheduled.values()][0];
    activeTimer.callback();
    assert.equal(controller.currentStep, 2);
    assert.equal(controller.isPlaying, false);
    assert.equal(scheduled.size, 0);
    assert.equal(controller.play(), false);
});

test('manual next/previous navigation interrupts automatic playback', () => {
    const session = new ReplaySession(saveData());
    const scheduled = new Map();
    let nextId = 1;
    const scheduler = {
        setInterval(callback) { const id = nextId++; scheduled.set(id, callback); return id; },
        clearInterval(id) { scheduled.delete(id); }
    };
    const controller = new ReplayController(session, { scheduler });
    controller.play();
    assert.equal(controller.isPlaying, true);
    controller.next();
    assert.equal(controller.currentStep, 1);
    assert.equal(controller.isPlaying, false);
    assert.equal(scheduled.size, 0);
    controller.play();
    controller.previous();
    assert.equal(controller.currentStep, 0);
    assert.equal(controller.isPlaying, false);
    assert.equal(scheduled.size, 0);
});

test('controller rejects unsupported playback speeds and disposes its timer', () => {
    const session = new ReplaySession(saveData());
    const scheduled = new Map();
    let nextId = 1;
    const scheduler = {
        setInterval(callback) { const id = nextId++; scheduled.set(id, callback); return id; },
        clearInterval(id) { scheduled.delete(id); }
    };
    const controller = new ReplayController(session, { scheduler });
    assert.throws(() => controller.setSpeed(3), RangeError);
    controller.play();
    controller.dispose();
    assert.equal(controller.isPlaying, false);
    assert.equal(scheduled.size, 0);
});

test('changing speed during playback reschedules the timer without changing position', () => {
    const session = new ReplaySession(saveData());
    const scheduled = new Map();
    let nextId = 1;
    const scheduler = {
        setInterval(callback, delay) {
            const id = nextId++;
            scheduled.set(id, { callback, delay });
            return id;
        },
        clearInterval(id) { scheduled.delete(id); }
    };
    const controller = new ReplayController(session, { scheduler });
    controller.play();
    assert.equal([...scheduled.values()][0].delay, 1000);
    controller.setSpeed(4);
    assert.equal(controller.currentStep, 0);
    assert.equal(scheduled.size, 1);
    assert.equal([...scheduled.values()][0].delay, 250);
    controller.dispose();
    assert.equal(scheduled.size, 0);
});

test('arbitrary timeline seeking interrupts playback and end boundaries remain stable', () => {
    const session = new ReplaySession(saveData());
    const scheduled = new Map();
    let nextId = 1;
    const scheduler = {
        setInterval(callback) { const id = nextId++; scheduled.set(id, callback); return id; },
        clearInterval(id) { scheduled.delete(id); }
    };
    const controller = new ReplayController(session, { scheduler });
    controller.play();
    controller.goTo(2);
    assert.equal(controller.isPlaying, false);
    assert.equal(controller.currentStep, 2);
    assert.equal(scheduled.size, 0);
    assert.equal(controller.next().gameState.marker, 2);
    assert.equal(controller.previous().gameState.marker, 1);
    assert.equal(controller.currentStep, 1);
});

test('PVE replay labels correctly identify a blue human player and red AI', () => {
    const context = { mode: 'pve', playerSide: 'blue' };
    assert.equal(formatReplaySide('blue', context), '蓝方 · 玩家');
    assert.equal(formatReplaySide('red', context), '红方 · AI');
    assert.equal(formatReplayAction({
        side: 'blue',
        action: { type: 'skip', owner: 'blue' }
    }, context).title, '蓝方 · 玩家跳过回合');
});

test('replay event formatting preserves combat, freeze, root-loss, and victory details', () => {
    const context = { mode: 'pvp' };
    assert.match(formatReplayEvent({
        type: 'COMBAT', side: 'red', destroyedNodes: 3, outcome: 'tree-destroyed'
    }, context).title, /摧毁 3 个节点/);
    assert.match(formatReplayEvent({
        type: 'FREEZE', side: 'blue', nodeId: 17
    }, context).detail, /17/);
    assert.match(formatReplayEvent({
        type: 'ROOT_DESTROYED', side: 'red', count: 2, remaining: 1
    }, context).detail, /损失 2 个/);
    assert.equal(formatReplayEvent({
        type: 'VICTORY', side: 'blue', reason: 'enemy_base_reached'
    }, context).title, '蓝方获胜');
});
