/**
 * Tracks the latest requested replay position while a visual step animation
 * is still running. The committed ReplaySession position remains authoritative.
 */
export class ReplayNavigationState {
    constructor() {
        this.targetStep = null;
    }

    getBaseStep(currentStep) {
        return this.targetStep ?? currentStep;
    }

    request(step, currentStep, totalSteps) {
        if (!Number.isInteger(currentStep) || !Number.isInteger(totalSteps) ||
            !Number.isFinite(step)) {
            throw new TypeError('回放导航步骤无效');
        }
        const fromStep = this.getBaseStep(currentStep);
        const target = Math.max(0, Math.min(totalSteps, Math.trunc(step)));
        if (target === fromStep) return { fromStep, target, changed: false };
        this.targetStep = target;
        return { fromStep, target, changed: true };
    }

    clear() {
        this.targetStep = null;
    }
}
