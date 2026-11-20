import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTimelineWindow } from '../js/replay/ReplayTimelineWindow.js';

test('returns all rows for a short timeline', () => {
    assert.deepEqual(computeTimelineWindow(12, 0, 600, 44, 2), { start: 0, end: 12, top: 0, bottom: 0 });
});
test('keeps rendered rows bounded for a 100,000-step timeline', () => {
    const result = computeTimelineWindow(100001, 44 * 50000, 440, 44, 6);
    assert.equal(result.start, 49994);
    assert.equal(result.end, 50016);
    assert.equal(result.top, 49994 * 44);
    assert.equal(result.bottom, (100001 - 50016) * 44);
    assert.ok(result.end - result.start <= 30);
});
test('clamps negative scroll and end-of-list ranges', () => {
    assert.deepEqual(computeTimelineWindow(100, -20, 88, 44, 1), { start: 0, end: 3, top: 0, bottom: 97 * 44 });
    assert.equal(computeTimelineWindow(100, 100000, 88, 44, 1).bottom, 0);
});
test('rejects invalid window parameters', () => {
    assert.throws(() => computeTimelineWindow(-1, 0, 100), /参数无效/);
    assert.throws(() => computeTimelineWindow(10, 0, 100, 0), /参数无效/);
});
