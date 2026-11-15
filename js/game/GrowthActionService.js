/**
 * Shared authoritative entry point for player, AI, and tutorial growth actions.
 *
 * This module owns action validation and the GameState mutation only.
 * Animation, sound, turn switching, and UI feedback remain caller concerns.
 */
export function executeGrowthAction({
    gameState,
    ruleEngine,
    mapAreas,
    parentNodeId,
    targetAreaId,
    owner,
    ownBaseId = null,
    enemyBaseId = null
}) {
    if (!gameState || !ruleEngine || !Array.isArray(mapAreas)) {
        throw new TypeError('生长行动需要有效的游戏状态、规则引擎和地图区域');
    }

    if (!['red', 'blue'].includes(owner)) {
        return { ok: false, reason: '行动方无效' };
    }
    if (gameState.isGameOver) {
        return { ok: false, reason: '游戏已结束' };
    }
    if (gameState.currentTurn !== owner) {
        return { ok: false, reason: '当前不是该玩家的回合' };
    }

    const parentNode = gameState.getNode(parentNodeId);
    const targetArea = mapAreas.find(area => area.id === targetAreaId);
    if (!targetArea || !Array.isArray(targetArea.center) ||
        !Number.isFinite(targetArea.center[0]) || !Number.isFinite(targetArea.center[1])) {
        return { ok: false, reason: '目标区域不存在或坐标无效' };
    }

    const validation = ruleEngine.canGrow(gameState, parentNode, targetAreaId, {
        ownBaseId,
        enemyBaseId
    });
    if (!validation.allowed) {
        return { ok: false, reason: validation.reason };
    }

    const isAttack = targetAreaId !== enemyBaseId &&
        gameState.getAliveNodes().some(node =>
            node.owner !== owner && node.areaId === targetAreaId
        );

    const node = gameState.addNode(
        parentNode.id,
        targetArea.center[0],
        targetArea.center[1],
        targetAreaId,
        owner
    );
    if (!node) {
        return { ok: false, reason: '规则验证通过，但无法创建新节点' };
    }

    return {
        ok: true,
        node,
        action: {
            type: 'growth',
            owner,
            parentNodeId: parentNode.id,
            targetAreaId,
            nodeId: node.id,
            isAttack,
            path: [...validation.path]
        }
    };
}
