// js/ai/TacticalAnalyzer.js
/**
 * Tactical pattern detection over legal moves and authoritative simulations.
 * Opponent replies are generated and simulated once per position so immediate
 * wins and structural losses share the same authoritative result.
 */
export class TacticalAnalyzer {
    findImmediateWinningMove(moves, side, bases) {
        const enemyBaseId = bases[side === 'red' ? 'blue' : 'red'];
        return moves.find(move => move.targetAreaId === enemyBaseId) || null;
    }

    analyzeOpponentReplies(game, defenderSide, attackerSide, bases, generateMoves, simulateMove) {
        const risk = {
            immediateWinningMoves: 0,
            rootLossReplies: 0,
            maxRootLoss: 0,
            maxNodeLoss: 0,
            maxCascadeLoss: 0
        };
        const beforeNodes = game.getAliveNodesByOwner(defenderSide);
        const beforeIds = new Set(beforeNodes.map(node => node.id));
        const beforeRoots = game.getPlayerRootNodes(defenderSide);
        const beforeRootIds = new Set(beforeRoots.map(node => node.id));
        if (game.isGameOver || !beforeRoots.length) return risk;

        const replies = generateMoves(game, attackerSide, bases);
        for (const move of replies) {
            if (move.targetAreaId === bases[defenderSide]) {
                risk.immediateWinningMoves++;
                continue;
            }
            if (!move.attacks) continue;

            const next = move._nextState || simulateMove(game, move, attackerSide, bases);
            if (!next) continue;
            if (next.isGameOver && !next.getPlayerRootNodes(attackerSide).length) {
                risk.immediateWinningMoves++;
            }

            const afterNodes = next.getAliveNodesByOwner(defenderSide);
            const afterIds = new Set(afterNodes.map(node => node.id));
            const removedIds = [...beforeIds].filter(id => !afterIds.has(id));
            const afterRootIds = new Set(next.getPlayerRootNodes(defenderSide).map(node => node.id));
            const rootLoss = [...beforeRootIds].filter(id => !afterRootIds.has(id)).length;
            const directTarget = beforeNodes.find(node => node.areaId === move.targetAreaId);
            const directTargetId = directTarget?.id;
            const cascadeLoss = removedIds.filter(id =>
                id !== directTargetId && !beforeRootIds.has(id)
            ).length;

            if (rootLoss > 0) risk.rootLossReplies++;
            risk.maxRootLoss = Math.max(risk.maxRootLoss, rootLoss);
            risk.maxNodeLoss = Math.max(risk.maxNodeLoss, removedIds.length);
            risk.maxCascadeLoss = Math.max(risk.maxCascadeLoss, cascadeLoss);
        }
        return risk;
    }

    countImmediateWinningMoves(game, side, bases, generateMoves, simulateMove) {
        const opponent = side === 'red' ? 'blue' : 'red';
        return this.analyzeOpponentReplies(
            game, opponent, side, bases, generateMoves, simulateMove
        ).immediateWinningMoves;
    }

    measureAttackRisk(game, defenderSide, attackerSide, bases, generateMoves, simulateMove) {
        const { immediateWinningMoves, ...risk } = this.analyzeOpponentReplies(
            game, defenderSide, attackerSide, bases, generateMoves, simulateMove
        );
        return risk;
    }

    rankDefenses(game, moves, side, bases, simulateMove, generateMoves) {
        const opponent = side === 'red' ? 'blue' : 'red';
        const originalTurn = game.currentTurn;
        const analysisCache = new WeakMap();
        const analyze = state => {
            let result = analysisCache.get(state);
            if (!result) {
                result = this.analyzeOpponentReplies(
                    state, side, opponent, bases, generateMoves, simulateMove
                );
                analysisCache.set(state, result);
            }
            return result;
        };

        game.currentTurn = opponent;
        let currentThreats;
        try {
            currentThreats = this.analyzeOpponentReplies(
                game, side, opponent, bases, generateMoves, simulateMove
            ).immediateWinningMoves;
        } finally {
            game.currentTurn = originalTurn;
        }

        // Immediate wins remain the highest-priority tactical threat.
        if (currentThreats) {
            const ranked = moves.map(move => {
                const next = move._nextState || simulateMove(game, move, side, bases);
                if (!next) return { move, remainingThreats: Infinity };
                const remainingThreats = !next.getPlayerRootNodes(side).length
                    ? Infinity
                    : next.isGameOver
                        ? 0
                        : analyze(next).immediateWinningMoves;
                return { move, remainingThreats };
            });
            const minimum = Math.min(...ranked.map(item => item.remainingThreats));
            return ranked
                .filter(item => item.remainingThreats === minimum)
                .map(item => item.move);
        }

        // Analyze each resulting position once. The same reply simulations
        // provide immediate-win, root-loss, total-loss, and cascade metrics.
        const rootRisk = moves.map(move => {
            const next = move._nextState || simulateMove(game, move, side, bases);
            if (!next || !next.getPlayerRootNodes(side).length) {
                return { move, immediateWinningMoves: Infinity, maxRootLoss: Infinity,
                    rootLossReplies: Infinity, maxCascadeLoss: Infinity };
            }
            if (next.isGameOver) {
                return { move, immediateWinningMoves: 0, maxRootLoss: 0,
                    rootLossReplies: 0, maxCascadeLoss: 0 };
            }
            return { move, ...analyze(next) };
        });
        const finiteRisk = rootRisk.filter(item => Number.isFinite(item.maxRootLoss));
        if (!finiteRisk.length) return moves;

        const minimumImmediateWins = Math.min(...finiteRisk.map(item => item.immediateWinningMoves));
        const immediateSafe = finiteRisk.filter(item => item.immediateWinningMoves === minimumImmediateWins);
        const minimumRootLoss = Math.min(...immediateSafe.map(item => item.maxRootLoss));
        const rootSafe = immediateSafe.filter(item => item.maxRootLoss === minimumRootLoss);
        const minimumRootLossReplies = Math.min(...rootSafe.map(item => item.rootLossReplies));
        const rootStable = rootSafe.filter(item => item.rootLossReplies === minimumRootLossReplies);
        const minimumCascadeLoss = Math.min(...rootStable.map(item => item.maxCascadeLoss));
        return rootStable
            .filter(item => item.maxCascadeLoss === minimumCascadeLoss)
            .map(item => item.move);
    }
}
