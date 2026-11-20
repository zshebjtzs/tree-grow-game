import { MatchHistory } from '../game/MatchHistory.js';

const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const key of Object.keys(value)) deepFreeze(value[key], seen);
    return Object.freeze(value);
}
function collectNewEvents(record) {
    const before = record.before.matchTracker?.events || [];
    const after = record.after.matchTracker?.events || [];
    return after.slice(before.length).map(event => ({
        id: event.id, type: event.type, side: event.side, areaId: event.areaId,
        isAttack: event.isAttack, destroyedNodes: event.destroyedNodes, outcome: event.outcome,
        nodeId: event.nodeId, causedBy: event.causedBy, count: event.count,
        remaining: event.remaining, reason: event.reason
    }));
}

/**
 * An isolated, read-only view over a saved match history.
 * Step 0 is the initial position; step N is the position after action N.
 */
export class ReplaySession {
    #history;
    #timeline;

    constructor(saveData, { history = null } = {}) {
        if (!saveData || typeof saveData !== 'object' ||
            (!(history instanceof MatchHistory) && !saveData.matchHistory)) {
            throw new TypeError('回放存档缺少棋谱数据');
        }

        // The validator may pass its already-isolated MatchHistory instance.
        // Direct callers still receive the defensive JSON import path.
        this.#history = history instanceof MatchHistory
            ? history
            : MatchHistory.fromJSON(saveData.matchHistory);
        deepFreeze(this.#history);
        this.#timeline = this.#history.actions.map((record, index) => Object.freeze({
            step: index + 1, side: record.side,
            action: deepFreeze(copy(record.action)),
            events: Object.freeze(collectNewEvents(record).map(event => Object.freeze(event)))
        }));
        this.metadata = copy({
            schemaVersion: saveData.schemaVersion ?? null,
            mapSeeds: saveData.mapSeeds ?? null,
            redBaseId: saveData.redBaseId ?? null,
            blueBaseId: saveData.blueBaseId ?? null,
            isAIMode: saveData.isAIMode ?? null,
            playerSide: saveData.playerSide ?? null,
            difficulty: saveData.difficulty ?? null
        });
        Object.freeze(this.metadata);
        this.currentStep = 0;
    }

    get totalSteps() {
        return this.#history.actionCount;
    }

    get historyIncomplete() {
        return this.#history.historyIncomplete;
    }

    getSnapshotAt(step) {
        return copy(this.getSnapshotViewAt(step));
    }
    getSnapshotViewAt(step) {
        this.#assertStep(step);
        return step === 0 ? this.#history.initialSnapshot : this.#history.actions[step - 1].after;
    }
    getCurrentSnapshot() { return this.getSnapshotAt(this.currentStep); }
    getCurrentSnapshotView() { return this.getSnapshotViewAt(this.currentStep); }
    getActionAt(step) {
        const action = this.getActionViewAt(step);
        return action ? copy(action) : null;
    }
    getActionViewAt(step) {
        if (!Number.isInteger(step) || step < 1 || step > this.totalSteps) return null;
        return this.#history.actions[step - 1];
    }
    getTimelineEntryAt(step) {
        if (!Number.isInteger(step) || step < 1 || step > this.totalSteps) return null;
        return this.#timeline[step - 1];
    }
    goTo(step) { return copy(this.goToView(step)); }
    goToView(step) {
        this.#assertStep(step);
        this.currentStep = step;
        return this.getCurrentSnapshotView();
    }

    #assertStep(step) {
        if (!Number.isInteger(step) || step < 0 || step > this.totalSteps) {
            throw new RangeError(`回放步骤超出范围：${step}`);
        }
    }
}
