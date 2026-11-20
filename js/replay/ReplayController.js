const DEFAULT_SPEEDS = Object.freeze([0.5, 1, 2, 4]);

/** Navigation and playback state for a ReplaySession. */
export class ReplayController {
    constructor(session, { onChange = () => {}, scheduler = globalThis } = {}) {
        if (!session || typeof session.goTo !== 'function' ||
            !Number.isInteger(session.totalSteps)) {
            throw new TypeError('ReplayController 需要有效的 ReplaySession');
        }
        if (typeof onChange !== 'function' || !scheduler ||
            typeof scheduler.setInterval !== 'function' ||
            typeof scheduler.clearInterval !== 'function') {
            throw new TypeError('回放控制器依赖项无效');
        }

        this.session = session;
        this.onChange = onChange;
        this.scheduler = scheduler;
        this.speed = 1;
        this.isPlaying = false;
        this.timerId = null;
    }

    get currentStep() { return this.session.currentStep; }
    get totalSteps() { return this.session.totalSteps; }
    get canGoPrevious() { return this.currentStep > 0; }
    get canGoNext() { return this.currentStep < this.totalSteps; }

    goTo(step) {
        this.pause();
        const snapshot = this.#goToSessionStep(step);
        this.#notify('seek', snapshot);
        return snapshot;
    }

    next() {
        this.pause();
        return this.#advance();
    }

    previous() {
        this.pause();
        if (!this.canGoPrevious) return this.#currentSnapshot();
        const snapshot = this.#goToSessionStep(this.currentStep - 1);
        this.#notify('step', snapshot);
        return snapshot;
    }

    #advance() {
        if (!this.canGoNext) return this.#currentSnapshot();
        const snapshot = this.#goToSessionStep(this.currentStep + 1);
        this.#notify('step', snapshot);
        return snapshot;
    }

    #goToSessionStep(step) {
        return typeof this.session.goToView === 'function'
            ? this.session.goToView(step)
            : this.session.goTo(step);
    }
    #currentSnapshot() {
        return typeof this.session.getCurrentSnapshotView === 'function'
            ? this.session.getCurrentSnapshotView()
            : this.session.getCurrentSnapshot();
    }

    first() { return this.goTo(0); }
    last() { return this.goTo(this.totalSteps); }

    setSpeed(speed) {
        if (!DEFAULT_SPEEDS.includes(speed)) {
            throw new RangeError('不支持的回放速度');
        }
        this.speed = speed;
        if (this.isPlaying) this.#schedule();
        this.#notify('speed', this.#currentSnapshot());
        return this.speed;
    }

    play() {
        if (this.isPlaying || !this.canGoNext) return false;
        this.isPlaying = true;
        this.#schedule();
        this.#notify('play', this.#currentSnapshot());
        return true;
    }

    pause() {
        if (this.timerId !== null) {
            this.scheduler.clearInterval(this.timerId);
            this.timerId = null;
        }
        const wasPlaying = this.isPlaying;
        this.isPlaying = false;
        if (wasPlaying) this.#notify('pause', this.#currentSnapshot());
        return wasPlaying;
    }

    dispose() {
        this.pause();
    }

    #schedule() {
        if (this.timerId !== null) this.scheduler.clearInterval(this.timerId);
        this.timerId = this.scheduler.setInterval(() => {
            if (!this.canGoNext) {
                this.pause();
                return;
            }
            this.#advance();
            if (!this.canGoNext) this.pause();
        }, 1000 / this.speed);
    }

    #notify(type, snapshot) {
        this.onChange({
            type,
            currentStep: this.currentStep,
            totalSteps: this.totalSteps,
            speed: this.speed,
            isPlaying: this.isPlaying,
            snapshot
        });
    }
}
