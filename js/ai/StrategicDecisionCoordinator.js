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
            nodes: 0, workUnits: 0, totalNodes: 0, totalWorkUnits: 0,
            mandatoryDefenseNodes: 0, mandatoryDefenseWorkUnits: 0,
            complete: true, forcedWin: false, forcedMaterialGain: false,
            forcedTacticalSequence: false, counterattackSequence: false,
            inducementValidated: false, inducedDefenseBranches: 0,
            sacrificeValidated: false, opponentAttackReplies: 0,
            guaranteedSelfLoss: 0, guaranteedRootLoss: 0,
            guaranteedCascadeLoss: 0, guaranteedNodeLoss: 0,
            guaranteedNetNodeGain: 0
        };

        const immediateWin = findImmediateWin(rankedMoves);
        if (immediateWin) {
            return { move: immediateWin, reason: 'immediate-win', tacticalStats: emptyStats };
        }

        const totalTacticalBudget = Math.min(12000, maxNodes);
        let usedWorkUnits = 0;
        let proofWorkUnits = 0;
        let proofNodes = 0;
        let proofComplete = true;
        const defense = analyzeMandatoryDefense(rankedMoves, {
            maxNodes: Math.min(4000, totalTacticalBudget)
        });
        const defenseWorkUnits = defense.workUnits ?? defense.nodes ?? 0;
        const defenseNodes = defense.nodes ?? 0;
        usedWorkUnits += defenseWorkUnits;
        const candidates = defense.complete === false
            ? rankedMoves
            : defense.hasImmediateThreat ? defense.moves : rankedMoves;
        const defensePriority = defense.complete !== false &&
            defense.hasImmediateThreat && candidates.length < rankedMoves.length;

        const makeStats = (overrides = {}) => ({
            ...emptyStats,
            nodes: proofNodes,
            workUnits: proofWorkUnits,
            totalNodes: defenseNodes + proofNodes,
            totalWorkUnits: usedWorkUnits,
            mandatoryDefenseNodes: defenseNodes,
            mandatoryDefenseWorkUnits: defenseWorkUnits,
            complete: proofComplete,
            defenseComplete: defense.complete !== false,
            ...overrides
        });

        const runBounded = (analyzer, stageLimit = Infinity) => {
            const result = analyzer({
                maxNodes: Math.max(0, Math.min(stageLimit, totalTacticalBudget - usedWorkUnits))
            });
            const stageWorkUnits = result.workUnits ?? result.nodes ?? 0;
            usedWorkUnits += stageWorkUnits;
            proofWorkUnits += stageWorkUnits;
            proofNodes += result.nodes ?? 0;
            proofComplete = proofComplete && result.complete !== false;
            return result;
        };

        const win = runBounded(options => findForcedWin(candidates, options), 4000);
        if (win.moves.length) {
            return {
                move: win.moves[0],
                reason: 'forced-sequence-win',
                candidates,
                defense,
                tacticalStats: makeStats({ forcedWin: true })
            };
        }

        const material = runBounded(options => findForcedMaterialGain(candidates, options), 4000);
        if (material.moves.length) {
            return {
                move: material.moves[0],
                reason: 'forced-material-gain',
                candidates,
                defense,
                tacticalStats: makeStats({
                    guaranteedRootLoss: material.guaranteedRootLoss ?? 0,
                    guaranteedCascadeLoss: material.guaranteedCascadeLoss ?? 0,
                    guaranteedNodeLoss: material.guaranteedNodeLoss ?? 0,
                    guaranteedNetNodeGain: material.guaranteedNetNodeGain ?? 0,
                    guaranteedSelfLoss: material.guaranteedSelfLoss ?? 0,
                    forcedMaterialGain: true
                })
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
                tacticalStats: makeStats({
                    forcedTacticalSequence: true,
                    counterattackSequence: extended.opponentAttackReplies > 0,
                    inducementValidated: Boolean(extended.inducementValidated),
                    inducedDefenseBranches: extended.inducedDefenseBranches ?? 0,
                    sacrificeValidated: Boolean(extended.sacrificeValidated),
                    opponentAttackReplies: extended.opponentAttackReplies ?? 0,
                    guaranteedSelfLoss: extended.guaranteedSelfLoss ?? 0,
                    guaranteedRootLoss: extended.guaranteedRootLoss ?? 0,
                    guaranteedCascadeLoss: extended.guaranteedCascadeLoss ?? 0,
                    guaranteedNetNodeGain: extended.guaranteedNodeGain ?? 0
                })
            };
        }

        return {
            move: search(candidates, {
                maxNodes: Math.max(0, maxNodes - usedWorkUnits)
            }),
            reason: defensePriority ? 'defense-priority' : 'search-selection',
            candidates,
            defense,
            tacticalStats: makeStats()
        };
    }
}
