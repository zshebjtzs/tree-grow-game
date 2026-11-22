const ownerLabel = owner => owner === 'red' ? '红方' : '蓝方';
const snapshot = node => ({ id:node.id,x:node.x,y:node.y,owner:node.owner,parentId:node.parentId,areaId:node.areaId,isRoot:node.isRoot,childrenIds:[...node.childrenIds] });

/** Presentation-only snapshot. Rule outcomes remain exclusively owned by CombatResolver. */
export function createCombatEvent(gameState, attacker, defender, result) {
    if (!gameState || !attacker || !defender || !result || !Array.isArray(result.nodesToDelete)) {
        throw new TypeError('战斗事件需要完整的规则结算结果');
    }
    if (defender.getDegree() > 3) {
        throw new Error('不能为堡垒节点创建战斗事件');
    }

    const deletedIds = new Set(result.nodesToDelete);
    const deletedRoot = gameState.getAliveNodes().find(node =>
        node.isRoot && node.owner === defender.owner && deletedIds.has(node.id)
    );
    const freezeTarget = result.freezeTargetId
        ? gameState.getNode(result.freezeTargetId) || null
        : null;

    let outcome, title, description;
    if (freezeTarget) {
        outcome = 'branch-cut';
        title = '目标枝被切断';
        description = `攻击沿父链追溯至最近的非根分叉点 #${freezeTarget.id}，目标枝及其后代被摧毁；该分叉点保留并进入冻结状态。`;
    } else if (deletedRoot) {
        outcome = 'tree-destroyed';
        title = '整棵防守树被摧毁';
        description = `攻击目标 #${defender.id} 沿父链回溯未找到其他可保留的非根分叉点，防守方根节点 #${deletedRoot.id} 及整棵树被摧毁。`;
    } else {
        // Defensive fallback for legacy or externally constructed results.
        outcome = 'branch-destroyed';
        title = '分叉节点被摧毁';
        description = `${ownerLabel(defender.owner)}的非堡垒分叉节点及其下游结构被摧毁。`;
    }

    const allNodes = gameState.getAliveNodes().map(snapshot);
    const byId = new Map(allNodes.map(node => [node.id, node]));
    const affectedNodes = result.nodesToDelete.map(id => byId.get(id)).filter(Boolean);
    const freezeSnapshot = freezeTarget ? byId.get(freezeTarget.id) || null : null;
    const meta = `摧毁节点：${affectedNodes.length} 个${freezeSnapshot ? ` · 冻结节点：#${freezeSnapshot.id}` : ''}`;

    return Object.freeze({
        type: 'combat',
        outcome,
        title,
        description,
        meta,
        attacker: Object.freeze(byId.get(attacker.id) || snapshot(attacker)),
        defender: Object.freeze(byId.get(defender.id) || snapshot(defender)),
        freezeTarget: freezeSnapshot ? Object.freeze(freezeSnapshot) : null,
        affectedNodes: Object.freeze(affectedNodes.map(node => Object.freeze(node))),
        allNodes: Object.freeze(allNodes.map(node => Object.freeze(node)))
    });
}
