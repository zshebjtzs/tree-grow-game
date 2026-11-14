const SOUND_PRESETS = Object.freeze({
    growth:  [{ frequency: 440, duration: 0.055, offset: 0 }, { frequency: 660, duration: 0.075, offset: 0.045 }],
    combat:  [{ frequency: 220, duration: 0.11, offset: 0 }, { frequency: 165, duration: 0.13, offset: 0.075 }],
    destroy: [{ frequency: 185, duration: 0.12, offset: 0 }, { frequency: 110, duration: 0.16, offset: 0.07 }],
    freeze:  [{ frequency: 620, duration: 0.07, offset: 0 }, { frequency: 880, duration: 0.10, offset: 0.065 }],
    turn:    [{ frequency: 520, duration: 0.07, offset: 0 }],
    victory: [{ frequency: 523, duration: 0.12, offset: 0 }, { frequency: 659, duration: 0.12, offset: 0.105 }, { frequency: 784, duration: 0.2, offset: 0.21 }],
    pause:   [{ frequency: 330, duration: 0.07, offset: 0 }],
    resume:  [{ frequency: 440, duration: 0.07, offset: 0 }]
});

/**
 * Optional presentation-only audio. No audio assets or network requests are required.
 * The context is created only after a user gesture; unsupported browsers degrade silently.
 */
export class AudioController {
    constructor({ contextFactory = () => {
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        return Context ? new Context() : null;
    } } = {}) {
        this.contextFactory = contextFactory;
        this.context = null;
        this.masterGain = null;
        this.muted = false;
        this.volume = 0.32;
        this.destroyed = false;
    }

    async unlock() {
        if (this.destroyed) return false;
        try {
            if (!this.context) {
                this.context = this.contextFactory();
                if (!this.context) return false;
                this.masterGain = this.context.createGain();
                this.masterGain.gain.value = this.muted ? 0 : this.volume;
                this.masterGain.connect(this.context.destination);
            }
            if (this.context.state === 'suspended' && typeof this.context.resume === 'function') {
                await this.context.resume();
            }
            return this.context.state !== 'closed';
        } catch {
            return false;
        }
    }

    setMuted(muted) {
        this.muted = Boolean(muted);
        this.#syncGain();
    }

    setVolume(volume) {
        const numeric = Number(volume);
        if (!Number.isFinite(numeric)) return;
        this.volume = Math.min(1, Math.max(0, numeric));
        this.#syncGain();
    }

    #syncGain() {
        if (!this.masterGain || !this.context) return;
        const value = this.muted ? 0 : this.volume;
        const now = this.context.currentTime || 0;
        if (typeof this.masterGain.gain.setTargetAtTime === 'function') {
            this.masterGain.gain.setTargetAtTime(value, now, 0.025);
        } else {
            this.masterGain.gain.value = value;
        }
    }

    play(name) {
        const preset = SOUND_PRESETS[name];
        if (!preset || this.destroyed || this.muted || this.volume <= 0 || !this.context ||
            this.context.state !== 'running' || !this.masterGain) return false;
        const now = this.context.currentTime || 0;
        try {
            for (const note of preset) {
                const oscillator = this.context.createOscillator();
                const envelope = this.context.createGain();
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(note.frequency, now + note.offset);
                envelope.gain.setValueAtTime(0.0001, now + note.offset);
                envelope.gain.exponentialRampToValueAtTime(0.16, now + note.offset + 0.012);
                envelope.gain.exponentialRampToValueAtTime(0.0001, now + note.offset + note.duration);
                oscillator.connect(envelope);
                envelope.connect(this.masterGain);
                oscillator.start(now + note.offset);
                oscillator.stop(now + note.offset + note.duration + 0.01);
            }
            return true;
        } catch {
            return false;
        }
    }

    destroy() {
        this.destroyed = true;
        if (this.context && typeof this.context.close === 'function') {
            try { this.context.close(); } catch { /* Audio is optional. */ }
        }
        this.context = null;
        this.masterGain = null;
    }
}
