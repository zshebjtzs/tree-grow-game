import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_MODES, createAIAdapter } from './AIAdapterRegistry.js';
import { getDifficultyProfile } from './DifficultyProfiles.js';
import { TreeGrowAIAdapter } from './TreeGrowAIAdapter.js';

test('AI adapter registry exposes the current TreeGrow mode', () => {
    assert.deepEqual(AI_MODES, ['tree-grow']);
    const adapter = createAIAdapter('tree-grow', {
        adjacency: { 1: [2], 2: [1] },
        areaCenters: [[0, 0], [10, 0]],
        profile: getDifficultyProfile('easy')
    });
    assert.ok(adapter instanceof TreeGrowAIAdapter);
});

test('AI adapter registry rejects unregistered game modes', () => {
    assert.throws(() => createAIAdapter('quick'), /AI 游戏模式无效/);
    assert.throws(() => createAIAdapter('campaign'), /AI 游戏模式无效/);
});
