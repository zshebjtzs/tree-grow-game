export const GROWTH_ANIMATION_DURATION_MS = 280;
export const COMBAT_BASE_DURATION_MS = 620;
export const COMBAT_NODE_DURATION_MS = 70;
export const COMBAT_MAX_DURATION_MS = 1050;

export function getCombatAnimationDurationMs(affectedNodeCount) {
    if (!Number.isInteger(affectedNodeCount) || affectedNodeCount < 0) {
        throw new TypeError('战斗动画节点数量必须是非负整数');
    }
    return Math.min(
        COMBAT_MAX_DURATION_MS,
        COMBAT_BASE_DURATION_MS + affectedNodeCount * COMBAT_NODE_DURATION_MS
    );
}
