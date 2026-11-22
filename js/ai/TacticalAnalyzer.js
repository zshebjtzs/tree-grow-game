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

    countRootLossReplies(game, defenderSide, attackerSide, bases, generateMoves, simulateMove) {
        if (game.isGameOver) return 0;
        const rootsBefore = game.getPlayerRootNodes(defenderSide).length;
        if (!rootsBefore) return 0;

        return generateMoves(game, attackerSide, bases)
            .filter(move => move.attacks)
            .reduce((count, move) => {
                const next = simulateMove(game, move, attackerSide, bases);
                if (!next) return count;
                return count + Math.max(
                    0,
                    rootsBefore - next.getPlayerRootNodes(defenderSide).length
                );
            }, 0);
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
                return { move, rootLossReplies: 0 };
            }
            return {
                move,
                rootLossReplies: this.countRootLossReplies(
                    next, side, opponent, bases, generateMoves, simulateMove
                )
            };
        });
        const minimumRootRisk = Math.min(...rootRisk.map(item => item.rootLossReplies));
        if (!Number.isFinite(minimumRootRisk)) return moves;
        return rootRisk
            .filter(item => item.rootLossReplies === minimumRootRisk)
            .map(item => item.move);
    }
}
