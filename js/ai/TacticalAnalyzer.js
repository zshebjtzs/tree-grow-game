// js/ai/TacticalAnalyzer.js
/**
 * Tactical pattern detection over legal moves and authoritative simulations.
 * This class deliberately delegates move generation and simulation so its
 * conclusions use the same rules as the live game.
 */
export class TacticalAnalyzer {
    findImmediateWinningMove(moves, side, bases) {
        const enemyBaseId = bases[side === 'red' ? 'blue' : 'red'];
        return moves.find(move => move.targetAreaId === enemyBaseId) || null;
    }

    countImmediateWinningMoves(game, side, bases, generateMoves, simulateMove) {
        if (game.isGameOver || !game.getPlayerRootNodes(side).length) return 0;
        const moves = generateMoves(game, side, bases);
        let count = 0;
        for (const move of moves) {
            if (move.targetAreaId === bases[side === 'red' ? 'blue' : 'red']) {
                count++;
                continue;
            }
            const next = move._nextState || simulateMove(game, move, side, bases);
            if (next?.isGameOver && !next.getPlayerRootNodes(side === 'red' ? 'blue' : 'red').length) {
                count++;
            }
        }
        return count;
    }

    measureAttackRisk(game, defenderSide, attackerSide, bases, generateMoves, simulateMove) {
        const beforeRoots = game.getPlayerRootNodes(defenderSide).length;
        const beforeNodes = game.getAliveNodesByOwner(defenderSide).length;
        const risk = {
            rootLossReplies: 0,
            maxRootLoss: 0,
            maxNodeLoss: 0,
            maxCascadeLoss: 0
        };
        if (game.isGameOver || !beforeRoots) return risk;

        for (const move of generateMoves(game, attackerSide, bases)) {
            if (!move.attacks) continue;
            const next = simulateMove(game, move, attackerSide, bases);
            if (!next) continue;

            const rootLoss = Math.max(
                0,
                beforeRoots - next.getPlayerRootNodes(defenderSide).length
            );
            const nodeLoss = Math.max(
                0,
                beforeNodes - next.getAliveNodesByOwner(defenderSide).length
            );
            if (rootLoss > 0) risk.rootLossReplies++;
            risk.maxRootLoss = Math.max(risk.maxRootLoss, rootLoss);
            risk.maxNodeLoss = Math.max(risk.maxNodeLoss, nodeLoss);

            // One lost node is the directly attacked target. Additional losses
            // represent the ancestor/subtree cascade resolved by CombatResolver.
            const cascadeLoss = Math.max(0, nodeLoss - rootLoss - 1);
            risk.maxCascadeLoss = Math.max(risk.maxCascadeLoss, cascadeLoss);
        }
        return risk;
    }

    rankDefenses(game, moves, side, bases, simulateMove, generateMoves) {
        const opponent = side === 'red' ? 'blue' : 'red';
        const originalTurn = game.currentTurn;
        game.currentTurn = opponent;
        let currentThreats;
        try {
            currentThreats = this.countImmediateWinningMoves(
                game, opponent, bases, generateMoves, simulateMove
            );
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
                        : this.countImmediateWinningMoves(
                            next, opponent, bases, generateMoves, simulateMove
                        );
                return { move, remainingThreats };
            });
            const minimum = Math.min(...ranked.map(item => item.remainingThreats));
            return ranked
                .filter(item => item.remainingThreats === minimum)
                .map(item => item.move);
        }

        // A move can expose a root to a one-reply attack without immediately
        // losing the game. Check the resulting position, not only the position
        // before our move, and prefer candidates that prevent root destruction.
        const rootRisk = moves.map(move => {
            const next = move._nextState || simulateMove(game, move, side, bases);
            if (!next || !next.getPlayerRootNodes(side).length) {
                return { move, rootLossReplies: Infinity };
            }
            if (next.isGameOver) {
                return { move, immediateWinningReplies: 0, maxRootLoss: 0, rootLossReplies: 0, maxCascadeLoss: 0 };
            }
            return {
                move,
                immediateWinningReplies: this.countImmediateWinningMoves(
                    next, opponent, bases, generateMoves, simulateMove
                ),
                ...this.measureAttackRisk(
                    next, side, opponent, bases, generateMoves, simulateMove
                )
            };
        });
        const finiteRisk = rootRisk.filter(item => Number.isFinite(item.maxRootLoss));
        if (!finiteRisk.length) return moves;

        // Do not create a new immediate win for the opponent. Once those
        // replies are minimized, root survival dominates; when root risk is
        // equal, minimize cascading structural loss.
        const minimumImmediateWins = Math.min(...finiteRisk.map(item => item.immediateWinningReplies));
        const immediateSafe = finiteRisk.filter(item => item.immediateWinningReplies === minimumImmediateWins);
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
