// js/game/RuleEngine.js
export class RuleEngine {
    constructor(mapManager) {
        this.mapManager = mapManager;
        this.adjacency = mapManager.adjacency || {};
    }

    getAreaPath(startAreaId, endAreaId, blockedAreas = null) {
        if (startAreaId === endAreaId) return [startAreaId];
        if (!this.adjacency[startAreaId]) return null;
        const queue = [startAreaId];
        const previous = new Map([[startAreaId, null]]);
        for (let head = 0; head < queue.length; head++) {
            const current = queue[head];
            for (const neighbor of this.adjacency[current] || []) {
                if (previous.has(neighbor)) continue;
                if (blockedAreas?.has(neighbor) && neighbor !== endAreaId) continue;
                previous.set(neighbor, current);
                if (neighbor === endAreaId) {
                    const path = [];
                    let cursor = endAreaId;
                    while (cursor !== null) {
                        path.push(cursor);
                        cursor = previous.get(cursor);
                    }
                    return path.reverse();
                }
                queue.push(neighbor);
            }
        }
        return null;
    }

    getPlayerOccupiedAreasCount(gameState, owner) {
        return new Set(gameState.getAliveNodesByOwner(owner).map(node => node.areaId)).size;
    }

    getLegalGrowthAreas(gameState, parentNode, areaIds, options = {}) {
        if (!Array.isArray(areaIds)) {
            throw new TypeError('areaIds 必须是区域 ID 数组');
        }
        return areaIds.filter(areaId =>
            this.canGrow(gameState, parentNode, areaId, options).allowed
        );
    }

    canGrow(gameState, parentNode, childAreaId, options = {}) {
        const { ownBaseId = null, enemyBaseId = null } = options;
        if (gameState.isGameOver) return { allowed: false, reason: '游戏已结束' };
        if (!parentNode || gameState.getNode(parentNode.id) !== parentNode || parentNode.isDestroyed) {
            return { allowed: false, reason: '父节点不存在或已被摧毁' };
        }
        if (parentNode.owner !== gameState.currentTurn) return { allowed: false, reason: '不能操作对方的节点' };
        if (parentNode.isFrozen) return { allowed: false, reason: '该节点本回合被冻结' };
        if (parentNode.isRoot && parentNode.childrenIds.length > 0) {
            return { allowed: false, reason: '根节点只能生长第一根枝条，不能再次分叉' };
        }
        if (!Number.isInteger(childAreaId) || childAreaId < 1) {
            return { allowed: false, reason: '目标区域无效' };
        }
        if (ownBaseId !== null && childAreaId === ownBaseId) {
            return { allowed: false, reason: '禁止向己方基地生长' };
        }
        if (parentNode.areaId === childAreaId) return { allowed: false, reason: '不能在同一区域生长' };

        const occupied = new Set(gameState.getAliveNodes().map(node => node.areaId));
        // Find a legal route, not merely the graph's first shortest route:
        // another equally short route may avoid occupied intermediate cells.
        const blockedIntermediates = new Set(occupied);
        blockedIntermediates.delete(parentNode.areaId);
        blockedIntermediates.delete(childAreaId);
        const path = this.getAreaPath(parentNode.areaId, childAreaId, blockedIntermediates);
        if (!path) return { allowed: false, reason: '目标区域与父节点不连通，或所有可用路径均经过已占据区域' };
        const distance = path.length - 1;

        const isFirstRootBranch = parentNode.isRoot && parentNode.childrenIds.length === 0;
        if (isFirstRootBranch) {
            const ownedCount = this.getPlayerOccupiedAreasCount(gameState, parentNode.owner);
            const maxDistance = Math.min(ownedCount, 2);
            if (distance > maxDistance) {
                return { allowed: false, reason: `根节点第一枝最多跨越 ${maxDistance} 条边` };
            }
        } else if (distance !== 1) {
            return { allowed: false, reason: '普通生长必须进入共享边界直接相邻的区域' };
        }

        // Enemy fortresses are valid attack targets. Combat resolution handles
        // their immunity by destroying the invading node; rejecting growth here
        // made that battle branch unreachable.
        const enemyNode = gameState.getAliveNodes().find(node =>
            node.owner !== parentNode.owner && node.areaId === childAreaId
        );
        if (enemyNode && enemyNode.getDegree() > 3) {
            return { allowed: false, reason: '堡垒节点不能作为攻击目标' };
        }

        const targetOwn = gameState.getAliveNodesByOwner(parentNode.owner).some(node => node.areaId === childAreaId);
        if (targetOwn && childAreaId !== enemyBaseId) {
            return { allowed: false, reason: '己方普通区域只能有一个节点' };
        }
        return { allowed: true, path };
    }
}
