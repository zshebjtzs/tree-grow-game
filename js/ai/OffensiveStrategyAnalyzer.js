// js/ai/OffensiveStrategyAnalyzer.js
/**
 * Compares a legal action's authoritative successor state with its parent.
 * Losses are measured by node identity so growth and destruction cannot mask
 * one another through net population counts.
 */
export function analyzeExchangeOutcome(game, side, move, next) {
    const enemy = side === 'red' ? 'blue' : 'red';
    const ownBefore = game.getAliveNodesByOwner(side);
    const enemyBefore = game.getAliveNodesByOwner(enemy);
    const ownAfter = next.getAliveNodesByOwner(side);
    const enemyAfter = next.getAliveNodesByOwner(enemy);
    const ownBeforeIds = new Set(ownBefore.map(node => node.id));
    const enemyBeforeIds = new Set(enemyBefore.map(node => node.id));
    const ownAfterIds = new Set(ownAfter.map(node => node.id));
    const enemyAfterIds = new Set(enemyAfter.map(node => node.id));
    const ownRootBeforeIds = new Set(game.getPlayerRootNodes(side).map(root => root.id));
    const enemyRootBeforeIds = new Set(game.getPlayerRootNodes(enemy).map(root => root.id));
    const ownRootAfterIds = new Set(next.getPlayerRootNodes(side).map(root => root.id));
    const enemyRootAfterIds = new Set(next.getPlayerRootNodes(enemy).map(root => root.id));
    const enemyNodeLoss = [...enemyBeforeIds].filter(id => !enemyAfterIds.has(id)).length;
    const ownNodeLoss = [...ownBeforeIds].filter(id => !ownAfterIds.has(id)).length;
    const ownRootLoss = [...ownRootBeforeIds].filter(id => !ownRootAfterIds.has(id)).length;
    const enemyRootLoss = [...enemyRootBeforeIds].filter(id => !enemyRootAfterIds.has(id)).length;
    const directTarget = enemyBefore.some(node => node.areaId === move.targetAreaId);
    const cascadeLoss = Math.max(0, enemyNodeLoss - (directTarget ? 1 : 0));
    const immediateWin = enemyRootAfterIds.size === 0 && ownRootAfterIds.size > 0 ||
        Boolean(next.isGameOver && ownRootAfterIds.size > 0);

    return Object.freeze({
        enemyNodeLoss,
        ownNodeLoss,
        enemyRootLoss,
        ownRootLoss,
        cascadeLoss,
        netNodeGain: enemyNodeLoss - ownNodeLoss,
        netRootGain: enemyRootLoss - ownRootLoss,
        immediateWin
    });
}

/**
 * Summarizes concrete attack outcomes for one decision. It does not duplicate
 * combat rules, prove non-forced lines, or assign speculative attack bonuses.
 */
export class OffensiveStrategyAnalyzer {
    analyze(game, side, moves, { advantageFactor = 0, riskFactor = 0 } = {}) {
        const opportunities = [];

        for (const move of moves) {
            if (!move.attacks || !move._nextState) continue;

            const outcome = analyzeExchangeOutcome(game, side, move, move._nextState);
            const highValue = outcome.immediateWin || outcome.enemyRootLoss > 0 ||
                outcome.cascadeLoss >= 2 || outcome.netNodeGain >= 2;
            opportunities.push(Object.freeze({
                parentNodeId: move.parentNodeId,
                targetAreaId: move.targetAreaId,
                ...outcome,
                highValue
            }));
        }

        const highValueOpportunities = opportunities
            .filter(item => item.highValue)
            .sort((a, b) =>
                Number(b.immediateWin) - Number(a.immediateWin) ||
                b.netRootGain - a.netRootGain ||
                b.netNodeGain - a.netNodeGain ||
                b.cascadeLoss - a.cascadeLoss ||
                a.ownNodeLoss - b.ownNodeLoss
            );

        return Object.freeze({
            candidateCount: moves.length,
            attackCandidateCount: opportunities.length,
            immediateWinningAttackCount: opportunities.filter(item => item.immediateWin).length,
            rootAttackCount: opportunities.filter(item => item.enemyRootLoss > 0).length,
            cascadeAttackCount: opportunities.filter(item => item.cascadeLoss > 0).length,
            highValueAttackCount: highValueOpportunities.length,
            negativeExchangeCount: opportunities.filter(item => item.netNodeGain < 0 && item.netRootGain <= 0).length,
            maxEnemyNodeLoss: Math.max(0, ...opportunities.map(item => item.enemyNodeLoss)),
            maxOwnNodeLoss: Math.max(0, ...opportunities.map(item => item.ownNodeLoss)),
            maxEnemyRootLoss: Math.max(0, ...opportunities.map(item => item.enemyRootLoss)),
            maxOwnRootLoss: Math.max(0, ...opportunities.map(item => item.ownRootLoss)),
            bestNetNodeGain: Math.max(0, ...opportunities.map(item => item.netNodeGain)),
            bestNetRootGain: Math.max(0, ...opportunities.map(item => item.netRootGain)),
            advantageFactor,
            disadvantageRiskFactor: riskFactor,
            opportunities: Object.freeze(highValueOpportunities.slice(0, 8))
        });
    }
}
