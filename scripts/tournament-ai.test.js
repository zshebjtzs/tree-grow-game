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
