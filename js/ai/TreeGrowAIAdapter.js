// js/ai/TreeGrowAIAdapter.js
import { GameState } from '../game/GameState.js';
import { RuleEngine } from '../game/RuleEngine.js';
import { resolveCombat } from '../game/CombatResolver.js';
import { PositionEvaluator } from './PositionEvaluator.js';
import { TacticalAnalyzer } from './TacticalAnalyzer.js';
import { getPositionKey } from './PositionKey.js';

/**
 * TreeGrow-specific bridge between the generic search controller and the
 * game's state, rules, combat resolution, tactical analysis, and evaluation.
 *
 * A future game mode can provide another adapter with the same public
 * methods without changing SearchEngine's search algorithm.
 */
export class TreeGrowAIAdapter {
    constructor({ adjacency, areaCenters, profile }) {
        this.adjacency = adjacency || {};
        this.areaCenters = areaCenters || [];
        this.ruleEngine = new RuleEngine({ adjacency: this.adjacency });
        this.tacticalAnalyzer = new TacticalAnalyzer();
        this.distanceCache = new WeakMap();
        this.positionEvaluator = new PositionEvaluator({
            adjacency: this.adjacency,
            distanceToBase: (...args) => this.distanceToBase(...args),
            simulateMove: (...args) => this.simulateMove(...args),
            profile
        });
    }

    createState(snapshot) {
        return GameState.fromJSON(snapshot);
    }

    getBases(snapshot) {
        const bases = {
            red: snapshot?.redBaseId,
            blue: snapshot?.blueBaseId
        };
        if (!Number.isInteger(bases.red) || !Number.isInteger(bases.blue) ||
            bases.red === bases.blue) {
            throw new TypeError('AI 基地数据无效');
        }
        return bases;
    }

    getPositionKey(state) {
        return getPositionKey(state);
    }

    isTerminal(state) {
        return Boolean(state.isGameOver);
    }

    getSideToMove(state) {
        return state.currentTurn;
    }

    generateMoves(game, side, bases) {
        const aliveNodes = game.getAliveNodes();
        const occupiedBySide = new Set(game.getAliveNodesByOwner(side).map(node => node.areaId));
        const enemyAreas = new Set(aliveNodes
            .filter(node => node.owner !== side)
            .map(node => node.areaId));
        const growthContext = this.ruleEngine.createGrowthContext(game, side);
        const moves = [];
        for (const parent of game.getAliveNodesByOwner(side)) {
            if (parent.isFrozen || (parent.isRoot && parent.hasUsedRootGrowth)) continue;
            const isFirstRootBranch = parent.isRoot && !parent.hasUsedRootGrowth && parent.childrenIds.length === 0;
            const targets = isFirstRootBranch
                ? this.areaCenters.map((_, index) => index + 1)
                : (this.adjacency[parent.areaId] || []);
            for (const targetAreaId of targets) {
                if (!this.areaCenters[targetAreaId - 1] || occupiedBySide.has(targetAreaId)) continue;
                const result = this.ruleEngine.canGrow(game, parent, targetAreaId, {
                    ownBaseId: bases[side],
                    enemyBaseId: bases[side === 'red' ? 'blue' : 'red'],
                    context: growthContext
                });
                if (!result.allowed) continue;
                const center = this.areaCenters[targetAreaId - 1];
                moves.push({
                    parentNodeId: parent.id,
                    targetAreaId,
                    x: center[0],
                    y: center[1],
                    attacks: enemyAreas.has(targetAreaId)
                });
            }
        }
        return moves;
    }

    distanceToBase(game, side, baseId) {
        let positionCache = this.distanceCache.get(game);
        if (!positionCache) {
            positionCache = new Map();
            this.distanceCache.set(game, positionCache);
        }
        const cacheKey = `${side}:${baseId}`;
        if (positionCache.has(cacheKey)) return positionCache.get(cacheKey);

        const occupied = new Set(game.getAliveNodes().map(node => node.areaId));
        const queue = [];
        const distance = new Map();
        for (const node of game.getAliveNodesByOwner(side)) {
            if (distance.has(node.areaId)) continue;
            distance.set(node.areaId, 0);
            queue.push(node.areaId);
        }

        let best = Infinity;
        for (let head = 0; head < queue.length; head++) {
            const current = queue[head];
            const currentDistance = distance.get(current);
            if (current === baseId) {
                best = currentDistance;
                break;
            }
            for (const next of this.adjacency[current] || []) {
                if (distance.has(next)) continue;
                if (occupied.has(next) && next !== baseId) continue;
                distance.set(next, currentDistance + 1);
                queue.push(next);
            }
        }

        positionCache.set(cacheKey, best);
        return best;
    }

    simulateMove(game, move, side, bases, { alreadyValidated = false } = {}) {
        const next = game.clone();
        next.currentTurn = side;
        const parent = next.getNode(move.parentNodeId);
        if (!parent) return null;
        if (!alreadyValidated) {
            const validation = this.ruleEngine.canGrow(next, parent, move.targetAreaId, {
                ownBaseId: bases[side],
                enemyBaseId: bases[side === 'red' ? 'blue' : 'red']
            });
            if (!validation.allowed) return null;
        }
        const child = next.addNode(parent.id, move.x, move.y, move.targetAreaId, side);
        if (!child) return null;

        const enemy = side === 'red' ? 'blue' : 'red';
        if (move.targetAreaId === bases[enemy]) {
            next.isGameOver = true;
            return next;
        }

        const defender = next.getAliveNodes().find(node =>
            node.id !== child.id && node.owner === enemy && node.areaId === move.targetAreaId
        );
        if (defender) {
            const combat = resolveCombat(next, child, defender);
            if (combat.nodesToDelete.length) next.deleteNodes(combat.nodesToDelete);
            if (combat.freezeTargetId) {
                const frozen = next.getNode(combat.freezeTargetId);
                if (frozen) frozen.isFrozen = true;
            }
        }

        if (!next.getPlayerRootNodes(enemy).length) {
            next.isGameOver = true;
            return next;
        }
        if (!next.getPlayerRootNodes(side).length) {
            next.isGameOver = true;
            return next;
        }

        for (const node of next.getAliveNodesByOwner(side)) node.isFrozen = false;
        next.switchTurn();
        return next;
    }

    simulatePass(game, side) {
        const next = game.clone();
        next.currentTurn = side;
        for (const node of next.getAliveNodesByOwner(side)) node.isFrozen = false;
        next.switchTurn();
        return next;
    }
}
