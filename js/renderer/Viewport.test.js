import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCanvasFit, clampPanOffset, calculateZoomOffset } from './Viewport.js';

test('fits a complete 3:2 map inside a landscape viewport', () => {
    const fit = calculateCanvasFit(1200, 620);
    assert.ok(fit.width <= 1200 && fit.height <= 620);
    assert.ok(Math.abs(fit.width / fit.height - 1.5) < 0.01);
});
test('height-constrained layouts preserve aspect ratio', () => {
    assert.deepEqual(calculateCanvasFit(1600, 500), { width: 750, height: 500, scale: 0.4166666666666667 });
});
test('width-constrained layouts preserve aspect ratio', () => {
    const fit = calculateCanvasFit(900, 900);
    assert.equal(fit.width, 900); assert.equal(fit.height, 600);
});
test('hidden zero-sized containers return a safe fit', () => {
    assert.deepEqual(calculateCanvasFit(0, 0), { width: 0, height: 0, scale: 0 });
});
test('invalid dimensions are rejected', () => {
    assert.throws(() => calculateCanvasFit(-1, 300), TypeError);
    assert.throws(() => calculateCanvasFit(300, Infinity), TypeError);
});
test('pan offsets are centered when the map fits and bounded when oversized', () => {
    assert.equal(clampPanOffset(120, 500, 700), 0);
    assert.equal(clampPanOffset(10000, 1800, 800), 572);
    assert.equal(clampPanOffset(-10000, 1800, 800), -572);
});
test('zoom keeps the world point under the chosen anchor stationary', () => {
    const next = calculateZoomOffset(30, 120, 1, 1.5);
    assert.equal(next, -15);
    assert.equal((120 - next) / 1.5, (120 - 30) / 1);
});
test('invalid pan and zoom transforms are rejected', () => {
    assert.throws(() => clampPanOffset(NaN, 100, 50), TypeError);
    assert.throws(() => calculateZoomOffset(0, 0, 0, 1), TypeError);
});
