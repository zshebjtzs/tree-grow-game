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
