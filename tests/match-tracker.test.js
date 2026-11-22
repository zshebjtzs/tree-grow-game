import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchTracker } from '../js/game/MatchTracker.js';

const DIFFICULTIES = ['beginner', 'easy', 'medium', 'advanced', 'hard', 'expert'];

test('MatchTracker accepts all six supported AI difficulty levels', () => {
    for (const difficulty of DIFFICULTIES) {
        assert.doesNotThrow(() => new MatchTracker({ mode: 'pve', difficulty }), difficulty);
    }
});

test('MatchTracker serializes and restores all six supported AI difficulty levels', () => {
    for (const difficulty of DIFFICULTIES) {
        const tracker = new MatchTracker({ mode: 'pve', difficulty });
        const restored = MatchTracker.fromJSON(tracker.toJSON());
        assert.ok(restored, difficulty);
        assert.equal(restored.difficulty, difficulty);
    }
});

test('MatchTracker still rejects unsupported difficulty identifiers', () => {
    assert.throws(
        () => new MatchTracker({ mode: 'pve', difficulty: 'impossible' }),
        TypeError
    );
});
