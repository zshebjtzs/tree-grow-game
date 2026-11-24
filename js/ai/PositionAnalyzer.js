// js/ai/PositionAnalyzer.js
const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/**
 * Extracts deterministic spatial and strategic features from an immutable
 * TreeGrow position. It observes topology and injected rule-derived metrics;
 * it never creates or validates game actions.
 */
export class PositionAnalyzer {
    constructor({ adjacency, distanceToBase, getStructuralMetrics }) {
        this.adjacency = adjacency || {};
        this.distanceToBase = distanceToBase;
        this.getStructuralMetrics = getStructuralMetrics;
        this.cache = new WeakMap();
    }

    analyze(game, side, bases) {
        let bySide = this.cache.get(game);
        if (!bySide) {
            bySide = new Map();
            this.cache.set(game, bySide);
        }
        const enemy = side === 'red' ? 'blue' : 'red';
        const key = `${side}:${bases[side]}:${bases[enemy]}`;
        if (bySide.has(key)) return bySide.get(key);

        const ownNodes = game.getAliveNodesByOwner(side);
        const enemyNodes = game.getAliveNodesByOwner(enemy);
        const roots = game.getPlayerRootNodes(side);
        const occupied = new Map(game.getAliveNodes().map(node => [node.areaId, node.owner]));
        const frontierAreas = new Set();
        const contestedFrontierAreas = new Set();
        const enemyAreas = new Set(enemyNodes.map(node => node.areaId));

        for (const node of ownNodes) {
            for (const areaId of this.adjacency[node.areaId] || []) {
                if (!occupied.has(areaId)) frontierAreas.add(areaId);
                if (enemyAreas.has(areaId) ||
                    (this.adjacency[areaId] || []).some(next => enemyAreas.has(next))) {
                    contestedFrontierAreas.add(areaId);
                }
            }
        }

        let activeRoots = 0;
        let rootFrontierTotal = 0;
        const coordinatedFrontiers = new Set();
        for (const root of roots) {
            const queue = [root.id];
            const visited = new Set(queue);
            const rootFrontiers = new Set();
            for (let head = 0; head < queue.length; head++) {
                const node = game.getNode(queue[head]);
                if (!node) continue;
                for (const areaId of this.adjacency[node.areaId] || []) {
                    if (!occupied.has(areaId)) rootFrontiers.add(areaId);
                }
                for (const childId of node.childrenIds) {
                    if (visited.has(childId)) continue;
                    visited.add(childId);
                    queue.push(childId);
                }
            }
            if (rootFrontiers.size) activeRoots++;
            rootFrontierTotal += rootFrontiers.size;
            for (const areaId of rootFrontiers) coordinatedFrontiers.add(areaId);
        }

        const structural = this.getStructuralMetrics(game, side, bases);
        const ownDistance = this.distanceToBase(game, side, bases[enemy]);
        const incomingDistance = this.distanceToBase(game, enemy, bases[side]);
        const rootSafety = roots.length
            ? clamp01(1 - structural.unsafeRoots / roots.length)
            : 0;
        const frontierCoverage = rootFrontierTotal
            ? clamp01(coordinatedFrontiers.size / rootFrontierTotal)
            : 0;
        const multiRootCoordination = roots.length > 1
            ? clamp01((activeRoots / roots.length) * (0.5 + frontierCoverage * 0.5))
            : 0;
        const expansionPotential = clamp01(
            (structural.growthHeadroom + frontierAreas.size * 0.25) / 8
        );
        const frontierControl = clamp01(
            (contestedFrontierAreas.size + frontierAreas.size * 0.15) / 6
        );
        const defensivePressure = clamp01(
            (Number.isFinite(incomingDistance) ? Math.max(0, 5 - incomingDistance) / 5 : 0) +
            (roots.length ? structural.unsafeRoots / roots.length : 1) * 0.45 +
            structural.rootChainRisk * 0.04
        );
        const siegePressure = clamp01(
            (structural.siegeCount + (Number.isFinite(ownDistance) && ownDistance <= 3 ? 1 : 0)) / 4
        );
        const tacticalPressure = clamp01(
            (structural.baseThreatCount * 0.6 + structural.siegeCount * 0.25) / 3
        );

        const result = Object.freeze({
            side,
            ownNodeCount: ownNodes.length,
            enemyNodeCount: enemyNodes.length,
            rootCount: roots.length,
            activeRoots,
            frontierCount: frontierAreas.size,
            contestedFrontierCount: contestedFrontierAreas.size,
            rootSafety,
            frontierCoverage,
            multiRootCoordination,
            expansionPotential,
            frontierControl,
            defensivePressure,
            siegePressure,
            tacticalPressure,
            ownDistance,
            incomingDistance,
            structural
        });
        bySide.set(key, result);
        return result;
    }
}
