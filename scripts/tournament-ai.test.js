import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('AI tournament CLI loads and documents the legacy baseline option without starting matches', () => {
    const result = spawnSync(
        process.execPath,
        ['scripts/tournament-ai.js', '--help'],
        { encoding: 'utf8' }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('Usage: node scripts/tournament-ai.js'));
    assert.ok(result.stdout.includes('--baseline-controller'));
});


test('production map inspection is deterministic and creates the live three-root setup', () => {
    const run = () => spawnSync(
        process.execPath,
        ['scripts/tournament-ai.js', '--inspect-map', '20261122'],
        { encoding: 'utf8' }
    );
    const first = run();
    const second = run();

    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(JSON.parse(first.stdout), JSON.parse(second.stdout));

    const map = JSON.parse(first.stdout);
    assert.equal(map.generator, 'voronoi-lloyd');
    assert.equal(map.areaCount, 50);
    assert.ok(map.portalCount > 0);
    assert.equal(map.redRoots, 3);
    assert.equal(map.blueRoots, 3);
});
