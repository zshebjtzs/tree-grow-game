// js/game/RuleEngine.js
export class RuleEngine {
    constructor(mapManager) {
        this.mapManager = mapManager;
        this.adjacency = mapManager.adjacency || {};
    }

    getAreaPath(startAreaId, endAreaId) {
        if (startAreaId === endAreaId) return [startAreaId];
        if (!this.adjacency[startAreaId] || !this.adjacency[endAreaId]) return null;
        const queue = [startAreaId];
        const previous = new Map([[startAreaId, null]]);
        for (let head = 0; head < queue.length; head++) {
            const current = queue[head];
            for (const neighbor of this.adjacency[current] || []) {
                if (previous.has(neighbor)) continue;
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
        if (!Number.isInteger(childAreaId) || !this.adjacency[childAreaId]) {
            return { allowed: false, reason: '目标区域无效' };
        }
        if (ownBaseId !== null && childAreaId === ownBaseId) {
            return { allowed: false, reason: '禁止向己方基地生长' };
        }
        if (parentNode.areaId === childAreaId) return { allowed: false, reason: '不能在同一区域生长' };

        const path = this.getAreaPath(parentNode.areaId, childAreaId);
        if (!path) return { allowed: false, reason: '目标区域与父节点不连通' };
        const distance = path.length - 1;
        const occupied = new Set(gameState.getAliveNodes().map(node => node.areaId));
        const intermediate = path.slice(1, -1);
        if (intermediate.some(areaId => occupied.has(areaId))) {
            return { allowed: false, reason: '路径经过已被节点占据的区域' };
        }

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

        const enemyOwner = parentNode.owner === 'red' ? 'blue' : 'red';
        const targetEnemy = gameState.getAliveNodesByOwner(enemyOwner).find(node => node.areaId === childAreaId);
        if (targetEnemy && targetEnemy.getDegree() > 3) {
            return { allowed: false, reason: '目标区域被敌方免疫堡垒占据' };
        }
        const targetOwn = gameState.getAliveNodesByOwner(parentNode.owner).some(node => node.areaId === childAreaId);
        if (targetOwn && childAreaId !== enemyBaseId) {
            return { allowed: false, reason: '己方普通区域只能有一个节点' };
        }
        return { allowed: true, path };
    }
}
