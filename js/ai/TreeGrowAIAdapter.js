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
            softDistanceToBase: (...args) => this.softDistanceToBase(...args),
            getGrowthMetrics: (...args) => this.getGrowthMetrics(...args),
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

    isValidSide(side) {
        return side === 'red' || side === 'blue';
    }

    createNoMoveExplanation() {
        return {
            title: 'AI 跳过回合',
            summary: '当前局面没有可执行的合法生长行动。',
            details: ['AI 未找到通过规则引擎验证的合法候选行动。'],
            search: null
        };
    }

    setSideToMove(state, side) {
        state.currentTurn = side;
    }

    getMoveKey(move) {
        return `${move.parentNodeId}:${move.targetAreaId}`;
    }

    toPublicMove(move) {
        return {
            parentNodeId: move.parentNodeId,
            targetAreaId: move.targetAreaId,
            x: move.x,
            y: move.y
        };
    }

    createDecisionExplanation(game, move, side, bases, rankedMoves, selectionReason, searchStats) {
        if (!move) return null;
        const enemy = side === 'red' ? 'blue' : 'red';
        const selected = rankedMoves.find(candidate =>
            candidate.parentNodeId === move.parentNodeId &&
            candidate.targetAreaId === move.targetAreaId
        );
        const next = selected?._nextState || this.simulateMove(
            game, move, side, bases, { alreadyValidated: true }
        );
        const details = [];
        let summary = '根据当前局面评估选择该行动。';

        if (move.targetAreaId === bases[enemy]) {
            summary = '该行动可以直接进入敌方基地并结束对局。';
            details.push('检测到合法的立即获胜行动，战术规则优先选择了该行动。');
        } else if (next) {
            const beforeEnemyNodes = game.getAliveNodesByOwner(enemy).length;
            const afterEnemyNodes = next.getAliveNodesByOwner(enemy).length;
            const beforeEnemyRoots = game.getPlayerRootNodes(enemy).length;
            const afterEnemyRoots = next.getPlayerRootNodes(enemy).length;
            const removedNodes = beforeEnemyNodes - afterEnemyNodes;
            const removedRoots = beforeEnemyRoots - afterEnemyRoots;
            if (removedRoots > 0) details.push(`模拟战斗可摧毁对方 ${removedRoots} 个根节点。`);
            if (removedNodes > 0) details.push(`模拟战斗可减少对方 ${removedNodes} 个存活节点。`);

            const beforeDistance = this.distanceToBase(game, side, bases[enemy]);
            const afterDistance = this.distanceToBase(next, side, bases[enemy]);
            if (Number.isFinite(beforeDistance) && Number.isFinite(afterDistance) && afterDistance < beforeDistance) {
                details.push(`推进路线：到敌方基地的图论距离从 ${beforeDistance} 缩短至 ${afterDistance}。`);
            }

            const beforeSafety = this.distanceToBase(game, enemy, bases[side]);
            const afterSafety = this.distanceToBase(next, enemy, bases[side]);
            if (Number.isFinite(beforeSafety) && Number.isFinite(afterSafety) && afterSafety > beforeSafety) {
                details.push(`防守收益：对手到己方基地的最短可行距离从 ${beforeSafety} 增加至 ${afterSafety}。`);
            }

            const beforeParent = game.getNode(move.parentNodeId);
            const afterParent = next.getNode(move.parentNodeId);
            if (beforeParent && afterParent && afterParent.childrenIds.length > beforeParent.childrenIds.length) {
                details.push(`结构扩张：父节点 #${move.parentNodeId} 的子枝数增加至 ${afterParent.childrenIds.length}。`);
            }
        }

        if (selectionReason === 'forced-sequence-win') {
            details.unshift('有限深度战术验证确认：无论对手选择哪一种合法回应，下一回合仍存在立即获胜行动。');
            summary = '识别到经过对手回应验证的连续攻击组合，优先执行该行动。';
        }
        if (selectionReason === 'forced-material-gain') {
            const guaranteedMaterial = searchStats?.guaranteedTacticalRootLoss > 0
                ? `${searchStats.guaranteedTacticalRootLoss} 个敌方根节点`
                : `${searchStats?.guaranteedTacticalCascadeLoss || 0} 个级联节点`;
            details.unshift(`有限深度推演验证：对手无论如何回应，下一回合都能至少摧毁 ${guaranteedMaterial}。`);
            summary = '识别到无法通过单次防守化解的连续战术收益，优先执行该行动。';
        }
        if (selectionReason === 'defense-priority') {
            details.unshift('战术筛选优先保留能最大限度减少对手立即获胜机会的行动。');
        }
        if (!details.length) details.push('该行动在当前难度配置的候选评分中排名靠前。');
        if (selectionReason === 'immediate-win') summary = '识别到立即获胜机会，优先执行胜利行动。';
        else if (selectionReason === 'defense-priority') summary = '当前存在紧急威胁，优先选择防守效果最好的候选行动。';

        const search = searchStats ? {
            completedDepth: searchStats.completedDepth,
            nodes: searchStats.nodes,
            elapsedMs: searchStats.elapsedMs,
            transpositionHits: searchStats.transpositionHits,
            tacticalSequenceNodes: searchStats.tacticalSequenceNodes ?? 0,
            tacticalSequenceComplete: searchStats.tacticalSequenceComplete ?? true,
            forcedWinInTwoMoves: searchStats.forcedWinInTwoMoves ?? false,
            forcedMaterialGainInTwoMoves: searchStats.forcedMaterialGainInTwoMoves ?? false,
            guaranteedTacticalRootLoss: searchStats.guaranteedTacticalRootLoss ?? 0,
            guaranteedTacticalCascadeLoss: searchStats.guaranteedTacticalCascadeLoss ?? 0,
            guaranteedTacticalNodeLoss: searchStats.guaranteedTacticalNodeLoss ?? 0
        } : null;
        return { title: 'AI 行动分析', summary, details: details.slice(0, 4), search };
    }

    getPositionKey(state) {
        return Array.isArray(state.nodes)
            ? getPositionKey(state)
            : JSON.stringify(state.toJSON());
    }

    isTerminal(state) {
        return Boolean(state.isGameOver);
    }

    getSideToMove(state) {
        return state.currentTurn;
    }

    getRootGrowthTargets(parent, context) {
        const maxDistance = Math.min(context.ownAreaCount, 2);
        if (maxDistance <= 0) return [];

        const targets = [];
        const visited = new Set([parent.areaId]);
        const queue = [{ areaId: parent.areaId, distance: 0 }];
        for (let head = 0; head < queue.length; head++) {
            const current = queue[head];
            if (current.distance >= maxDistance) continue;
            for (const next of this.adjacency[current.areaId] || []) {
                if (visited.has(next)) continue;
                visited.add(next);
                if (this.areaCenters[next - 1]) targets.push(next);

                // An occupied area can be an attack destination, but cannot
                // serve as an intermediate cell on a root's first-branch path.
                if (!context.occupiedAreas.has(next)) {
                    queue.push({ areaId: next, distance: current.distance + 1 });
                }
            }
        }
        return targets;
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
                ? this.getRootGrowthTargets(parent, growthContext)
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

    softDistanceToBase(game, side, baseId) {
        let positionCache = this.distanceCache.get(game);
        if (!positionCache) {
            positionCache = new Map();
            this.distanceCache.set(game, positionCache);
        }
        const cacheKey = `soft:${side}:${baseId}`;
        if (positionCache.has(cacheKey)) return positionCache.get(cacheKey);

        const enemy = side === 'red' ? 'blue' : 'red';
        const enemyOccupied = new Set(
            game.getAliveNodesByOwner(enemy).map(node => node.areaId)
        );
        const distances = new Map();
        const heap = [];
        const push = item => {
            heap.push(item);
            let index = heap.length - 1;
            while (index > 0) {
                const parent = Math.floor((index - 1) / 2);
                if (heap[parent].distance <= item.distance) break;
                heap[index] = heap[parent];
                index = parent;
            }
            heap[index] = item;
        };
        const pop = () => {
            const first = heap[0];
            const last = heap.pop();
            if (heap.length) {
                let index = 0;
                while (true) {
                    const left = index * 2 + 1;
                    const right = left + 1;
                    if (left >= heap.length) break;
                    const child = right < heap.length &&
                        heap[right].distance < heap[left].distance ? right : left;
                    if (heap[child].distance >= last.distance) break;
                    heap[index] = heap[child];
                    index = child;
                }
                heap[index] = last;
            }
            return first;
        };

        for (const node of game.getAliveNodesByOwner(side)) {
            if (distances.has(node.areaId)) continue;
            distances.set(node.areaId, 0);
            push({ areaId: node.areaId, distance: 0 });
        }

        let best = Infinity;
        while (heap.length) {
            const current = pop();
            if (current.distance !== distances.get(current.areaId)) continue;
            if (current.areaId === baseId) {
                best = current.distance;
                break;
            }
            for (const next of this.adjacency[current.areaId] || []) {
                const stepCost = next !== baseId && enemyOccupied.has(next) ? 3 : 1;
                const nextDistance = current.distance + stepCost;
                if (nextDistance >= (distances.get(next) ?? Infinity)) continue;
                distances.set(next, nextDistance);
                push({ areaId: next, distance: nextDistance });
            }
        }

        positionCache.set(cacheKey, best);
        return best;
    }

    getGrowthMetrics(game, side, bases) {
        const previousTurn = game.currentTurn;
        this.setSideToMove(game, side);
        try {
            const context = this.ruleEngine.createGrowthContext(game, side);
            const enemy = side === 'red' ? 'blue' : 'red';
            const enemyBaseId = bases[enemy];
            const growthParentIds = new Set();
            let baseThreatCount = 0;

            for (const parent of game.getAliveNodesByOwner(side)) {
                if (parent.isFrozen || (parent.isRoot && parent.hasUsedRootGrowth)) continue;
                const isFirstRootBranch = parent.isRoot && !parent.hasUsedRootGrowth &&
                    parent.childrenIds.length === 0;
                const targets = isFirstRootBranch
                    ? this.getRootGrowthTargets(parent, context)
                    : (this.adjacency[parent.areaId] || []);
                const options = {
                    ownBaseId: bases[side],
                    enemyBaseId,
                    context
                };

                let hasLegalMove = false;
                if (targets.includes(enemyBaseId)) {
                    const result = this.ruleEngine.canGrow(game, parent, enemyBaseId, options);
                    if (result.allowed) {
                        baseThreatCount++;
                        hasLegalMove = true;
                    }
                }
                if (!hasLegalMove) {
                    for (const targetAreaId of targets) {
                        if (targetAreaId === enemyBaseId) continue;
                        if (this.ruleEngine.canGrow(game, parent, targetAreaId, options).allowed) {
                            hasLegalMove = true;
                            break;
                        }
                    }
                }
                if (hasLegalMove) growthParentIds.add(parent.id);
            }

            return {
                growthHeadroom: growthParentIds.size,
                baseThreatCount,
                growthParentIds
            };
        } finally {
            this.setSideToMove(game, previousTurn);
        }
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
