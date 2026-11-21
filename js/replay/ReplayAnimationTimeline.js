import {
    GROWTH_ANIMATION_DURATION_MS,
    getCombatAnimationDurationMs
} from '../presentation/AnimationDurations.js';

function getNodes(snapshot) {
    const nodes = snapshot?.gameState?.nodes;
    if (!Array.isArray(nodes)) throw new TypeError('回放动画快照缺少节点数据');
    return nodes.filter(node => node && !node.isDestroyed);
}

function createPreCombatNodes(beforeNodes, addedNodes) {
    const nodes = beforeNodes.map(node => ({ ...node, childrenIds: [...node.childrenIds] }));
    const byId = new Map(nodes.map(node => [node.id, node]));
    for (const node of addedNodes) {
        if (!byId.has(node.id)) {
            nodes.push({ ...node, childrenIds: [...node.childrenIds] });
            byId.set(node.id, nodes[nodes.length - 1]);
        }
        const parent = byId.get(node.parentId);
        if (parent && !parent.childrenIds.includes(node.id)) parent.childrenIds.push(node.id);
    }
    return nodes;
}

/**
 * Derives presentation-only animation data from validated before/after
 * snapshots. It never executes or mutates game rules.
 */
export function createReplayAnimationTimeline(session, step) {
    if (!session || typeof session.getSnapshotViewAt !== 'function' ||
        typeof session.getTimelineEntryAt !== 'function' ||
        !Number.isInteger(step) || step < 1 || step > session.totalSteps) {
        throw new TypeError('创建回放动画时间线需要有效的行动步骤');
    }

    const entry = session.getTimelineEntryAt(step);
    const beforeSnapshot = session.getSnapshotViewAt(step - 1);
    const afterSnapshot = session.getSnapshotViewAt(step);
    const beforeNodes = getNodes(beforeSnapshot);
    const afterNodes = getNodes(afterSnapshot);
    const beforeById = new Map(beforeNodes.map(node => [node.id, node]));
    const afterById = new Map(afterNodes.map(node => [node.id, node]));
    const addedNodes = afterNodes.filter(node => !beforeById.has(node.id));
    const preCombatNodes = createPreCombatNodes(beforeNodes, addedNodes);
    const preCombatById = new Map(preCombatNodes.map(node => [node.id, node]));
    const segments = [];

    if (entry.action?.type === 'growth') {
        const node = afterById.get(entry.action.nodeId) ||
            addedNodes.find(candidate => candidate.owner === entry.side);
        const parent = node?.parentId == null ? null : preCombatById.get(node.parentId);
        if (node && parent) {
            segments.push(Object.freeze({
                type: 'growth',
                duration: GROWTH_ANIMATION_DURATION_MS,
                nodes: preCombatNodes,
                animationState: Object.freeze({
                    type: 'growth', nodeId: node.id, parentId: parent.id, progress: 0
                })
            }));
        }
    }

    const events = entry.events || [];
    const combat = events.find(event => event.type === 'COMBAT');
    if (combat) {
        const affectedNodes = beforeNodes.filter(node => !afterById.has(node.id));
        const allNodes = preCombatNodes;
        const allNodeById = new Map(allNodes.map(node => [node.id, node]));
        const attackerId = combat.attackerNodeId ?? entry.action?.nodeId;
        const defenderId = combat.defenderNodeId ??
            beforeNodes.find(node => node.owner !== entry.side &&
                node.areaId === entry.action?.targetAreaId)?.id;
        const freezeEvent = events.find(event => event.type === 'FREEZE');
        const freezeTargetId = combat.freezeTargetId ?? freezeEvent?.nodeId ?? null;
        const attacker = allNodeById.get(attackerId);
        const defender = allNodeById.get(defenderId);
        const freezeTarget = freezeTargetId == null ? null : allNodeById.get(freezeTargetId);

        // Freeze-only interactions have no destruction animation in the live
        // game; the frozen state is represented by the committed final snapshot.
        if (affectedNodes.length > 0 && attacker && defender) {
            const event = Object.freeze({
                type: 'combat',
                outcome: combat.outcome || 'combat',
                attacker,
                defender,
                freezeTarget: freezeTarget || null,
                affectedNodes: Object.freeze(affectedNodes),
                allNodes: Object.freeze(allNodes)
            });
            segments.push(Object.freeze({
                type: 'combat',
                duration: getCombatAnimationDurationMs(affectedNodes.length),
                nodes: allNodes,
                combatState: Object.freeze({ type: 'combat', event, progress: 0 })
            }));
        }
    }

    return Object.freeze({
        step,
        side: entry.side,
        action: entry.action,
        beforeSnapshot,
        afterSnapshot,
        segments: Object.freeze(segments)
    });
}
