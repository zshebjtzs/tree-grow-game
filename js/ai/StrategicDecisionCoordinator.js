// js/ai/StrategicDecisionCoordinator.js
/**
 * Applies one explicit priority order to tactical and strategic decisions.
 * Expensive analyzers are lazy callbacks so a higher-priority result prevents
 * lower-priority work from consuming time or replacing the chosen action.
 */
export class StrategicDecisionCoordinator {
    resolve({
        rankedMoves,
        maxNodes,
        findImmediateWin,
        analyzeMandatoryDefense,
        findForcedWin,
        findForcedMaterialGain,
        findExtendedTactic,
        search
    }) {
        const emptyStats = {
            nodes: 0, complete: true, forcedWin: false,
            forcedMaterialGain: false, forcedTacticalSequence: false,
            counterattackSequence: false, inducementValidated: false,
            inducedDefensiveReplies: 0, sacrificeValidated: false,
            opponentAttackReplies: 0, guaranteedSelfLoss: 0,
            guaranteedRootLoss: 0, guaranteedCascadeLoss: 0, guaranteedNodeLoss: 0
        };

        const immediateWin = findImmediateWin(rankedMoves);
        if (immediateWin) {
            return { move: immediateWin, reason: 'immediate-win', tacticalStats: emptyStats };
        }

        const defense = analyzeMandatoryDefense(rankedMoves);
        const candidates = defense.hasImmediateThreat ? defense.moves : rankedMoves;
        const defensePriority = defense.hasImmediateThreat && candidates.length < rankedMoves.length;
        const totalTacticalBudget = Math.min(1200, maxNodes);
        let usedNodes = 0;
        let allComplete = true;

        const runBounded = (analyzer, stageLimit = Infinity) => {
            const result = analyzer({
                maxNodes: Math.max(0, Math.min(stageLimit, totalTacticalBudget - usedNodes))
            });
            usedNodes += result.nodes ?? 0;
            allComplete = allComplete && result.complete !== false;
            return result;
        };

        const win = runBounded(options => findForcedWin(candidates, options), 600);
        if (win.moves.length) {
            return {
                move: win.moves[0],
                reason: 'forced-sequence-win',
                candidates,
                defense,
                tacticalStats: { ...emptyStats, nodes: usedNodes, complete: allComplete, forcedWin: true }
            };
        }

        const material = runBounded(options => findForcedMaterialGain(candidates, options));
        if (material.moves.length) {
            return {
                move: material.moves[0],
                reason: 'forced-material-gain',
                candidates,
                defense,
                tacticalStats: {
                    ...emptyStats,
                    nodes: usedNodes,
                    complete: allComplete,
                    guaranteedRootLoss: material.guaranteedRootLoss ?? 0,
                    guaranteedCascadeLoss: material.guaranteedCascadeLoss ?? 0,
                    guaranteedNodeLoss: material.guaranteedNodeLoss ?? 0,
                    forcedMaterialGain: true
                }
            };
        }

        const extended = runBounded(options => findExtendedTactic(candidates, options));
        if (extended.moves.length) {
            const reason = extended.sacrificeValidated
                ? 'validated-tactical-sacrifice'
                : extended.opponentAttackReplies > 0
                    ? 'forced-counterattack-sequence'
                    : extended.inducementValidated
                        ? 'validated-tactical-inducement'
                        : 'forced-three-move-sequence';
            return {
                move: extended.moves[0],
                reason,
                candidates,
                defense,
                tacticalStats: {
                    ...emptyStats,
                    nodes: usedNodes,
                    complete: allComplete,
                    forcedTacticalSequence: true,
                    counterattackSequence: extended.opponentAttackReplies > 0,
                    inducementValidated: Boolean(extended.inducementValidated),
                    inducedDefensiveReplies: extended.inducedDefensiveReplies ?? 0,
                    sacrificeValidated: Boolean(extended.sacrificeValidated),
                    opponentAttackReplies: extended.opponentAttackReplies ?? 0,
                    guaranteedSelfLoss: extended.guaranteedSelfLoss ?? 0,
                    guaranteedRootLoss: extended.guaranteedRootLoss ?? 0,
                    guaranteedCascadeLoss: extended.guaranteedCascadeLoss ?? 0,
                    guaranteedNodeLoss: extended.guaranteedNodeGain ?? 0
                }
            };
        }

        return {
            move: search(candidates),
            reason: defensePriority ? 'defense-priority' : 'search-selection',
            candidates,
            defense,
            tacticalStats: { ...emptyStats, nodes: usedNodes, complete: allComplete }
        };
    }
}
