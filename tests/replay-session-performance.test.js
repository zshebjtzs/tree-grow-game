import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchHistory } from '../js/game/MatchHistory.js';
import { ReplaySession } from '../js/replay/ReplaySession.js';

function createHistory(count = 3) {
    const snapshot = turn => ({ gameState: { currentTurn: turn, nodes: [] }, matchTracker: { events: [] }, lastMatchResult: null });
    const history = MatchHistory.start(snapshot('red'));
    let before = snapshot('red');
    for (let index = 0; index < count; index++) {
        const side = index % 2 === 0 ? 'red' : 'blue';
        const after = snapshot(side === 'red' ? 'blue' : 'red');
        after.matchTracker.events = [...before.matchTracker.events, ...(index === 1 ? [{ id: 1, type: 'FREEZE', side: 'red', nodeId: 7 }] : [])];
        history.recordAction({ side, action: { type: 'skip', owner: side }, beforeSnapshot: before, afterSnapshot: after, completedAt: index + 1 });
        before = after;
    }
    return history;
}
test('caches compact per-action timeline entries without copying full snapshots', () => {
    const session = new ReplaySession({ matchHistory: createHistory().toJSON() });
    const entry = session.getTimelineEntryAt(2);
    assert.equal(entry.step, 2);
    assert.equal(entry.action.type, 'skip');
    assert.equal(entry.events[0].type, 'FREEZE');
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.events));
    assert.equal(session.getTimelineEntryAt(99), null);
});
test('provides immutable views while preserving defensive getters', () => {
    const session = new ReplaySession({ matchHistory: createHistory(1).toJSON() });
    const view = session.goToView(1);
    assert.ok(Object.isFrozen(view));
    assert.ok(Object.isFrozen(session.getActionViewAt(1)));
    assert.equal(session.getCurrentSnapshotView(), view);
    assert.notEqual(session.getSnapshotAt(1), view);
    assert.equal(session.getActionAt(1).action.type, 'skip');
});
test('timeline cache is isolated from caller-owned source history', () => {
    const data = createHistory(1).toJSON();
    const session = new ReplaySession({ matchHistory: data });
    data.actions[0].action.type = 'mutated';
    assert.equal(session.getTimelineEntryAt(1).action.type, 'skip');
});

test('accepts a plain history object only through the validated Worker handoff', () => {
    const data = createHistory(2).toJSON();
    const session = new ReplaySession({ matchHistory: data }, {
        history: data,
        validatedHistory: true
    });
    assert.equal(session.totalSteps, 2);
    assert.equal(session.getTimelineEntryAt(2).step, 2);
});
