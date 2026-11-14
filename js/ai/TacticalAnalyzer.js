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
            const next = simulateMove(game, move, side, bases);
            if (next?.isGameOver && !next.getPlayerRootNodes(side === 'red' ? 'blue' : 'red').length) {
                count++;
            }
        }
        return count;
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
        if (!currentThreats) return moves;

        const ranked = moves.map(move => {
            const next = simulateMove(game, move, side, bases);
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
}
