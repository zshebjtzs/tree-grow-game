import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchTracker } from '../js/game/MatchTracker.js';
import { DIFFICULTY_LEVELS } from '../js/ai/DifficultyProfiles.js';

test('MatchTracker accepts all six supported AI difficulty levels', () => {
    for (const difficulty of DIFFICULTY_LEVELS) {
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
