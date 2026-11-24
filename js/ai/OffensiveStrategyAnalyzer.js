// js/ai/OffensiveStrategyAnalyzer.js
/**
 * Describes the concrete value of legal attack candidates using authoritative
 * simulated states. This layer observes outcomes; it does not duplicate combat
 * rules, invent forced lines, or assign speculative strategic scores.
 */
export class OffensiveStrategyAnalyzer {
    analyze(game, side, moves) {
        const enemy = side === 'red' ? 'blue' : 'red';
        const ownBefore = game.getAliveNodesByOwner(side);
        const enemyBefore = game.getAliveNodesByOwner(enemy);
        const ownRootCount = game.getPlayerRootNodes(side).length;
        const enemyRootsBefore = game.getPlayerRootNodes(enemy).length;
        const opportunities = [];

        for (const move of moves) {
            if (!move.attacks || !move._nextState) continue;

            const next = move._nextState;
            const ownAfter = next.getAliveNodesByOwner(side);
            const enemyAfter = next.getAliveNodesByOwner(enemy);
            const ownRootsAfter = next.getPlayerRootNodes(side).length;
            const enemyRootsAfter = next.getPlayerRootNodes(enemy).length;
            const enemyNodeLoss = Math.max(0, enemyBefore.length - enemyAfter.length);
            const ownNodeLoss = Math.max(0, ownBefore.length - ownAfter.length);
            const directTarget = enemyBefore.some(node => node.areaId === move.targetAreaId);
            const cascadeLoss = Math.max(0, enemyNodeLoss - (directTarget ? 1 : 0));
            const enemyRootLoss = Math.max(0, enemyRootsBefore - enemyRootsAfter);
            const immediateWin = enemyRootsAfter === 0 && ownRootsAfter > 0 ||
                Boolean(next.isGameOver && ownRootsAfter > 0);
            const highValue = immediateWin || enemyRootLoss > 0 ||
                enemyNodeLoss >= 2 || cascadeLoss >= 2;

            opportunities.push(Object.freeze({
                parentNodeId: move.parentNodeId,
                targetAreaId: move.targetAreaId,
                enemyNodeLoss,
                enemyRootLoss,
                cascadeLoss,
                ownNodeLoss,
                immediateWin,
                highValue
            }));
        }

        const highValueOpportunities = opportunities
            .filter(item => item.highValue)
            .sort((a, b) =>
                Number(b.immediateWin) - Number(a.immediateWin) ||
                b.enemyRootLoss - a.enemyRootLoss ||
                b.cascadeLoss - a.cascadeLoss ||
                b.enemyNodeLoss - a.enemyNodeLoss ||
                a.ownNodeLoss - b.ownNodeLoss
            );

        return Object.freeze({
            candidateCount: moves.length,
            attackCandidateCount: opportunities.length,
            immediateWinningAttackCount: opportunities.filter(item => item.immediateWin).length,
            rootAttackCount: opportunities.filter(item => item.enemyRootLoss > 0).length,
            cascadeAttackCount: opportunities.filter(item => item.cascadeLoss > 0).length,
            highValueAttackCount: highValueOpportunities.length,
            maxEnemyNodeLoss: Math.max(0, ...opportunities.map(item => item.enemyNodeLoss)),
            maxEnemyRootLoss: Math.max(0, ...opportunities.map(item => item.enemyRootLoss)),
            opportunities: Object.freeze(highValueOpportunities.slice(0, 8))
        });
    }
}
