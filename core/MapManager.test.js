import test from 'node:test';
import assert from 'node:assert/strict';
import { MapManager } from './MapManager.js';

test('loadMapFromSeeds rejects invalid, out-of-bounds, and duplicate seeds', () => {
    const manager = new MapManager(100, 80);
    assert.throws(() => manager.loadMapFromSeeds([[10, 10]]), /至少/);
    assert.throws(() => manager.loadMapFromSeeds([[10, 10], [NaN, 20]]), /有限坐标/);
    assert.throws(() => manager.loadMapFromSeeds([[10, 10], [101, 20]]), /有限坐标/);
    assert.throws(() => manager.loadMapFromSeeds([[10, 10], [10, 10]]), /不能重复/);
});

test('loadMapFromSeeds accepts valid seeds and builds matching areas', () => {
    const manager = new MapManager(100, 80);
    const areas = manager.loadMapFromSeeds([[20, 20], [80, 20], [50, 65]]);
    assert.equal(areas.length, 3);
    assert.deepEqual(manager.seeds, [[20, 20], [80, 20], [50, 65]]);
});
