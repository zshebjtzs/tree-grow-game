/**
 * Converts validated replay timeline events into the same sound cues used by
 * live matches. It never runs game rules or mutates replay snapshots.
 */
export class ReplayAudioScheduler {
    constructor({ audioController, now = () => globalThis.performance?.now?.() ?? Date.now() } = {}) {
        if (!audioController || typeof audioController.play !== 'function' ||
            typeof now !== 'function') {
            throw new TypeError('回放音效调度器依赖项无效');
        }
        this.audio = audioController;
        this.now = now;
        this.speed = 1;
        this.active = null;
        this.lastCueAt = new Map();
    }

    setSpeed(speed) {
        if (![0.5, 1, 2, 4].includes(speed)) throw new RangeError('不支持的回放音效速度');
        this.speed = speed;
        return speed;
    }

    beginAction(timeline) {
        if (!timeline || !timeline.beforeSnapshot || !timeline.afterSnapshot ||
            !timeline.action || !Array.isArray(timeline.segments)) {
            throw new TypeError('回放音效需要完整的行动时间线');
        }
        this.cancel();
        const context = {
            timeline,
            cancelled: false,
            completed: false,
            combatStarted: false,
            outcomePlayed: false
        };
        this.active = context;
        if (timeline.action.type === 'growth') this.#play(context, 'growth');
        return context;
    }

    onSegmentStart(context, segment) {
        if (!this.#isActive(context) || segment?.type !== 'combat') return false;
        context.combatStarted = true;
        this.#play(context, 'combat');
        return true;
    }

    onSegmentComplete(context, segment) {
        if (!this.#isActive(context) || segment?.type !== 'combat') return false;
        this.#playOutcome(context);
        return true;
    }

    completeAction(context) {
        if (!this.#isActive(context) || context.completed) return false;
        const hasCombat = (context.timeline.events || []).some(event => event.type === 'COMBAT');
        // Freeze-only combat has no live destruction animation. Its combat and
        // freeze cues are emitted together after any preceding growth segment.
        if (hasCombat && !context.combatStarted) this.#play(context, 'combat');
        this.#playOutcome(context);
        context.completed = true;
        return true;
    }

    #playOutcome(context) {
        if (!this.#isActive(context) || context.outcomePlayed) return;
        context.outcomePlayed = true;
        const events = context.timeline.events || [];
        const combat = events.find(event => event.type === 'COMBAT');
        if (combat && Number(combat.destroyedNodes) > 0) this.#play(context, 'destroy');
        if (events.some(event => event.type === 'FREEZE')) this.#play(context, 'freeze');

        const before = context.timeline.beforeSnapshot?.gameState;
        const after = context.timeline.afterSnapshot?.gameState;
        const victory = events.some(event => event.type === 'VICTORY') ||
            (after?.isGameOver === true && before?.isGameOver !== true);
        if (victory) {
            this.#play(context, 'victory');
        } else if (before?.currentTurn && after?.currentTurn &&
            before.currentTurn !== after.currentTurn) {
            // This also covers skip actions, which intentionally have no
            // MatchTracker event but do perform the normal turn-switch path.
            this.#play(context, 'turn');
        }
    }

    #play(context, name) {
        if (!this.#isActive(context) || this.audio.muted || this.audio.volume <= 0) return false;
        const now = this.now();
        const minimumRepeatGap = this.speed === 4 ? 110 : 0;
        const previousAt = this.lastCueAt.get(name);
        if (minimumRepeatGap > 0 && previousAt !== undefined && now - previousAt < minimumRepeatGap) {
            return false;
        }
        this.lastCueAt.set(name, now);

        try {
            if (this.audio.context?.state === 'running' || typeof this.audio.unlock !== 'function') {
                return this.audio.play(name);
            }
            const unlock = this.audio.unlock();
            if (unlock && typeof unlock.then === 'function') {
                Promise.resolve(unlock).then(ready => {
                    if (ready && this.#isActive(context) && !this.audio.muted && this.audio.volume > 0) {
                        this.audio.play(name);
                    }
                }).catch(() => {});
                return true;
            }
            return this.audio.play(name);
        } catch {
            // Audio is an optional presentation layer; failures never stop replay.
            return false;
        }
    }

    #isActive(context) {
        return !!context && this.active === context && !context.cancelled;
    }

    cancel(context = this.active) {
        if (context && context !== this.active) return false;
        const hadActiveContext = this.active !== null;
        if (this.active) this.active.cancelled = true;
        this.active = null;
        if (hadActiveContext) {
            try { this.audio.stopAll?.(); } catch { /* Audio must not block replay. */ }
        }
        return hadActiveContext;
    }
}
