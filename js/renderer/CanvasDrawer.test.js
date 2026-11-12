import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasDrawer } from './CanvasDrawer.js';

function createDrawer() {
    const calls = [];
    const styleChanges = [];
    const ctx = new Proxy({}, {
        get(target, property) {
            if (property in target) return target[property];
            if (property === 'calls') return calls;
            return (...args) => calls.push({ name: property, args });
        },
        set(target, property, value) {
            target[property] = value;
            styleChanges.push({ property, value });
            return true;
        }
    });
    const drawer = Object.create(CanvasDrawer.prototype);
    drawer.canvas = { width: 100, height: 100, getContext: () => ctx };
    drawer.ctx = ctx;
    return { drawer, calls, styleChanges };
}

test('frozen nodes receive an ice halo and snowflake badge', () => {
    const { drawer, calls } = createDrawer();
    drawer.renderNodes([{
        id: 1, x: 100, y: 100, owner: 'red',
        parentId: null, isDestroyed: false, isFrozen: true
    }]);
    const arcs = calls.filter(call => call.name === 'arc');
    assert.equal(arcs.length, 3, 'node, frost halo, and snowflake badge circles are drawn');
    assert.ok(calls.some(call => call.name === 'save'));
    assert.ok(calls.some(call => call.name === 'restore'));
    assert.ok(calls.some(call => call.name === 'stroke'));
});

test('unfrozen nodes keep their normal appearance without frost overlays', () => {
    const { drawer, calls } = createDrawer();
    drawer.renderNodes([{
        id: 1, x: 100, y: 100, owner: 'blue',
        parentId: null, isDestroyed: false, isFrozen: false
    }]);
    const arcs = calls.filter(call => call.name === 'arc');
    assert.equal(arcs.length, 1, 'only the normal node circle is drawn');
});


test('legal destination areas receive a translucent teal polygon overlay', () => {
    const { drawer, calls, styleChanges } = createDrawer();
    drawer.renderMap([{
        id: 1,
        vertices: [[0, 0], [80, 0], [80, 80], [0, 80]],
        center: [40, 40]
    }], 1, null, [], new Set([1]));

    assert.ok(styleChanges.some(change =>
        change.property === 'fillStyle' &&
        change.value === 'rgba(25, 178, 145, 0.30)'
    ));
    assert.equal(calls.filter(call => call.name === 'fill').length, 2,
        'the base fill and legal overlay are composited separately');
});

test('canvas display size fits the available viewport without changing logical resolution', () => {
    const canvas = { width: 1800, height: 1200, style: {} };
    const drawer = Object.create(CanvasDrawer.prototype);
    Object.assign(drawer, { canvas, logicalWidth: 1800, logicalHeight: 1200, zoom: 1, fitSize: null });
    const fit = drawer.fitToContainer({ clientWidth: 1000, clientHeight: 500 });
    assert.equal(fit.width, 750);
    assert.equal(fit.height, 500);
    assert.equal(canvas.width, 1800);
    assert.equal(canvas.height, 1200);
    assert.equal(canvas.style.width, '750px');
    assert.equal(canvas.style.height, '500px');
});

test('manual zoom scales display dimensions while preserving logical canvas dimensions', () => {
    const canvas = { width: 1800, height: 1200, style: {} };
    const drawer = Object.create(CanvasDrawer.prototype);
    Object.assign(drawer, { canvas, logicalWidth: 1800, logicalHeight: 1200, zoom: 1, fitSize: null });
    drawer.fitToContainer({ clientWidth: 1000, clientHeight: 500 });
    drawer.setZoom(1.2);
    assert.equal(canvas.style.width, '900px');
    assert.equal(canvas.style.height, '600px');
    assert.equal(canvas.width, 1800);
    assert.equal(canvas.height, 1200);
});

test('zoom is clamped to the supported range', () => {
    const drawer = Object.create(CanvasDrawer.prototype);
    Object.assign(drawer, { canvas: { style: {} }, zoom: 1, fitSize: null });
    assert.equal(drawer.setZoom(0.1), 0.5);
    assert.equal(drawer.setZoom(3), 2);
    assert.throws(() => drawer.setZoom(NaN), TypeError);
});


function createViewportDrawer() {
    const drawer = Object.create(CanvasDrawer.prototype);
    const classes = new Set();
    const canvas = {
        width: 1800, height: 1200, style: {},
        classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } },
        getBoundingClientRect() { return { left: 100, top: 50, width: 900, height: 600 }; }
    };
    Object.assign(drawer, {
        canvas, logicalWidth: 1800, logicalHeight: 1200, zoom: 1,
        fitSize: null, container: null, offsetX: 0, offsetY: 0, mode: 'locked'
    });
    return { drawer, canvas, classes };
}

test('viewport pan is bounded and reflected in the canvas transform', () => {
    const { drawer, canvas } = createViewportDrawer();
    drawer.fitToContainer({ clientWidth: 1000, clientHeight: 500 });
    drawer.setZoom(2);
    const pan = drawer.setPan(10000, -10000);
    assert.deepEqual(pan, { x: 322, y: -322 });
    assert.equal(canvas.style.transform, 'translate3d(322px, -322px, 0px)');
});

test('resetViewport restores default zoom and centered position', () => {
    const { drawer, canvas } = createViewportDrawer();
    drawer.fitToContainer({ clientWidth: 1000, clientHeight: 500 });
    drawer.setZoom(1.6);
    drawer.setPan(100, -80);
    drawer.resetViewport();
    assert.equal(drawer.zoom, 1);
    assert.equal(drawer.offsetX, 0);
    assert.equal(drawer.offsetY, 0);
    assert.equal(canvas.style.transform, 'translate3d(0px, 0px, 0px)');
});

test('screen coordinates map back to the unchanged logical canvas coordinates', () => {
    const { drawer } = createViewportDrawer();
    const point = drawer.getLogicalPoint(550, 350);
    assert.deepEqual(point, { x: 900, y: 600 });
});

test('viewport mode toggles the pan cursor state without changing game data', () => {
    const { drawer, classes } = createViewportDrawer();
    assert.equal(drawer.isLocked, true);
    drawer.setMode('unlocked');
    assert.equal(drawer.isLocked, false);
    assert.ok(classes.has('is-pan-mode'));
    drawer.setMode('locked');
    assert.equal(drawer.isLocked, true);
    assert.ok(!classes.has('is-pan-mode'));
    assert.throws(() => drawer.setMode('dragging'), TypeError);
});

test('resizing the viewport recalculates fit while preserving the current zoom level', () => {
    const { drawer, canvas } = createViewportDrawer();
    drawer.fitToContainer({ clientWidth: 1000, clientHeight: 500 });
    drawer.setZoom(1.2);
    drawer.fitToContainer({ clientWidth: 800, clientHeight: 600 });
    assert.equal(drawer.zoom, 1.2);
    assert.equal(canvas.style.width, '720px');
    assert.equal(canvas.style.height, '480px');
});
