// js/game/CombatResolver.js
/**
 * Resolve a successful invasion into an enemy-occupied area.
 * The function only calculates the result; callers own animation and mutation.
 */
export function resolveCombat(gameState, invadingNode, defenderNode) {
    if (!gameState || !invadingNode || !defenderNode) {
        throw new TypeError('战斗结算需要有效的游戏状态、进攻节点和防守节点');
    }

    const getSubtreeIds = rootId => {
        const result = [];
        const visited = new Set();
        const stack = [rootId];
        while (stack.length > 0) {
            const id = stack.pop();
            if (visited.has(id)) continue;
            visited.add(id);
            const node = gameState.getNode(id);
            if (!node) continue;
            result.push(id);
            for (const childId of node.childrenIds) stack.push(childId);
        }
        return result;
    };

    // Find the nearest ancestor that is a branching point.
    let stopNode = null;
    let cursor = defenderNode;
    while (cursor) {
        if (cursor.childrenIds.length >= 2) {
            stopNode = cursor;
            break;
        }
        cursor = cursor.parentId === null ? null : gameState.getNode(cursor.parentId);
    }

    let nodesToDelete;
    let freezeTargetId = null;

    // A low-degree branching point loses its own branch; a fortress
    // (degree > 3) instead repels the invading node.
    if (defenderNode.childrenIds.length >= 2 && defenderNode.getDegree() <= 3) {
        nodesToDelete = getSubtreeIds(defenderNode.id);
    } else if (defenderNode.getDegree() > 3) {
        nodesToDelete = [invadingNode.id];
    } else {
        // Remove the defender-to-branch path and every descendant hanging
        // from that path. The branching point itself survives.
        nodesToDelete = [];
        cursor = defenderNode;
        while (cursor && (!stopNode || cursor.id !== stopNode.id)) {
            nodesToDelete.push(...getSubtreeIds(cursor.id));
            cursor = cursor.parentId === null ? null : gameState.getNode(cursor.parentId);
        }

        if (stopNode && !stopNode.isRoot && !nodesToDelete.includes(stopNode.id)) {
            freezeTargetId = stopNode.id;
        }
    }

    return {
        nodesToDelete: [...new Set(nodesToDelete)],
        freezeTargetId
    };
}
