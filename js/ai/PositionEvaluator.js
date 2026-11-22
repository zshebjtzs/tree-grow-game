// js/ai/PositionEvaluator.js
const WIN_SCORE = 100000;

/**
 * Scores positions from one player's perspective.
 * Rule simulation remains injected from AIController so this module never
 * duplicates growth, combat, freeze, or turn-transition rules.
 */
export class PositionEvaluator {
    constructor({ adjacency, distanceToBase, softDistanceToBase, getGrowthMetrics, simulateMove, profile }) {
        this.adjacency = adjacency || {};
        this.distanceToBase = distanceToBase;
        this.softDistanceToBase = softDistanceToBase;
        this.getGrowthMetrics = getGrowthMetrics;
        this.metricsCache = new WeakMap();
        this.simulateMove = simulateMove;
        this.profile = profile;
    }

    scoreMove(game, move, side, bases, simulatedNext = null) {
        const enemy = side === 'red' ? 'blue' : 'red';
        if (move.targetAreaId === bases[enemy]) return WIN_SCORE;

        const beforeDistance = this.distanceToBase(game, side, bases[enemy]);
        const next = simulatedNext || this.simulateMove(game, move, side, bases);
        if (!next) return -WIN_SCORE;
        if (next.isGameOver) {
            return next.getPlayerRootNodes(side).length ? WIN_SCORE : -WIN_SCORE;
        }

        const afterDistance = this.distanceToBase(next, side, bases[enemy]);
        const progress = Number.isFinite(beforeDistance) && Number.isFinite(afterDistance)
            ? beforeDistance - afterDistance
            : (Number.isFinite(afterDistance) ? 1 : 0);

        const profile = this.profile;
        let score = progress * 95 * profile.progressWeight;
        if (move.attacks) {
            const beforeEnemyNodes = game.getAliveNodesByOwner(enemy).length;
            const afterEnemyNodes = next.getAliveNodesByOwner(enemy).length;
            score += (beforeEnemyNodes - afterEnemyNodes) * 85 * profile.attackWeight;
            const beforeRoots = game.getPlayerRootNodes(enemy).length;
            const afterRoots = next.getPlayerRootNodes(enemy).length;
            score += (beforeRoots - afterRoots) * 900 * profile.rootAttackWeight;
        }

        const ownAreaGain = next.getAliveNodesByOwner(side).length -
            game.getAliveNodesByOwner(side).length;
        score += ownAreaGain * 8 * profile.expansionWeight;

        const ownThreat = this.distanceToBase(next, enemy, bases[side]);
        if (Number.isFinite(ownThreat)) score -= Math.max(0, 5 - ownThreat) * 24 * profile.safetyWeight;

        // Structural value: preserve branching flexibility and avoid leaving
        // the newly created frontier as an isolated, immediately vulnerable leaf.
        const newNode = next.getAliveNodes().find(node =>
            node.owner === side && node.areaId === move.targetAreaId
        );
        if (newNode) {
            const parent = next.getNode(newNode.parentId);
            if (parent && parent.childrenIds.length >= 2) score += 10 * profile.branchingWeight;
            if (parent && parent.isRoot) score += 6 * profile.structureWeight;
        }
        return score;
    }

    getStructuralMetrics(game, side, bases) {
        const enemy = side === 'red' ? 'blue' : 'red';
        let cache = this.metricsCache.get(game);
        if (!cache) {
            cache = new Map();
            this.metricsCache.set(game, cache);
        }
        const cacheKey = `${side}:${bases[side]}:${bases[enemy]}`;
        if (cache.has(cacheKey)) return cache.get(cacheKey);

        let unsafeRoots = 0;
        let rootChainRisk = 0;
        for (const root of game.getPlayerRootNodes(side)) {
            const firstChild = root.childrenIds
                .map(childId => game.getNode(childId))
                .find(Boolean);
            if (!firstChild || firstChild.getDegree() <= 3) {
                unsafeRoots++;
                let cursor = firstChild;
                const visited = new Set();
                while (cursor && !visited.has(cursor.id)) {
                    visited.add(cursor.id);
                    rootChainRisk++;
                    if (cursor.childrenIds.length !== 1) break;
                    cursor = game.getNode(cursor.childrenIds[0]);
                }
            }
        }

        const growth = this.getGrowthMetrics(game, side, bases);
        let siegePreFortressCount = 0;
        let siegeFortressCount = 0;
        const enemyBaseId = bases[enemy];
        for (const node of game.getAliveNodesByOwner(side)) {
            if (!(this.adjacency[node.areaId] || []).includes(enemyBaseId)) continue;
            if (node.getDegree() > 3) {
                siegeFortressCount++;
            } else if (node.getDegree() === 3 && growth.growthParentIds.has(node.id)) {
                siegePreFortressCount++;
            }
        }

        // Soft distance is only a fallback when the hard legal route is blocked.
        // Keep it lazy so ordinary reachable positions avoid an unnecessary Dijkstra pass.
        const evaluator = this;
        let softDistanceResolved = false;
        let softDistanceValue;
        const metrics = Object.freeze({
            unsafeRoots,
            rootChainRisk,
            get softDistanceToBase() {
                if (!softDistanceResolved) {
                    softDistanceValue = evaluator.softDistanceToBase(game, side, enemyBaseId);
                    softDistanceResolved = true;
                }
                return softDistanceValue;
            },
            growthHeadroom: growth.growthHeadroom,
            baseThreatCount: growth.baseThreatCount,
            siegePreFortressCount,
            siegeFortressCount,
            siegeCount: siegePreFortressCount + siegeFortressCount
        });
        cache.set(cacheKey, metrics);
        return metrics;
    }

    evaluateState(game, perspective, bases) {
        const opponent = perspective === 'red' ? 'blue' : 'red';
        const ownRoots = game.getPlayerRootNodes(perspective).length;
        const enemyRoots = game.getPlayerRootNodes(opponent).length;
        if (ownRoots === 0) return -WIN_SCORE;
        if (enemyRoots === 0) return WIN_SCORE;
        if (game.isGameOver) return 0;

        const ownDistance = this.distanceToBase(game, perspective, bases[opponent]);
        const enemyDistance = this.distanceToBase(game, opponent, bases[perspective]);
        const ownNodes = game.getAliveNodesByOwner(perspective).length;
        const enemyNodes = game.getAliveNodesByOwner(opponent).length;
        const ownMetrics = this.getStructuralMetrics(game, perspective, bases);
        const enemyMetrics = this.getStructuralMetrics(game, opponent, bases);

        const distanceValue = distance =>
            Number.isFinite(distance) ? Math.max(-500, 180 - distance * 42) : -260;
        const softDistanceValue = distance =>
            Number.isFinite(distance) ? Math.max(-260, 120 - distance * 24) : -260;
        const ownDistanceScore = Number.isFinite(ownDistance)
            ? distanceValue(ownDistance)
            : -260 + (softDistanceValue(ownMetrics.softDistanceToBase) + 260) *
                this.profile.softDistanceWeight;
        const enemyDistanceScore = Number.isFinite(enemyDistance)
            ? distanceValue(enemyDistance)
            : -260 + (softDistanceValue(enemyMetrics.softDistanceToBase) + 260) *
                this.profile.softDistanceWeight;

        const ownStructure = this._structureValue(game, perspective);
        const enemyStructure = this._structureValue(game, opponent);
        const structuralScore =
            (enemyMetrics.unsafeRoots - ownMetrics.unsafeRoots) * this.profile.rootSafetyWeight +
            (enemyMetrics.rootChainRisk - ownMetrics.rootChainRisk) * this.profile.rootChainRiskWeight +
            (ownMetrics.growthHeadroom - enemyMetrics.growthHeadroom) * this.profile.growthHeadroomWeight +
            (ownMetrics.baseThreatCount - enemyMetrics.baseThreatCount) * this.profile.baseThreatWeight +
            (ownMetrics.siegePreFortressCount - enemyMetrics.siegePreFortressCount) * this.profile.siegePreparationWeight +
            (ownMetrics.siegeFortressCount - enemyMetrics.siegeFortressCount) * this.profile.siegeFortressWeight;

        return (ownDistanceScore - enemyDistanceScore) +
            (ownNodes - enemyNodes) * 7 +
            (ownRoots - enemyRoots) * 220 +
            (ownStructure - enemyStructure) * this.profile.structureWeight +
            structuralScore;
    }

    _structureValue(game, side) {
        let value = 0;
        for (const node of game.getAliveNodesByOwner(side)) {
            const degree = node.getDegree();
            if (node.isRoot) value += 8;
            if (node.childrenIds.length >= 2) value += 12 + node.childrenIds.length * 3;
            if (degree > 3) value += 18;
            if (node.isFrozen) value -= 10;
            if (node.childrenIds.length === 0 && !node.isRoot) value += 1;
        }
        return value;
    }
}
