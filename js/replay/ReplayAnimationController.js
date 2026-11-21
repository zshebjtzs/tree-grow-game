import { AnimationController } from '../presentation/AnimationController.js';
import { createReplayAnimationTimeline } from './ReplayAnimationTimeline.js';

/** Drives presentation-only animation frames and synchronized audio for one replay action. */
export class ReplayAnimationController {
    constructor({
        session,
        renderFrame = () => {},
        animationController = new AnimationController(),
        audioScheduler = null
    } = {}) {
        if (!session || typeof session.getSnapshotViewAt !== 'function' ||
            typeof renderFrame !== 'function' || !animationController ||
            typeof animationController.play !== 'function' ||
            typeof animationController.cancel !== 'function' ||
            typeof animationController.setSpeed !== 'function' ||
            (audioScheduler && !['beginAction', 'onSegmentStart', 'onSegmentComplete', 'completeAction', 'cancel']
                .every(method => typeof audioScheduler[method] === 'function'))) {
            throw new TypeError('回放动画控制器依赖项无效');
        }
        this.session = session;
        this.renderFrame = renderFrame;
        this.animations = animationController;
        this.audioScheduler = audioScheduler;
        this.speed = 1;
        this.active = null;
        this.destroyed = false;
    }

    setSpeed(speed) {
        this.speed = this.animations.setSpeed(speed);
        this.audioScheduler?.setSpeed?.(this.speed);
        return this.speed;
    }

    async playStep(step) {
        if (this.destroyed) return false;
        this.cancel();
        const timeline = createReplayAnimationTimeline(this.session, step);
        const audioContext = this.audioScheduler?.beginAction(timeline) ?? null;
        const token = { cancelled: false, cancelSegment: null, audioContext };
        this.active = token;
        let completed = false;
        try {
            for (const segment of timeline.segments) {
                if (token.cancelled) return false;
                this.audioScheduler?.onSegmentStart(audioContext, segment);
                const segmentCompleted = await this.#playSegment(segment, token, step);
                if (!segmentCompleted) return false;
                this.audioScheduler?.onSegmentComplete(audioContext, segment);
            }
            if (token.cancelled) return false;
            this.audioScheduler?.completeAction(audioContext);
            completed = true;
            return true;
        } finally {
            if (!completed && token.cancelled) this.audioScheduler?.cancel(audioContext);
            if (this.active === token) this.active = null;
        }
    }

    #playSegment(segment, token, step) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = completed => {
                if (settled) return;
                settled = true;
                if (token.cancelSegment === cancel) token.cancelSegment = null;
                resolve(completed);
            };
            const cancel = () => {
                this.animations.cancel();
                finish(false);
            };
            token.cancelSegment = cancel;

            const draw = progress => {
                this.renderFrame({
                    step,
                    nodes: segment.nodes,
                    animationState: segment.type === 'growth'
                        ? { ...segment.animationState, progress }
                        : null,
                    combatState: segment.type === 'combat'
                        ? { ...segment.combatState, progress }
                        : null
                });
            };

            try {
                this.animations.play({
                    duration: segment.duration,
                    onUpdate: draw,
                    onComplete: () => finish(true)
                });
            } catch (error) {
                settled = true;
                if (token.cancelSegment === cancel) token.cancelSegment = null;
                reject(error);
            }
        });
    }

    cancel() {
        const token = this.active;
        if (token) {
            token.cancelled = true;
            token.cancelSegment?.();
            this.active = null;
        }
        // Also stop short sound tails from already-completed steps when the
        // user pauses, seeks, replaces an action, or leaves the replay.
        this.audioScheduler?.cancel(token?.audioContext ?? null);
        return Boolean(token);
    }

    destroy() {
        this.cancel();
        this.animations.destroy?.();
        this.destroyed = true;
    }
}
