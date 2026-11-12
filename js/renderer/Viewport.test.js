import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCanvasFit } from './Viewport.js';

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
