// js/ai/AIController.js
import { SearchEngine } from './SearchEngine.js';
import { getDifficultyProfile, DIFFICULTY_LEVELS } from './DifficultyProfiles.js';
import { TreeGrowAIAdapter } from './TreeGrowAIAdapter.js';

const WIN_SCORE = 100000;

export class AIController {
    constructor(difficulty = 'medium', adjacency, areaCenters, adapter = null) {
        if (!DIFFICULTY_LEVELS.includes(difficulty)) {
            throw new TypeError('AI 难度无效');
        }
        this.difficulty = difficulty;
        this.profile = getDifficultyProfile(difficulty);
        this.adjacency = adjacency || {};
        this.areaCenters = areaCenters || [];
        this.adapter = adapter || new TreeGrowAIAdapter({
            adjacency: this.adjacency,
            areaCenters: this.areaCenters,
            profile: this.profile
        });

        const requiredMethods = [
            'createState', 'getBases', 'getPositionKey', 'isTerminal',
            'getSideToMove', 'generateMoves', 'distanceToBase',
            'simulateMove', 'simulatePass'
        ];
        if (requiredMethods.some(method => typeof this.adapter[method] !== 'function') ||
            typeof this.adapter.positionEvaluator?.scoreMove !== 'function' ||
            typeof this.adapter.positionEvaluator?.evaluateState !== 'function' ||
            typeof this.adapter.tacticalAnalyzer?.findImmediateWinningMove !== 'function' ||
            typeof this.adapter.tacticalAnalyzer?.rankDefenses !== 'function') {
            throw new TypeError('AI 适配器接口无效');
        }

        this.ruleEngine = this.adapter.ruleEngine;
        this.tacticalAnalyzer = this.adapter.tacticalAnalyzer;
        this.positionEvaluator = this.adapter.positionEvaluator;
        this.searchEngine = new SearchEngine();
        this.lastSearchStats = null;
    }

    getBestMove(gameStateData, playerSide) {
        if (!['red', 'blue'].includes(playerSide)) {
            throw new TypeError('AI 玩家阵营无效');
        }
        this.lastSearchStats = null;
        this.lastDecisionExplanation = null;
        const game = this.adapter.createState(gameStateData);
        game.currentTurn = playerSide;
        const bases = this.adapter.getBases(gameStateData);

        this._emitProgress({ phase: 'generating', completedCandidates: 0, totalCandidates: 0 });
        const moves = this._generateMoves(game, playerSide, bases);
        if (!moves.length) {
            this.lastDecisionExplanation = {
                title: 'AI 跳过回合',
                summary: '当前局面没有可执行的合法生长行动。',
                details: ['AI 未找到通过规则引擎验证的合法候选行动。'],
                search: null
            };
            this._emitProgress({ phase: 'complete', completedCandidates: 0, totalCandidates: 0 });
            return null;
        }

        const ranked = [];
        const reportInterval = Math.max(1, Math.ceil(moves.length / 8));
        for (let index = 0; index < moves.length; index++) {
            const move = moves[index];
            const nextState = this._simulateMove(
                game, move, playerSide, bases, { alreadyValidated: true }
            );
            ranked.push({
                ...move,
                score: this._scoreMove(game, move, playerSide, bases, nextState),
                _nextState: nextState
            });
            if ((index + 1) % reportInterval === 0 || index + 1 === moves.length) {
                this._emitProgress({
                    phase: 'evaluating',
                    completedCandidates: index + 1,
                    totalCandidates: moves.length
                });
            }
        }
        ranked.sort((a, b) => b.score - a.score);

        let selectedMove = this.tacticalAnalyzer.findImmediateWinningMove(ranked, playerSide, bases);
        let selectionReason = selectedMove ? 'immediate-win' : 'profile-selection';

        if (!selectedMove) {
            this._emitProgress({ phase: 'tactics' });
            // When the opponent has a one-move win, prefer actions that eliminate
            // the threat. If no action fully defends, minimize the remaining wins.
            const defenseMoves = this.tacticalAnalyzer.rankDefenses(
                game, ranked, playerSide, bases,
                (state, move, side, matchBases) => this._simulateMove(
                    state, move, side, matchBases, { alreadyValidated: true }
                ),
                (state, side, matchBases) => this._generateMoves(state, side, matchBases)
            );
            const defenseSet = new Set(defenseMoves);
            const tacticallyRanked = ranked.filter(move => defenseSet.has(move));
            if (tacticallyRanked.length < ranked.length) selectionReason = 'defense-priority';

            selectedMove = this._search(game, tacticallyRanked, playerSide, bases);
            selectionReason = 'search-selection';
        }

        this.lastDecisionExplanation = this._createDecisionExplanation(
            game, selectedMove, playerSide, bases, ranked, selectionReason
        );
        this._emitProgress({ phase: 'complete', completedCandidates: moves.length, totalCandidates: moves.length });
        return this._publicMove(selectedMove);
    }

    _emitProgress(progress) {
        if (typeof this.onProgress !== 'function') return;
        try { this.onProgress(progress); } catch (error) {
            // Progress reporting is observational and must not affect AI decisions.
        }
    }

    _createDecisionExplanation(game, move, side, bases, rankedMoves, selectionReason) {
        if (!move) return null;
        const enemy = this._enemy(side);
        const selected = rankedMoves.find(candidate =>
            candidate.parentNodeId === move.parentNodeId &&
            candidate.targetAreaId === move.targetAreaId
        );
        const next = selected?._nextState || this._simulateMove(
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
            if (removedRoots > 0) {
                details.push(`模拟战斗可摧毁对方 ${removedRoots} 个根节点。`);
            }
            if (removedNodes > 0) {
                details.push(`模拟战斗可减少对方 ${removedNodes} 个存活节点。`);
            }

            const beforeDistance = this._distanceToBase(game, side, bases[enemy]);
            const afterDistance = this._distanceToBase(next, side, bases[enemy]);
            if (Number.isFinite(beforeDistance) && Number.isFinite(afterDistance) && afterDistance < beforeDistance) {
                details.push(`推进路线：到敌方基地的图论距离从 ${beforeDistance} 缩短至 ${afterDistance}。`);
            }

            const beforeSafety = this._distanceToBase(game, enemy, bases[side]);
            const afterSafety = this._distanceToBase(next, enemy, bases[side]);
            if (Number.isFinite(beforeSafety) && Number.isFinite(afterSafety) && afterSafety > beforeSafety) {
                details.push(`防守收益：对手到己方基地的最短可行距离从 ${beforeSafety} 增加至 ${afterSafety}。`);
            }

            const beforeParent = game.getNode(move.parentNodeId);
            const afterParent = next.getNode(move.parentNodeId);
            if (beforeParent && afterParent && afterParent.childrenIds.length > beforeParent.childrenIds.length) {
                details.push(`结构扩张：父节点 #${move.parentNodeId} 的子枝数增加至 ${afterParent.childrenIds.length}。`);
            }
        }

        if (selectionReason === 'defense-priority') {
            details.unshift('战术筛选优先保留能最大限度减少对手立即获胜机会的行动。');
        }
        if (!details.length) {
            details.push('该行动在当前难度配置的候选评分中排名靠前。');
        }
        if (selectionReason === 'immediate-win') summary = '识别到立即获胜机会，优先执行胜利行动。';
        else if (selectionReason === 'defense-priority') summary = '当前存在紧急威胁，优先选择防守效果最好的候选行动。';

        const search = this.lastSearchStats ? {
            completedDepth: this.lastSearchStats.completedDepth,
            nodes: this.lastSearchStats.nodes,
            elapsedMs: this.lastSearchStats.elapsedMs,
            transpositionHits: this.lastSearchStats.transpositionHits
        } : null;
        return {
            title: 'AI 行动分析',
            summary,
            details: details.slice(0, 4),
            search
        };
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
        return this.adapter.generateMoves(game, side, bases);
    }

    _distanceToBase(game, side, baseId) {
        return this.adapter.distanceToBase(game, side, baseId);
    }

    _scoreMove(game, move, side, bases, simulatedNext = null) {
        return this.positionEvaluator.scoreMove(game, move, side, bases, simulatedNext);
    }

    _simulateMove(game, move, side, bases, options = {}) {
        return this.adapter.simulateMove(game, move, side, bases, options);
    }

    _simulatePass(game, side) {
        return this.adapter.simulatePass(game, side);
    }

    _evaluateState(game, perspective, bases) {
        return this.positionEvaluator.evaluateState(game, perspective, bases);
    }

    _search(game, rankedMoves, side, bases) {
        // Search every legal root candidate; static ordering must not permanently
        // discard a move before the search can evaluate its consequences.
        const rootMoves = rankedMoves;
        const preparedChildren = new WeakMap();
        const preparedMoveOrder = new WeakMap();
        const positionKeyCache = new WeakMap();
        const moveKey = move => `${move.parentNodeId}:${move.targetAreaId}`;

        // Root candidates were already simulated while calculating their
        // heuristic scores. Reuse those detached states across every
        // iterative-deepening pass.
        const rootChildren = new Map();
        for (const move of rootMoves) {
            const next = move._nextState || this._simulateMove(
                game, move, side, bases, { alreadyValidated: true }
            );
            if (next) rootChildren.set(moveKey(move), next);
        }
        preparedChildren.set(game, rootChildren);

        const result = this.searchEngine.search({
            rootState: game,
            rootMoves,
            isTerminal: state => this.adapter.isTerminal(state),
            getSideToMove: state => this.adapter.getSideToMove(state),
            getMoveKey: moveKey,
            maxDepth: this.profile.maxDepth,
            timeBudgetMs: this.profile.searchBudgetMs,
            maxNodes: this.profile.maxNodes,
            getPositionKey: state => {
                let key = positionKeyCache.get(state);
                if (key === undefined) {
                    key = this.adapter.getPositionKey(state);
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
            onProgress: progress => this._emitProgress(progress),
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

}
