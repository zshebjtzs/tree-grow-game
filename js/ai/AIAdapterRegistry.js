// js/ai/AIAdapterRegistry.js
import { TreeGrowAIAdapter } from './TreeGrowAIAdapter.js';

/**
 * Maps game-mode identifiers to adapter constructors.
 * New modes register an adapter here without adding mode branches to the
 * shared controller or search engine.
 */
const ADAPTER_FACTORIES = Object.freeze({
    'tree-grow': options => new TreeGrowAIAdapter(options)
});

export const AI_MODES = Object.freeze(Object.keys(ADAPTER_FACTORIES));

export function createAIAdapter(mode = 'tree-grow', options = {}) {
    const createAdapter = ADAPTER_FACTORIES[mode];
    if (!createAdapter) {
        throw new TypeError(`AI 游戏模式无效: ${mode}`);
    }
    return createAdapter(options);
}
