import { AnimationController } from '../presentation/AnimationController.js';
import { createReplayAnimationTimeline } from './ReplayAnimationTimeline.js';

/** Drives presentation-only animation frames for one replay action at a time. */
export class ReplayAnimationController {
    constructor({
        session,
        renderFrame = () => {},
        animationController = new AnimationController()
    } = {}) {
        if (!session || typeof session.getSnapshotViewAt !== 'function' ||
            typeof renderFrame !== 'function' || !animationController ||
            typeof animationController.play !== 'function' ||
            typeof animationController.cancel !== 'function' ||
            typeof animationController.setSpeed !== 'function') {
            throw new TypeError('回放动画控制器依赖项无效');
        }
        this.session = session;
        this.renderFrame = renderFrame;
        this.animations = animationController;
        this.speed = 1;
        this.active = null;
        this.destroyed = false;
    }

    setSpeed(speed) {
        this.speed = this.animations.setSpeed(speed);
        return this.speed;
    }

    async playStep(step) {
        if (this.destroyed) return false;
        this.cancel();
        const timeline = createReplayAnimationTimeline(this.session, step);
        const token = { cancelled: false, cancelSegment: null };
        this.active = token;
        try {
            for (const segment of timeline.segments) {
                if (token.cancelled) return false;
                const completed = await this.#playSegment(segment, token, step);
                if (!completed) return false;
            }
            return !token.cancelled;
        } finally {
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
        if (!token) return false;
        token.cancelled = true;
        token.cancelSegment?.();
        this.active = null;
        return true;
    }

    destroy() {
        this.cancel();
        this.animations.destroy?.();
        this.destroyed = true;
    }
}
