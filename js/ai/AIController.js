// js/ai/AIController.js
import { SearchEngine } from './SearchEngine.js';
import { OffensiveStrategyAnalyzer } from './OffensiveStrategyAnalyzer.js';
import { StrategicDecisionCoordinator } from './StrategicDecisionCoordinator.js';
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
            typeof this.adapter.tacticalAnalyzer?.findMandatoryDefenses !== 'function' ||
            typeof this.adapter.tacticalAnalyzer?.findForcedWinInTwoMoves !== 'function' ||
            typeof this.adapter.tacticalAnalyzer?.findForcedTacticalSequenceInThreeMoves !== 'function') {
            throw new TypeError('AI 适配器接口无效');
        }

        this.ruleEngine = this.adapter.ruleEngine;
        this.distanceCache = this.adapter.distanceCache;
        this.tacticalAnalyzer = this.adapter.tacticalAnalyzer;
        this.positionEvaluator = this.adapter.positionEvaluator;
        this.searchEngine = new SearchEngine();
        this.offensiveStrategyAnalyzer = new OffensiveStrategyAnalyzer();
        this.decisionCoordinator = new StrategicDecisionCoordinator();
        this.lastOffensiveAnalysis = null;
        this.lastSearchStats = null;
        this.lastTacticalSequenceStats = null;
        this.lastPreparationWorkUnits = 0;
    }

    getBestMove(gameStateData, playerSide) {
        if (!this.adapter.isValidSide(playerSide)) {
            throw new TypeError('AI 玩家阵营无效');
        }
        this.lastSearchStats = null;
        this.lastOffensiveAnalysis = null;
        this.lastTacticalSequenceStats = {
            nodes: 0, complete: true, forcedWin: false,
            forcedMaterialGain: false, forcedTacticalSequence: false,
            counterattackSequence: false, inducementValidated: false,
            inducedDefenseBranches: 0, sacrificeValidated: false,
            opponentAttackReplies: 0, guaranteedSelfLoss: 0,
            guaranteedRootLoss: 0, guaranteedCascadeLoss: 0, guaranteedNodeLoss: 0
        };
        this.lastDecisionExplanation = null;
        this.lastDecisionReason = null;
        // Quality is bounded by completed depth and node count, not elapsed time.
        // Search runs in a Worker, so deeper analysis does not block rendering.
        const decisionStartedAt = this.searchEngine.now();
        const decisionDeadline = Infinity;
        const game = this.adapter.createState(gameStateData);
        this.adapter.setSideToMove(game, playerSide);
        const bases = this.adapter.getBases(gameStateData);

        this._emitProgress({ phase: 'generating', completedCandidates: 0, totalCandidates: 0 });
        const moves = this._generateMoves(game, playerSide, bases);
        let preparationWorkUnits = moves.length + 1;
        if (!moves.length) {
            this.lastPreparationWorkUnits = preparationWorkUnits;
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
            const score = this._scoreMove(game, move, playerSide, bases, nextState);
            preparationWorkUnits += 2;
            ranked.push({ ...move, score, _nextState: nextState });
            if ((index + 1) % reportInterval === 0 || index + 1 === moves.length) {
                this._emitProgress({
                    phase: 'evaluating',
                    completedCandidates: index + 1,
                    totalCandidates: moves.length
                });
            }
        }
        ranked.sort((a, b) => b.score - a.score);
        preparationWorkUnits += Math.max(1, moves.length * Math.ceil(Math.log2(Math.max(2, moves.length))));
        const advantageFactor = this.positionEvaluator.getAdvantageConversionFactor(
            game, playerSide, bases
        );
        const disadvantageRiskFactor = this.positionEvaluator.getDisadvantageRiskFactor(
            game, playerSide, bases
        );
        this.lastOffensiveAnalysis = this.offensiveStrategyAnalyzer.analyze(
            game, playerSide, ranked, { advantageFactor, riskFactor: disadvantageRiskFactor }
        );
        preparationWorkUnits += moves.length + 2;
        this.lastPreparationWorkUnits = preparationWorkUnits;

        const decision = this.decisionCoordinator.resolve({
            rankedMoves: ranked,
            maxNodes: Math.max(0, this.profile.maxNodes - preparationWorkUnits),
            findImmediateWin: candidates =>
                this.tacticalAnalyzer.findImmediateWinningMove(candidates, playerSide, bases),
            analyzeMandatoryDefense: (candidates, budget) => {
                this._emitProgress({ phase: 'tactics' });
                return this.tacticalAnalyzer.findMandatoryDefenses(
                    game, candidates, playerSide, bases,
                    (state, move, side, matchBases) => this._simulateMove(
                        state, move, side, matchBases, { alreadyValidated: true }
                    ),
                    (state, side, matchBases) => this._generateMoves(state, side, matchBases),
                    { maxNodes: budget.maxNodes, shouldStop: () => this.searchEngine.now() >= decisionDeadline }
                );
            },
            findForcedWin: (candidates, budget) =>
                this.tacticalAnalyzer.findForcedWinInTwoMoves(
                    game, candidates, playerSide, bases,
                    (state, move, side, matchBases) => this._simulateMove(
                        state, move, side, matchBases, { alreadyValidated: true }
                    ),
                    (state, side, matchBases) => this._generateMoves(state, side, matchBases),
                    (state, side) => this._simulatePass(state, side),
                    {
                        maxNodes: Math.min(600, budget.maxNodes),
                        shouldStop: () => this.searchEngine.now() >= decisionDeadline
                    }
                ),
            findForcedMaterialGain: (candidates, budget) =>
                this.tacticalAnalyzer.findForcedMaterialGainInTwoMoves(
                    game, candidates, playerSide, bases,
                    (state, move, side, matchBases) => this._simulateMove(
                        state, move, side, matchBases, { alreadyValidated: true }
                    ),
                    (state, side, matchBases) => this._generateMoves(state, side, matchBases),
                    (state, side) => this._simulatePass(state, side),
                    {
                        maxNodes: budget.maxNodes,
                        shouldStop: () => this.searchEngine.now() >= decisionDeadline
                    }
                ),
            findExtendedTactic: (candidates, budget) =>
                this.tacticalAnalyzer.findForcedTacticalSequenceInThreeMoves(
                    game, candidates, playerSide, bases,
                    (state, move, side, matchBases) => this._simulateMove(
                        state, move, side, matchBases, { alreadyValidated: true }
                    ),
                    (state, side, matchBases) => this._generateMoves(state, side, matchBases),
                    (state, side) => this._simulatePass(state, side),
                    {
                        maxNodes: budget.maxNodes,
                        shouldStop: () => this.searchEngine.now() >= decisionDeadline
                    }
                ),
            search: (candidates, budget) => this._search(
                game, candidates, playerSide, bases, decisionDeadline, decisionStartedAt, budget.maxNodes
            )
        });
        const selectedMove = decision.move;
        const selectionReason = decision.reason;
        this.lastDecisionReason = selectionReason;
        this.lastTacticalSequenceStats = decision.tacticalStats;

        this._recordDecisionTiming(decisionStartedAt, decisionDeadline);
        this.lastDecisionExplanation = this._createDecisionExplanation(
            game, selectedMove, playerSide, bases, ranked, selectionReason
        );
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
            preparationWorkUnits: this.lastPreparationWorkUnits ?? 0,
            totalWorkUnits: (this.lastPreparationWorkUnits ?? 0) + (existing.workUnits ?? 0) +
                (this.lastTacticalSequenceStats?.totalWorkUnits ?? this.lastTacticalSequenceStats?.totalNodes ?? 0),
            preparationMs: existing.preparationMs ?? Math.max(0, completedAt - decisionStartedAt),
            totalMs: Math.max(0, completedAt - decisionStartedAt),
            configuredTargetMs: this.profile.searchBudgetMs,
            deadlineMs: this.profile.searchBudgetMs,
            deadlineExceeded: false,
            decisionReason: this.lastDecisionReason ?? null,
            immediateWinningMove: this.lastDecisionReason === 'immediate-win',
            tacticalSequenceNodes: this.lastTacticalSequenceStats?.nodes ?? 0,
            tacticalSequenceWorkUnits: this.lastTacticalSequenceStats?.workUnits ?? this.lastTacticalSequenceStats?.nodes ?? 0,
            totalTacticalNodes: this.lastTacticalSequenceStats?.totalNodes ?? 0,
            totalTacticalWorkUnits: this.lastTacticalSequenceStats?.totalWorkUnits ?? this.lastTacticalSequenceStats?.totalNodes ?? 0,
            mandatoryDefenseNodes: this.lastTacticalSequenceStats?.mandatoryDefenseNodes ?? 0,
            mandatoryDefenseWorkUnits: this.lastTacticalSequenceStats?.mandatoryDefenseWorkUnits ?? this.lastTacticalSequenceStats?.mandatoryDefenseNodes ?? 0,
            tacticalSequenceComplete: this.lastTacticalSequenceStats?.complete ?? true,
            tacticalDecisionComplete: this.lastTacticalSequenceStats?.complete !== false &&
                this.lastTacticalSequenceStats?.defenseComplete !== false,
            mandatoryDefenseComplete: this.lastTacticalSequenceStats?.defenseComplete ?? true,
            forcedWinInTwoMoves: this.lastTacticalSequenceStats?.forcedWin ?? false,
            forcedMaterialGainInTwoMoves: this.lastTacticalSequenceStats?.forcedMaterialGain ?? false,
            guaranteedTacticalRootLoss: this.lastTacticalSequenceStats?.guaranteedRootLoss ?? 0,
            guaranteedTacticalCascadeLoss: this.lastTacticalSequenceStats?.guaranteedCascadeLoss ?? 0,
            guaranteedTacticalNodeLoss: this.lastTacticalSequenceStats?.guaranteedNodeLoss ?? 0,
            guaranteedTacticalNetNodeGain: this.lastTacticalSequenceStats?.guaranteedNetNodeGain ?? 0,
            guaranteedTacticalSelfLoss: this.lastTacticalSequenceStats?.guaranteedSelfLoss ?? 0,
            forcedTacticalSequenceInThreeMoves: this.lastTacticalSequenceStats?.forcedTacticalSequence ?? false,
            counterattackSequence: this.lastTacticalSequenceStats?.counterattackSequence ?? false,
            inducementValidated: this.lastTacticalSequenceStats?.inducementValidated ?? false,
            inducedDefenseBranches: this.lastTacticalSequenceStats?.inducedDefenseBranches ?? 0,
            sacrificeValidated: this.lastTacticalSequenceStats?.sacrificeValidated ?? false,
            tacticalOpponentAttackReplies: this.lastTacticalSequenceStats?.opponentAttackReplies ?? 0,
            offensiveCandidateCount: this.lastOffensiveAnalysis?.candidateCount ?? 0,
            offensiveAttackCandidateCount: this.lastOffensiveAnalysis?.attackCandidateCount ?? 0,
            offensiveHighValueAttackCount: this.lastOffensiveAnalysis?.highValueAttackCount ?? 0,
            offensiveRootAttackCount: this.lastOffensiveAnalysis?.rootAttackCount ?? 0,
            offensiveCascadeAttackCount: this.lastOffensiveAnalysis?.cascadeAttackCount ?? 0,
            offensiveImmediateWinCount: this.lastOffensiveAnalysis?.immediateWinningAttackCount ?? 0,
            offensiveMaxEnemyNodeLoss: this.lastOffensiveAnalysis?.maxEnemyNodeLoss ?? 0,
            offensiveMaxOwnNodeLoss: this.lastOffensiveAnalysis?.maxOwnNodeLoss ?? 0,
            offensiveMaxEnemyRootLoss: this.lastOffensiveAnalysis?.maxEnemyRootLoss ?? 0,
            offensiveMaxOwnRootLoss: this.lastOffensiveAnalysis?.maxOwnRootLoss ?? 0,
            offensiveBestNetNodeGain: this.lastOffensiveAnalysis?.bestNetNodeGain ?? 0,
            offensiveBestNetRootGain: this.lastOffensiveAnalysis?.bestNetRootGain ?? 0,
            offensiveNegativeExchangeCount: this.lastOffensiveAnalysis?.negativeExchangeCount ?? 0,
            advantageConversionFactor: this.lastOffensiveAnalysis?.advantageFactor ?? 0,
            disadvantageRiskFactor: this.lastOffensiveAnalysis?.disadvantageRiskFactor ?? 0
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

        const sharedDeadline = deadline === Infinity
            ? Infinity
            : Number.isFinite(deadline)
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
            maxNodes,
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
                    checkBudget();
                    if (!next) continue;
                    children.set(moveKey(move), next);
                    const score = this._scoreMove(state, move, movingSide, bases, next);
                    checkBudget();
                    scored.push({ move, score });
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
            preparationWorkUnits: this.lastPreparationWorkUnits ?? 0,
            totalWorkUnits: (this.lastPreparationWorkUnits ?? 0) + (result.workUnits ?? 0) +
                (this.lastTacticalSequenceStats?.totalNodes ?? 0),
            preparationMs: Math.max(0, searchStartedAt - decisionStartedAt),
            totalMs: Math.max(0, completedAt - decisionStartedAt),
            configuredTargetMs: this.profile.searchBudgetMs,
            deadlineMs: this.profile.searchBudgetMs,
            deadlineExceeded: false
        };
        return result.move || rootMoves[0];
    }

}
