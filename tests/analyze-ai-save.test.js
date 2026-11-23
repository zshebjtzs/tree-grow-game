import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('historical AI save analyzer exposes CLI help without loading a save', () => {
    const result = spawnSync(
        process.execPath,
        ['scripts/analyze-ai-save.js', '--help'],
        { encoding: 'utf8' }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('Usage: node scripts/analyze-ai-save.js'));
    assert.ok(result.stdout.includes('--baseline-controller'));
    assert.ok(result.stdout.includes('--output <file.json>'));
});
