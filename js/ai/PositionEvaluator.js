// js/ai/PositionEvaluator.js
const WIN_SCORE = 100000;

/**
 * Scores positions from one player's perspective.
 * Rule simulation remains injected from AIController so this module never
 * duplicates growth, combat, freeze, or turn-transition rules.
 */
export class PositionEvaluator {
    constructor({ adjacency, distanceToBase, simulateMove }) {
        this.adjacency = adjacency || {};
        this.distanceToBase = distanceToBase;
        this.simulateMove = simulateMove;
        this.profile = arguments[0].profile;
    }

    scoreMove(game, move, side, bases) {
        const enemy = side === 'red' ? 'blue' : 'red';
        if (move.targetAreaId === bases[enemy]) return WIN_SCORE;

        const beforeDistance = this.distanceToBase(game, side, bases[enemy]);
        const next = this.simulateMove(game, move, side, bases);
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

        const distanceValue = distance =>
            Number.isFinite(distance) ? Math.max(-500, 180 - distance * 42) : -260;
        const ownStructure = this._structureValue(game, perspective);
        const enemyStructure = this._structureValue(game, opponent);
        return (distanceValue(ownDistance) - distanceValue(enemyDistance)) +
            (ownNodes - enemyNodes) * 7 +
            (ownRoots - enemyRoots) * 220 +
            (ownStructure - enemyStructure) * this.profile.structureWeight;
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
