// js/game/RuleEngine.js
export class RuleEngine {
    constructor(mapManager) {
        this.mapManager = mapManager;
        // 直接使用经过 MapManager 阻断处理过的邻接表，确保规则绝对对齐
        this.adjacency = mapManager.adjacency || this._buildFallbackAdjacency();
    }

    // 原有的构建方法作为兜底
    _buildFallbackAdjacency() {
        const adj = {};
        const areas = this.mapManager.areas;
        const delaunay = this.mapManager.delaunay;
        areas.forEach((area, index) => {
            const id = area.id;
            adj[id] = [];
            const neighborIndices = delaunay.neighbors(index);
            for (const nIdx of neighborIndices) {
                if (areas[nIdx]) adj[id].push(areas[nIdx].id);
            }
        });
        return adj;
    }

    // 其他寻路、距离计算、canGrow 等方法完全保持原样，没有变化！
    getAreaPath(startAreaId, endAreaId) {
        if (startAreaId === endAreaId) return [startAreaId];
        const queue = [[startAreaId]];
        const visited = new Set([startAreaId]);

        while (queue.length > 0) {
            const path = queue.shift();
            const current = path[path.length - 1];
            const neighbors = this.adjacency[current] || [];
            for (const neighbor of neighbors) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    const newPath = [...path, neighbor];
                    if (neighbor === endAreaId) return newPath;
                    queue.push(newPath);
                }
            }
        }
        return null;
    }

    getPlayerOccupiedAreasCount(gameState, owner) {
        const nodes = gameState.getAliveNodesByOwner(owner);
        const areaSet = new Set();
        nodes.forEach(n => areaSet.add(n.areaId));
        return areaSet.size;
    }

    canGrow(gameState, parentNode, childAreaId) {
        // ... 保持你已有的原版逻辑不变，因为内部调用了 getAreaPath 和 adjacency ...
        if (gameState.isGameOver) return { allowed: false, reason: '游戏已结束' };
        if (!parentNode) return { allowed: false, reason: '请先选中一个父节点' };
        if (parentNode.owner !== gameState.currentTurn) return { allowed: false, reason: '不能操作对方的节点' };

        const startAreaId = parentNode.areaId;
        if (startAreaId === childAreaId) return { allowed: true };

        const path = this.getAreaPath(startAreaId, childAreaId);
        if (path === null) return { allowed: false, reason: '目标区域被地形隔绝，无法连通' };

        const distance = path.length - 1;
        const intermediateAreas = path.slice(1, -1);

        if (parentNode.isRoot && parentNode.childrenIds.length === 0) {
            const ownedCount = this.getPlayerOccupiedAreasCount(gameState, parentNode.owner);
            const maxAllowedDistance = Math.min(ownedCount, 2);
            if (distance <= maxAllowedDistance) return { allowed: true };
            return { allowed: false, reason: `根节点初生限制：当前最多只能跨越 ${maxAllowedDistance} 条黑线` };
        }

        if (distance > 1) {
            return { allowed: false, reason: `非法生长！只能穿过一条黑线到达下一个相邻区域，不能连穿两条线（试图穿越 ${distance} 条黑线）。` };
        }

        const allAliveNodes = gameState.getAliveNodes();
        const occupiedAreaSet = new Set();
        allAliveNodes.forEach(n => occupiedAreaSet.add(n.areaId));
        for (const areaId of intermediateAreas) {
            if (occupiedAreaSet.has(areaId)) {
                return { allowed: false, reason: `路径被己方或敌方的节点阻挡（区域 ${areaId} 已被占据），无法跨越！` };
            }
        }

        const rivalOwner = gameState.currentTurn === 'red' ? 'blue' : 'red';
        const rivalNodes = gameState.getAliveNodesByOwner(rivalOwner);
        for (const rNode of rivalNodes) {
            if (rNode.areaId === childAreaId && rNode.getDegree() > 3) {
                return { allowed: false, reason: `目标区域被敌方免疫堡垒（>3条连接）占据，不可进入！` };
            }
        }
        return { allowed: true };
    }
}