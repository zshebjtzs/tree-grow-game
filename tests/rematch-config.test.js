import test from 'node:test';
import assert from 'node:assert/strict';
import { createRematchConfig } from '../js/app/RematchConfig.js';

test('rematch preserves PVP configuration as a fresh immutable snapshot', () => {
    const previous = Object.freeze({ mode: 'pvp', difficulty: 'medium', playerSide: 'red' });
    const next = createRematchConfig(previous);
    assert.deepEqual(next, previous);
    assert.notEqual(next, previous);
    assert.equal(Object.isFrozen(next), true);
});

test('rematch preserves PVE mode and AI difficulty', () => {
    assert.deepEqual(createRematchConfig({ mode: 'pve', difficulty: 'hard', playerSide: 'red' }), {
        mode: 'pve', difficulty: 'hard', playerSide: 'red'
    });
});

test('rematch rejects incomplete or invalid configuration', () => {
    assert.throws(() => createRematchConfig(null), TypeError);
    assert.throws(() => createRematchConfig({ mode: 'pve', difficulty: 'expert', playerSide: 'red' }), TypeError);
    assert.throws(() => createRematchConfig({ mode: 'pvp', difficulty: 'easy', playerSide: 'blue' }), TypeError);
});
