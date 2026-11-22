// js/game/CombatResolver.js
/**
 * Resolve a successful invasion into an enemy-occupied area.
 * The function only calculates the result; callers own animation and mutation.
 */
export function resolveCombat(gameState, invadingNode, defenderNode) {
    if (!gameState || !invadingNode || !defenderNode) {
        throw new TypeError('战斗结算需要有效的游戏状态、进攻节点和防守节点');
    }

    if (defenderNode.getDegree() > 3) {
        throw new Error('堡垒节点不能作为攻击目标');
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

    // The attacked node itself is never a stopping point, even when it is
    // a branching point. Only an ancestor branching node can protect its
    // other child branches.
    let stopNode = null;
    let cursor = defenderNode.parentId === null
        ? null
        : gameState.getNode(defenderNode.parentId);
    while (cursor) {
        if (!cursor.isRoot && cursor.childrenIds.length >= 2) {
            stopNode = cursor;
            break;
        }
        cursor = cursor.parentId === null
            ? null
            : gameState.getNode(cursor.parentId);
    }

    // Delete the attacked subtree and each path segment up to (but not
    // including) the nearest ancestor branching point. If none exists,
    // the walk reaches the root and deletes the complete defending tree.
    const nodesToDelete = [];
    cursor = defenderNode;
    while (cursor && (!stopNode || cursor.id !== stopNode.id)) {
        nodesToDelete.push(...getSubtreeIds(cursor.id));
        cursor = cursor.parentId === null
            ? null
            : gameState.getNode(cursor.parentId);
    }

    return {
        nodesToDelete: [...new Set(nodesToDelete)],
        freezeTargetId: stopNode ? stopNode.id : null
    };
}
