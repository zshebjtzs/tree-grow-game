// js/ai/PositionEvaluator.js
import { PositionAnalyzer } from './PositionAnalyzer.js';
import { StrategicPhaseDetector } from './StrategicPhaseDetector.js';
import { StrategicAnalyzer } from './StrategicAnalyzer.js';
import { analyzeExchangeOutcome } from './OffensiveStrategyAnalyzer.js';
import { DisadvantageRiskAnalyzer } from './DisadvantageRiskAnalyzer.js';

const WIN_SCORE = 100000;

/**
 * Scores positions from one player's perspective.
 * Rule simulation remains injected from AIController so this module never
 * duplicates growth, combat, freeze, or turn-transition rules.
 */
export class PositionEvaluator {
    constructor({ adjacency, distanceToBase, softDistanceToBase, getGrowthMetrics, generateMoves, simulateMove, profile }) {
        this.adjacency = adjacency || {};
        this.distanceToBase = distanceToBase;
        this.softDistanceToBase = softDistanceToBase;
        this.getGrowthMetrics = getGrowthMetrics;
        this.generateMoves = generateMoves;
        this.metricsCache = new WeakMap();
        this.evaluationCache = new WeakMap();
        this.strategicAnalysisCache = new WeakMap();
        this.recaptureRiskCache = new WeakMap();
        this.simulateMove = simulateMove;
        this.profile = profile;
        this.positionAnalyzer = new PositionAnalyzer({ adjacency: this.adjacency, distanceToBase: (...args) => this.distanceToBase(...args), getStructuralMetrics: (...args) => this.getStructuralMetrics(...args) });
        this.phaseDetector = new StrategicPhaseDetector();
        this.strategicAnalyzer = new StrategicAnalyzer();
        this.disadvantageRiskAnalyzer = new DisadvantageRiskAnalyzer();
    }

    getStrategicAnalysis(game, side, bases) {
        let bySide = this.strategicAnalysisCache.get(game);
        if (!bySide) {
            bySide = new Map();
            this.strategicAnalysisCache.set(game, bySide);
        }
        const enemy = side === 'red' ? 'blue' : 'red';
        const key = `${side}:${bases[side]}:${bases[enemy]}`;
        if (bySide.has(key)) return bySide.get(key);
        const position = this.positionAnalyzer.analyze(game, side, bases);
        const phase = this.phaseDetector.detect(position);
        const weights = this.strategicAnalyzer.getDynamicWeights(this.profile, phase);
        const analysis = Object.freeze({
            position, phase, weights,
            spatialScore: this.strategicAnalyzer.evaluateSpatial(position, this.profile)
        });
        bySide.set(key, analysis);
        return analysis;
    }

    getAdvantageConversionFactor(game, perspective, bases) {
        const threshold = this.profile.advantageConversionThreshold ?? 250;
        const scale = Math.max(1, this.profile.advantageConversionScale ?? 1500);
        const advantage = this.evaluateState(game, perspective, bases);
        return Math.max(0, Math.min(1, (advantage - threshold) / scale));
    }

    getDisadvantageRiskFactor(game, perspective, bases) {
        return this.disadvantageRiskAnalyzer.getRiskFactor(
            this.evaluateState(game, perspective, bases),
            this.profile
        );
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

        const strategic = this.getStrategicAnalysis(game, side, bases);
        const weights = strategic.weights;
        let score = progress * 95 * weights.progressWeight;
        let exchange = null;
        if (move.attacks) {
            exchange = analyzeExchangeOutcome(game, side, move, next);
            score += exchange.netNodeGain * 85 * weights.attackWeight;
            score += exchange.netRootGain * 900 * weights.rootAttackWeight;
        }

        const ownAreaGain = next.getAliveNodesByOwner(side).length -
            game.getAliveNodesByOwner(side).length;
        score += ownAreaGain * 8 * weights.expansionWeight;

        const ownThreat = this.distanceToBase(next, enemy, bases[side]);
        const disadvantageRiskFactor = this.getDisadvantageRiskFactor(game, side, bases);
        if (Number.isFinite(ownThreat)) {
            const safetyMultiplier = 1 - disadvantageRiskFactor * 0.35;
            score -= Math.max(0, 5 - ownThreat) * 24 * weights.safetyWeight * safetyMultiplier;
        }

        // Structural value: preserve branching flexibility and avoid leaving
        // the newly created frontier as an isolated, immediately vulnerable leaf.
        const newNode = next.getAliveNodes().find(node =>
            node.owner === side && node.areaId === move.targetAreaId
        );
        if (newNode) {
            const parent = next.getNode(newNode.parentId);
            if (parent && parent.childrenIds.length >= 2) score += 10 * weights.branchingWeight;
            if (parent && parent.isRoot) score += 6 * weights.structureWeight;

            // An opponent can remove this node either directly or by
            // attacking any vulnerable ancestor: combat deletes the attacked
            // subtree up to the nearest protected branching ancestor.
            const vulnerableAncestorAreas = new Set();
            let ancestor = newNode;
            while (ancestor) {
                if (ancestor.owner === side && ancestor.getDegree() <= 3) {
                    vulnerableAncestorAreas.add(ancestor.areaId);
                }
                ancestor = ancestor.parentId === null
                    ? null
                    : next.getNode(ancestor.parentId);
            }
            const enemyAreas = new Set(next.getAliveNodesByOwner(enemy).map(node => node.areaId));
            const enemyAdjacent = [...vulnerableAncestorAreas].some(areaId =>
                (this.adjacency[areaId] || []).some(adjacentArea => enemyAreas.has(adjacentArea))
            );
            if (enemyAdjacent && this.generateMoves) {
                let bySide = this.recaptureRiskCache.get(next);
                if (!bySide) {
                    bySide = new Map();
                    this.recaptureRiskCache.set(next, bySide);
                }
                const riskKey = `${side}:${bases[side]}:${bases[enemy]}:${newNode.id}`;
                let risk = bySide.get(riskKey);
                if (!risk) {
                    risk = { ownNodeLoss: 0, ownRootLoss: 0, cascadeLoss: 0, penalty: 0 };
                    const replies = this.generateMoves(next, enemy, bases).filter(reply =>
                        reply.attacks && vulnerableAncestorAreas.has(reply.targetAreaId)
                    );
                    const beforeIds = new Set(next.getAliveNodesByOwner(side).map(node => node.id));
                    const beforeRootIds = new Set(next.getPlayerRootNodes(side).map(node => node.id));
                    const nodePenalty = this.profile.immediateRecaptureNodePenalty ?? 110;
                    const rootPenalty = this.profile.immediateRecaptureRootPenalty ?? 2600;
                    const cascadePenalty = this.profile.immediateRecaptureCascadePenalty ?? 90;
                    for (const reply of replies) {
                        const afterReply = this.simulateMove(next, reply, enemy, bases);
                        if (!afterReply) continue;
                        const afterIds = new Set(afterReply.getAliveNodesByOwner(side).map(node => node.id));
                        if (afterIds.has(newNode.id)) continue;
                        const removed = [...beforeIds].filter(id => !afterIds.has(id));
                        const afterRootIds = new Set(afterReply.getPlayerRootNodes(side).map(node => node.id));
                        const ownRootLoss = [...beforeRootIds].filter(id => !afterRootIds.has(id)).length;
                        const directTarget = next.getAliveNodesByOwner(side)
                            .find(node => node.areaId === reply.targetAreaId);
                        const directLoss = directTarget && !directTarget.isRoot &&
                            !afterIds.has(directTarget.id) ? 1 : 0;
                        const cascadeLoss = Math.max(0, removed.length - ownRootLoss - directLoss);
                        const branchRisk = {
                            ownNodeLoss: removed.length,
                            ownRootLoss,
                            cascadeLoss
                        };
                        // Partition losses into direct targets, cascade nodes,
                        // and roots so the same deleted node is not charged
                        // multiple times. Root loss retains its strategic premium.
                        branchRisk.penalty = directLoss * nodePenalty +
                            branchRisk.ownRootLoss * rootPenalty +
                            branchRisk.cascadeLoss * cascadePenalty;
                        if (branchRisk.penalty > risk.penalty) risk = branchRisk;
                    }
                    bySide.set(riskKey, risk);
                }
                score -= risk.penalty;
            }
        }
        const nextStrategic = this.getStrategicAnalysis(next, side, bases);
        score += (nextStrategic.spatialScore - strategic.spatialScore) * 0.18;

        // In an already favorable position, reward only concrete conversion:
        // positive net exchanges, enemy-root damage, and progress toward the base.
        // This multiplier never turns a losing exchange into a preferred attack.
        const advantageFactor = this.getAdvantageConversionFactor(game, side, bases);
        const conversionPotential =
            Math.max(0, progress) * 95 * weights.progressWeight +
            (exchange ? Math.max(0, exchange.netNodeGain) * 85 * weights.attackWeight +
                Math.max(0, exchange.netRootGain) * 900 * weights.rootAttackWeight : 0);
        score += conversionPotential * advantageFactor *
            (this.profile.advantageConversionWeight ?? 0.3);

        // Behind positions accept measured tactical volatility, not arbitrary
        // sacrifices. The bonus requires concrete progress, enemy-root damage,
        // cascade value, or positive net exchange; own losses are charged.
        score += this.disadvantageRiskAnalyzer.evaluateMove({
            riskFactor: disadvantageRiskFactor,
            progress,
            exchange
        }, this.profile);
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
                // Destroying the vulnerable first child removes its entire
                // descendant subtree, including every branch. Count the full
                // exposure rather than stopping at the first fork.
                const stack = firstChild ? [firstChild.id] : [];
                const visited = new Set();
                while (stack.length) {
                    const nodeId = stack.pop();
                    if (visited.has(nodeId)) continue;
                    visited.add(nodeId);
                    const node = game.getNode(nodeId);
                    if (!node || node.isDestroyed || node.owner !== side) continue;
                    rootChainRisk++;
                    for (const childId of node.childrenIds) stack.push(childId);
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
        let cache = this.evaluationCache.get(game);
        if (!cache) {
            cache = new Map();
            this.evaluationCache.set(game, cache);
        }
        const opponent = perspective === 'red' ? 'blue' : 'red';
        const cacheKey = `${perspective}:${bases[perspective]}:${bases[opponent]}`;
        if (cache.has(cacheKey)) return cache.get(cacheKey);
        const finish = value => {
            cache.set(cacheKey, value);
            return value;
        };
        const ownRoots = game.getPlayerRootNodes(perspective).length;
        const enemyRoots = game.getPlayerRootNodes(opponent).length;
        if (ownRoots === 0) return finish(-WIN_SCORE);
        if (enemyRoots === 0) return finish(WIN_SCORE);
        if (game.isGameOver) {
            // Base invasion ends the game before the adapter switches turns.
            // In that terminal state, currentTurn therefore identifies the winner.
            return finish(game.currentTurn === perspective ? WIN_SCORE : -WIN_SCORE);
        }

        const ownDistance = this.distanceToBase(game, perspective, bases[opponent]);
        const enemyDistance = this.distanceToBase(game, opponent, bases[perspective]);
        const ownNodes = game.getAliveNodesByOwner(perspective).length;
        const enemyNodes = game.getAliveNodesByOwner(opponent).length;
        const ownMetrics = this.getStructuralMetrics(game, perspective, bases);
        const enemyMetrics = this.getStructuralMetrics(game, opponent, bases);
        const ownStrategic = this.getStrategicAnalysis(game, perspective, bases);
        const enemyStrategic = this.getStrategicAnalysis(game, opponent, bases);

        const distanceValue = distance =>
            Number.isFinite(distance) ? Math.max(-500, 180 - distance * 42) : -260;
        const softDistanceValue = distance =>
            Number.isFinite(distance) ? Math.max(-260, 120 - distance * 24) : -260;
        const ownDistanceScore = Number.isFinite(ownDistance)
            ? distanceValue(ownDistance)
            : -260 + (softDistanceValue(ownMetrics.softDistanceToBase) + 260) *
                ownStrategic.weights.softDistanceWeight;
        const enemyDistanceScore = Number.isFinite(enemyDistance)
            ? distanceValue(enemyDistance)
            : -260 + (softDistanceValue(enemyMetrics.softDistanceToBase) + 260) *
                enemyStrategic.weights.softDistanceWeight;

        const ownStructure = this._structureValue(game, perspective);
        const enemyStructure = this._structureValue(game, opponent);
        const ownWeights = ownStrategic.weights;
        const enemyWeights = enemyStrategic.weights;
        const structuralScore =
            enemyMetrics.unsafeRoots * enemyWeights.rootSafetyWeight - ownMetrics.unsafeRoots * ownWeights.rootSafetyWeight +
            enemyMetrics.rootChainRisk * enemyWeights.rootChainRiskWeight - ownMetrics.rootChainRisk * ownWeights.rootChainRiskWeight +
            ownMetrics.growthHeadroom * ownWeights.growthHeadroomWeight - enemyMetrics.growthHeadroom * enemyWeights.growthHeadroomWeight +
            ownMetrics.baseThreatCount * ownWeights.baseThreatWeight - enemyMetrics.baseThreatCount * enemyWeights.baseThreatWeight +
            ownMetrics.siegePreFortressCount * ownWeights.siegePreparationWeight - enemyMetrics.siegePreFortressCount * enemyWeights.siegePreparationWeight +
            ownMetrics.siegeFortressCount * ownWeights.siegeFortressWeight - enemyMetrics.siegeFortressCount * enemyWeights.siegeFortressWeight;

        const baseScore = (ownDistanceScore - enemyDistanceScore) +
            (ownNodes - enemyNodes) * 7 +
            (ownRoots - enemyRoots) * 220 +
            (ownStructure - enemyStructure) * ((ownStrategic.weights.structureWeight + enemyStrategic.weights.structureWeight) / 2) +
            structuralScore +
            (ownStrategic.spatialScore - enemyStrategic.spatialScore);

        // Give a losing side credit for concrete latent initiative in the
        // position evaluation itself, so minimax can prefer viable comeback
        // structures even after completing a search iteration.
        const comebackRiskFactor = this.disadvantageRiskAnalyzer.getRiskFactor(
            baseScore, this.profile
        );
        const ownComebackPotential =
            ownStrategic.position.tacticalPressure *
                (this.profile.disadvantageTacticalPotentialWeight ?? 320) +
            ownStrategic.position.siegePressure *
                (this.profile.disadvantageSiegePotentialWeight ?? 180);
        const enemyComebackPotential =
            enemyStrategic.position.tacticalPressure *
                (this.profile.disadvantageTacticalPotentialWeight ?? 320) +
            enemyStrategic.position.siegePressure *
                (this.profile.disadvantageSiegePotentialWeight ?? 180);
        const enemyComebackRiskFactor = this.disadvantageRiskAnalyzer.getRiskFactor(
            -baseScore, this.profile
        );
        // Initiative is evaluated symmetrically. Frontier control is spatial
        // value, not a verified tactical threat, so it is excluded here.
        return finish(
            baseScore +
            ownComebackPotential * comebackRiskFactor -
            enemyComebackPotential * enemyComebackRiskFactor
        );
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
