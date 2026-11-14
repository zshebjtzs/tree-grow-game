import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioController } from '../js/presentation/AudioController.js';

function createFakeContext() {
    const calls = [];
    const makeParam = () => ({
        value: 1,
        setValueAtTime(value, time) { calls.push(['set', value, time]); },
        exponentialRampToValueAtTime(value, time) { calls.push(['ramp', value, time]); },
        setTargetAtTime(value, time, constant) { calls.push(['target', value, time, constant]); }
    });
    const context = {
        state: 'suspended', currentTime: 1, destination: {},
        createGain() { return { gain: makeParam(), connect() {} }; },
        createOscillator() {
            return {
                type: '', frequency: makeParam(), connect() {},
                start(time) { calls.push(['start', time]); },
                stop(time) { calls.push(['stop', time]); }
            };
        },
        async resume() { this.state = 'running'; },
        async close() { this.state = 'closed'; }
    };
    return { context, calls };
}

test('audio context is created lazily and resumes only when unlocked', async () => {
    let creations = 0;
    const fake = createFakeContext();
    const audio = new AudioController({ contextFactory: () => { creations++; return fake.context; } });
    assert.equal(creations, 0);
    assert.equal(audio.play('growth'), false);
    assert.equal(await audio.unlock(), true);
    assert.equal(creations, 1);
    assert.equal(fake.context.state, 'running');
    assert.equal(audio.play('growth'), true);
    assert.ok(fake.calls.some(call => call[0] === 'start'));
});

test('mute and zero volume suppress playback without disabling the controller', async () => {
    const fake = createFakeContext();
    const audio = new AudioController({ contextFactory: () => fake.context });
    await audio.unlock();
    audio.setMuted(true);
    assert.equal(audio.play('turn'), false);
    audio.setMuted(false);
    audio.setVolume(0);
    assert.equal(audio.play('turn'), false);
    audio.setVolume(0.6);
    assert.equal(audio.play('turn'), true);
});

test('unsupported audio and invalid sound names fail silently', async () => {
    const audio = new AudioController({ contextFactory: () => null });
    assert.equal(await audio.unlock(), false);
    assert.equal(audio.play('not-a-sound'), false);
    assert.equal(audio.play('growth'), false);
});

test('volume is clamped and destroy prevents future playback', async () => {
    const fake = createFakeContext();
    const audio = new AudioController({ contextFactory: () => fake.context });
    await audio.unlock();
    audio.setVolume(4);
    assert.equal(audio.volume, 1);
    audio.destroy();
    assert.equal(audio.play('victory'), false);
});
