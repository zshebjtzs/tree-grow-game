import { MatchHistory } from '../game/MatchHistory.js';

const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));

/**
 * An isolated, read-only view over a saved match history.
 * Step 0 is the initial position; step N is the position after action N.
 */
export class ReplaySession {
    #history;

    constructor(saveData) {
        if (!saveData || typeof saveData !== 'object' || !saveData.matchHistory) {
            throw new TypeError('回放存档缺少棋谱数据');
        }

        this.#history = MatchHistory.fromJSON(saveData.matchHistory);
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
        this.#assertStep(step);
        if (step === 0) return copy(this.#history.initialSnapshot);
        return copy(this.#history.actions[step - 1].after);
    }

    getCurrentSnapshot() {
        return this.getSnapshotAt(this.currentStep);
    }

    getActionAt(step) {
        if (!Number.isInteger(step) || step < 1 || step > this.totalSteps) return null;
        return copy(this.#history.actions[step - 1]);
    }

    goTo(step) {
        this.#assertStep(step);
        this.currentStep = step;
        return this.getCurrentSnapshot();
    }

    #assertStep(step) {
        if (!Number.isInteger(step) || step < 0 || step > this.totalSteps) {
            throw new RangeError(`回放步骤超出范围：${step}`);
        }
    }
}
