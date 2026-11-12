import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasDrawer } from './CanvasDrawer.js';

function createFitDrawer() {
    const canvas = { width: 1800, height: 1200, style: {} };
    const drawer = Object.create(CanvasDrawer.prototype);
    drawer.canvas = canvas;
    drawer.logicalWidth = 1800;
    drawer.logicalHeight = 1200;
    drawer.zoom = 1;
    drawer.fitSize = null;
    return { drawer, canvas };
}

test('canvas display size fits the available viewport without changing logical resolution', () => {
    const { drawer, canvas } = createFitDrawer();
    const fit = drawer.fitToContainer({ clientWidth: 1000, clientHeight: 500 });
    assert.equal(fit.width, 750);
    assert.equal(fit.height, 500);
    assert.equal(canvas.width, 1800);
    assert.equal(canvas.height, 1200);
    assert.equal(canvas.style.width, '750px');
    assert.equal(canvas.style.height, '500px');
});

test('manual zoom scales display dimensions while preserving logical canvas dimensions', () => {
    const { drawer, canvas } = createFitDrawer();
    drawer.fitToContainer({ clientWidth: 1000, clientHeight: 500 });
    drawer.setZoom(1.2);
    assert.equal(canvas.style.width, '900px');
    assert.equal(canvas.style.height, '600px');
    assert.equal(canvas.width, 1800);
    assert.equal(canvas.height, 1200);
});

test('zoom is clamped to the supported range', () => {
    const { drawer } = createFitDrawer();
    assert.equal(drawer.setZoom(0.1), 0.5);
    assert.equal(drawer.setZoom(3), 2);
    assert.throws(() => drawer.setZoom(NaN), TypeError);
});
