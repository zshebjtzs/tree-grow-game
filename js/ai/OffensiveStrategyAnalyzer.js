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
        const ownBeforeIds = new Set(ownBefore.map(node => node.id));
        const enemyBeforeIds = new Set(enemyBefore.map(node => node.id));
        const enemyRootBeforeIds = new Set(game.getPlayerRootNodes(enemy).map(root => root.id));
        const opportunities = [];

        for (const move of moves) {
            if (!move.attacks || !move._nextState) continue;

            const next = move._nextState;
            const ownAfter = next.getAliveNodesByOwner(side);
            const enemyAfter = next.getAliveNodesByOwner(enemy);
            const ownAfterIds = new Set(ownAfter.map(node => node.id));
            const enemyAfterIds = new Set(enemyAfter.map(node => node.id));
            const enemyRootAfterIds = new Set(next.getPlayerRootNodes(enemy).map(root => root.id));
            const ownRootsAfter = next.getPlayerRootNodes(side).length;
            const enemyRootsAfter = enemyRootAfterIds.size;
            const enemyNodeLoss = [...enemyBeforeIds].filter(id => !enemyAfterIds.has(id)).length;
            const ownNodeLoss = [...ownBeforeIds].filter(id => !ownAfterIds.has(id)).length;
            const directTarget = enemyBefore.some(node => node.areaId === move.targetAreaId);
            const cascadeLoss = Math.max(0, enemyNodeLoss - (directTarget ? 1 : 0));
            const enemyRootLoss = [...enemyRootBeforeIds].filter(id => !enemyRootAfterIds.has(id)).length;
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
