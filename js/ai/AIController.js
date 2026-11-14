// js/ai/AIController.js
import { GameState } from '../game/GameState.js';
import { RuleEngine } from '../game/RuleEngine.js';
import { resolveCombat } from '../game/CombatResolver.js';
import { PositionEvaluator } from './PositionEvaluator.js';
import { TacticalAnalyzer } from './TacticalAnalyzer.js';
import { SearchEngine } from './SearchEngine.js';
import { getDifficultyProfile, DIFFICULTY_LEVELS } from './DifficultyProfiles.js';

const WIN_SCORE = 100000;

export class AIController {
    constructor(difficulty = 'medium', adjacency, areaCenters) {
        if (!DIFFICULTY_LEVELS.includes(difficulty)) {
            throw new TypeError('AI 难度无效');
        }
        this.difficulty = difficulty;
        this.profile = getDifficultyProfile(difficulty);
        this.adjacency = adjacency || {};
        this.areaCenters = areaCenters || [];
        this.ruleEngine = new RuleEngine({ adjacency: this.adjacency });
        this.tacticalAnalyzer = new TacticalAnalyzer();
        this.searchEngine = new SearchEngine();
        this.lastSearchStats = null;
        // Evaluations repeatedly query the same immutable search position.
        // WeakMap avoids retaining discarded search states after a decision.
        this.distanceCache = new WeakMap();
        this.positionEvaluator = new PositionEvaluator({
            adjacency: this.adjacency,
            distanceToBase: (...args) => this._distanceToBase(...args),
            simulateMove: (...args) => this._simulateMove(...args),
            profile: this.profile
        });
    }

    getBestMove(gameStateData, playerSide) {
        if (!['red', 'blue'].includes(playerSide)) {
            throw new TypeError('AI 玩家阵营无效');
        }
        const game = GameState.fromJSON(gameStateData);
        game.currentTurn = playerSide;
        const bases = {
            red: gameStateData.redBaseId,
            blue: gameStateData.blueBaseId
        };
        if (!Number.isInteger(bases.red) || !Number.isInteger(bases.blue) || bases.red === bases.blue) {
            throw new TypeError('AI 基地数据无效');
        }

        const moves = this._generateMoves(game, playerSide, bases);
        if (!moves.length) return null;

        const ranked = moves.map(move => {
            const nextState = this._simulateMove(game, move, playerSide, bases, { alreadyValidated: true });
            return {
                ...move,
                score: this._scoreMove(game, move, playerSide, bases, nextState),
                _nextState: nextState
            };
        }).sort((a, b) => b.score - a.score);

        // A legal immediate win is never deliberately ignored, even on easy.
        const winningMove = this.tacticalAnalyzer.findImmediateWinningMove(ranked, playerSide, bases);
        if (winningMove) return this._publicMove(winningMove);

        // When the opponent has a one-move win, prefer actions that eliminate
        // the threat. If no action fully defends, minimize the remaining wins.
        const defenseMoves = this.tacticalAnalyzer.rankDefenses(
            game, ranked, playerSide, bases,
            (state, move, side, matchBases) => this._simulateMove(state, move, side, matchBases),
            (state, side, matchBases) => this._generateMoves(state, side, matchBases)
        );
        const defenseSet = new Set(defenseMoves);
        const tacticallyRanked = ranked.filter(move => defenseSet.has(move));

        if (this.profile.selection === 'varied') {
            const pool = tacticallyRanked.slice(0, Math.min(4, tacticallyRanked.length));
            return this._publicMove(pool[Math.floor(Math.random() * pool.length)]);
        }
        if (this.profile.selection === 'weighted') {
            return this._publicMove(this._weightedChoice(tacticallyRanked));
        }
        return this._publicMove(this._searchHard(game, tacticallyRanked, playerSide, bases));
    }

    _publicMove(move) {
        return {
            parentNodeId: move.parentNodeId,
            targetAreaId: move.targetAreaId,
            x: move.x,
            y: move.y
        };
    }

    _enemy(side) {
        return side === 'red' ? 'blue' : 'red';
    }

    _generateMoves(game, side, bases) {
        const aliveNodes = game.getAliveNodes();
        const occupiedBySide = new Set(game.getAliveNodesByOwner(side).map(node => node.areaId));
        const enemyAreas = new Set(aliveNodes
            .filter(node => node.owner !== side)
            .map(node => node.areaId));
        const growthContext = this.ruleEngine.createGrowthContext(game, side);
        const moves = [];
        for (const parent of game.getAliveNodesByOwner(side)) {
            if (parent.isFrozen) continue;
            const isFirstRootBranch = parent.isRoot && parent.childrenIds.length === 0;
            const targets = isFirstRootBranch
                ? this.areaCenters.map((_, index) => index + 1)
                : (this.adjacency[parent.areaId] || []);
            for (const targetAreaId of targets) {
                if (!this.areaCenters[targetAreaId - 1] || occupiedBySide.has(targetAreaId)) continue;
                const result = this.ruleEngine.canGrow(game, parent, targetAreaId, {
                    ownBaseId: bases[side],
                    enemyBaseId: bases[this._enemy(side)],
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

    _distanceToBase(game, side, baseId) {
        let positionCache = this.distanceCache.get(game);
        if (!positionCache) {
            positionCache = new Map();
            this.distanceCache.set(game, positionCache);
        }
        const cacheKey = `${side}:${baseId}`;
        if (positionCache.has(cacheKey)) return positionCache.get(cacheKey);

        // Multi-source BFS is equivalent to running one BFS per owned node,
        // but visits each reachable area at most once for this query.
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

    _scoreMove(game, move, side, bases, simulatedNext = null) {
        return this.positionEvaluator.scoreMove(game, move, side, bases, simulatedNext);
    }

    _simulateMove(game, move, side, bases, { alreadyValidated = false } = {}) {
        const next = game.clone();
        next.currentTurn = side;
        const parent = next.getNode(move.parentNodeId);
        if (!parent) return null;
        if (!alreadyValidated) {
            const validation = this.ruleEngine.canGrow(next, parent, move.targetAreaId, {
                ownBaseId: bases[side],
                enemyBaseId: bases[this._enemy(side)]
            });
            if (!validation.allowed) return null;
        }
        const child = next.addNode(parent.id, move.x, move.y, move.targetAreaId, side);
        if (!child) return null;

        const enemy = this._enemy(side);
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

        // Match the live turn transition: the acting side's temporary freezes
        // expire when that side completes its action.
        for (const node of next.getAliveNodesByOwner(side)) node.isFrozen = false;
        next.switchTurn();
        return next;
    }

    _simulatePass(game, side) {
        const next = game.clone();
        next.currentTurn = side;
        for (const node of next.getAliveNodesByOwner(side)) node.isFrozen = false;
        next.switchTurn();
        return next;
    }

    _evaluateState(game, perspective, bases) {
        return this.positionEvaluator.evaluateState(game, perspective, bases);
    }

    _searchHard(game, rankedMoves, side, bases) {
        const rootMoves = rankedMoves.slice(0, this.profile.searchWidth);
        const preparedChildren = new WeakMap();
        const preparedMoveOrder = new WeakMap();
        const positionKeyCache = new WeakMap();
        const moveKey = move => `${move.parentNodeId}:${move.targetAreaId}`;

        // Root candidates were already simulated while calculating their
        // heuristic scores. Reuse those detached states across every
        // iterative-deepening pass.
        const rootChildren = new Map();
        for (const move of rootMoves) {
            const next = move._nextState || this._simulateMove(game, move, side, bases);
            if (next) rootChildren.set(moveKey(move), next);
        }
        preparedChildren.set(game, rootChildren);

        const result = this.searchEngine.search({
            rootState: game,
            rootMoves,
            maxDepth: this.profile.maxDepth,
            timeBudgetMs: this.profile.searchBudgetMs,
            maxNodes: this.profile.maxNodes,
            getPositionKey: state => {
                let key = positionKeyCache.get(state);
                if (key === undefined) {
                    key = JSON.stringify(state.toJSON());
                    positionKeyCache.set(state, key);
                }
                return key;
            },
            applyMove: (state, move, movingSide) => {
                const cached = preparedChildren.get(state)?.get(moveKey(move));
                return cached || this._simulateMove(state, move, movingSide, bases, { alreadyValidated: true });
            },
            generateMoves: (state, movingSide) =>
                this._generateMoves(state, movingSide, bases),
            passTurn: (state, movingSide) => this._simulatePass(state, movingSide),
            evaluate: state => this._evaluateState(state, side, bases),
            orderMoves: (state, moves, maximizing, checkBudget) => {
                // Root moves already carry their scores and prepared child
                // states, so every iteration can reuse both.
                if (state === game) return moves;
                const cachedOrder = preparedMoveOrder.get(state);
                if (cachedOrder) return cachedOrder;

                const scored = [];
                const children = new Map();
                for (const move of moves) {
                    checkBudget();
                    const next = this._simulateMove(state, move, state.currentTurn, bases, { alreadyValidated: true });
                    if (!next) continue;
                    children.set(moveKey(move), next);
                    scored.push({
                        move,
                        score: this._scoreMove(state, move, state.currentTurn, bases, next)
                    });
                }
                // Scores are from the side-to-move's own perspective, so
                // search that player's strongest replies first at every ply.
                scored.sort((a, b) => b.score - a.score);
                preparedChildren.set(state, children);
                const orderedMoves = scored.map(item => item.move);
                preparedMoveOrder.set(state, orderedMoves);
                return orderedMoves;
            }
        });
        this.lastSearchStats = {
            difficulty: this.difficulty,
            ...result
        };
        return result.move || rootMoves[0];
    }

    _weightedChoice(ranked) {
        const top = ranked.slice(0, Math.min(8, ranked.length));
        const floor = Math.min(...top.map(move => move.score));
        const weights = top.map(move => Math.max(1, move.score - floor + 12));
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        let pick = Math.random() * total;
        for (let i = 0; i < top.length; i++) {
            pick -= weights[i];
            if (pick <= 0) return top[i];
        }
        return top[0];
    }
}
