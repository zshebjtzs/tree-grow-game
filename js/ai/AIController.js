// js/ai/AIController.js
import { SearchEngine } from './SearchEngine.js';
import { getDifficultyProfile, DIFFICULTY_LEVELS } from './DifficultyProfiles.js';
import { TreeGrowAIAdapter } from './TreeGrowAIAdapter.js';

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
            'createState', 'getBases', 'isValidSide', 'createNoMoveExplanation', 'setSideToMove',
            'getPositionKey', 'isTerminal', 'getSideToMove', 'getMoveKey',
            'toPublicMove', 'createDecisionExplanation', 'generateMoves',
            'distanceToBase', 'simulateMove', 'simulatePass'
        ];
        if (requiredMethods.some(method => typeof this.adapter[method] !== 'function') ||
            typeof this.adapter.positionEvaluator?.scoreMove !== 'function' ||
            typeof this.adapter.positionEvaluator?.evaluateState !== 'function' ||
            typeof this.adapter.tacticalAnalyzer?.findImmediateWinningMove !== 'function' ||
            typeof this.adapter.tacticalAnalyzer?.rankDefenses !== 'function' ||
            typeof this.adapter.tacticalAnalyzer?.findForcedWinInTwoMoves !== 'function') {
            throw new TypeError('AI 适配器接口无效');
        }

        this.ruleEngine = this.adapter.ruleEngine;
        this.distanceCache = this.adapter.distanceCache;
        this.tacticalAnalyzer = this.adapter.tacticalAnalyzer;
        this.positionEvaluator = this.adapter.positionEvaluator;
        this.searchEngine = new SearchEngine();
        this.lastSearchStats = null;
        this.lastTacticalSequenceStats = null;
    }

    getBestMove(gameStateData, playerSide) {
        if (!this.adapter.isValidSide(playerSide)) {
            throw new TypeError('AI 玩家阵营无效');
        }
        this.lastSearchStats = null;
        this.lastTacticalSequenceStats = { nodes: 0, complete: true, forcedWin: false };
        this.lastDecisionExplanation = null;
        // One deadline covers state preparation, tactical filtering, and search.
        // Preparation remains non-interruptible to preserve mandatory tactical checks;
        // SearchEngine receives the same absolute deadline and uses only the remainder.
        const decisionStartedAt = this.searchEngine.now();
        const decisionDeadline = decisionStartedAt + this.profile.searchBudgetMs;
        const game = this.adapter.createState(gameStateData);
        this.adapter.setSideToMove(game, playerSide);
        const bases = this.adapter.getBases(gameStateData);

        this._emitProgress({ phase: 'generating', completedCandidates: 0, totalCandidates: 0 });
        const moves = this._generateMoves(game, playerSide, bases);
        if (!moves.length) {
            this.lastDecisionExplanation = this.adapter.createNoMoveExplanation();
            this._recordDecisionTiming(decisionStartedAt, decisionDeadline);
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

            const sequenceResult = this.tacticalAnalyzer.findForcedWinInTwoMoves(
                game,
                tacticallyRanked,
                playerSide,
                bases,
                (state, move, side, matchBases) => this._simulateMove(
                    state, move, side, matchBases, { alreadyValidated: true }
                ),
                (state, side, matchBases) => this._generateMoves(state, side, matchBases),
                (state, side) => this._simulatePass(state, side),
                {
                    maxNodes: Math.min(1200, this.profile.maxNodes),
                    shouldStop: () => this.searchEngine.now() >= decisionDeadline
                }
            );
            this.lastTacticalSequenceStats = {
                nodes: sequenceResult.nodes,
                complete: sequenceResult.complete,
                forcedWin: sequenceResult.moves.length > 0
            };

            if (sequenceResult.moves.length) {
                selectedMove = sequenceResult.moves[0];
                selectionReason = 'forced-sequence-win';
            } else {
                selectedMove = this._search(
                    game, tacticallyRanked, playerSide, bases, decisionDeadline, decisionStartedAt
                );
                if (selectionReason !== 'defense-priority') selectionReason = 'search-selection';
            }
        }

        this.lastDecisionExplanation = this._createDecisionExplanation(
            game, selectedMove, playerSide, bases, ranked, selectionReason
        );
        this._recordDecisionTiming(decisionStartedAt, decisionDeadline);
        this._emitProgress({ phase: 'complete', completedCandidates: moves.length, totalCandidates: moves.length });
        return this.adapter.toPublicMove(selectedMove);
    }

    _recordDecisionTiming(decisionStartedAt, deadline) {
        const completedAt = this.searchEngine.now();
        const existing = this.lastSearchStats || {
            difficulty: this.difficulty,
            nodes: 0,
            cutoffs: 0,
            transpositionHits: 0,
            completedDepth: 0,
            elapsedMs: 0
        };
        this.lastSearchStats = {
            ...existing,
            preparationMs: existing.preparationMs ?? Math.max(0, completedAt - decisionStartedAt),
            totalMs: Math.max(0, completedAt - decisionStartedAt),
            deadlineMs: this.profile.searchBudgetMs,
            deadlineExceeded: completedAt > deadline,
            tacticalSequenceNodes: this.lastTacticalSequenceStats?.nodes ?? 0,
            tacticalSequenceComplete: this.lastTacticalSequenceStats?.complete ?? true,
            forcedWinInTwoMoves: this.lastTacticalSequenceStats?.forcedWin ?? false
        };
    }

    _emitProgress(progress) {
        if (typeof this.onProgress !== 'function') return;
        try { this.onProgress(progress); } catch (error) {
            // Progress reporting is observational and must not affect AI decisions.
        }
    }

    _createDecisionExplanation(game, move, side, bases, rankedMoves, selectionReason) {
        return this.adapter.createDecisionExplanation(
            game, move, side, bases, rankedMoves, selectionReason, this.lastSearchStats
        );
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

    _search(game, rankedMoves, side, bases, deadline = null, decisionStartedAt = this.searchEngine.now()) {
        // Search every legal root candidate; static ordering must not permanently
        // discard a move before the search can evaluate its consequences.
        const rootMoves = rankedMoves;
        const preparedChildren = new WeakMap();
        const preparedMoveOrder = new WeakMap();
        const positionKeyCache = new WeakMap();
        const moveKey = move => this.adapter.getMoveKey(move);

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

        const sharedDeadline = Number.isFinite(deadline)
            ? deadline
            : decisionStartedAt + this.profile.searchBudgetMs;
        const searchStartedAt = this.searchEngine.now();
        const result = this.searchEngine.search({
            rootState: game,
            rootMoves,
            isTerminal: state => this.adapter.isTerminal(state),
            getSideToMove: state => this.adapter.getSideToMove(state),
            getMoveKey: moveKey,
            maxDepth: this.profile.maxDepth,
            timeBudgetMs: Math.max(0, sharedDeadline - searchStartedAt),
            deadline: sharedDeadline,
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
                const movingSide = this.adapter.getSideToMove(state);
                for (const move of moves) {
                    checkBudget();
                    const next = this._simulateMove(state, move, movingSide, bases, { alreadyValidated: true });
                    if (!next) continue;
                    children.set(moveKey(move), next);
                    scored.push({
                        move,
                        score: this._scoreMove(state, move, movingSide, bases, next)
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
        const completedAt = this.searchEngine.now();
        this.lastSearchStats = {
            difficulty: this.difficulty,
            ...result,
            preparationMs: Math.max(0, searchStartedAt - decisionStartedAt),
            totalMs: Math.max(0, completedAt - decisionStartedAt),
            deadlineMs: this.profile.searchBudgetMs,
            deadlineExceeded: completedAt > sharedDeadline
        };
        return result.move || rootMoves[0];
    }

}
