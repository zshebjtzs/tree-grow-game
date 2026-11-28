// js/ai/StrategicDecisionCoordinator.js
/**
 * Coordinates tactical checks before the shared search.
 * Only an immediate win or a fully proven forced win may bypass search.
 * Non-terminal tactical gains are hints, never replacements for global evaluation.
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
            complete: true, defenseComplete: true,
            forcedWin: false, forcedMaterialGain: false,
            forcedTacticalSequence: false, counterattackSequence: false,
            inducementValidated: false, inducedDefenseBranches: 0,
            sacrificeValidated: false, opponentAttackReplies: 0,
            guaranteedSelfLoss: 0, guaranteedRootLoss: 0,
            guaranteedCascadeLoss: 0, guaranteedNodeLoss: 0,
            guaranteedNetNodeGain: 0, tacticalHintCount: 0
        };

        const immediateWin = findImmediateWin(rankedMoves);
        if (immediateWin) {
            return { move: immediateWin, reason: 'immediate-win', tacticalStats: emptyStats };
        }

        // Keep 40% of the remaining work budget for the global search. Tactical
        // proofs are valuable, but must not consume the entire decision budget.
        const totalTacticalBudget = Math.min(12000, Math.floor(maxNodes * 0.6));
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

        const preservesAllCandidates = Array.isArray(defense.moves) &&
            defense.moves.length === rankedMoves.length &&
            rankedMoves.every(move => defense.moves.includes(move));
        const candidates = defense.complete === false ||
            (!defense.hasImmediateThreat && !preservesAllCandidates)
            ? rankedMoves
            : defense.moves;
        const defensePriority = defense.complete !== false &&
            defense.hasImmediateThreat && candidates.length < rankedMoves.length;
        const defenseRiskOrdered = defense.complete !== false &&
            !defense.hasImmediateThreat &&
            candidates.some((move, index) => move !== rankedMoves[index]);

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

        const forcedWin = runBounded(options => findForcedWin(candidates, options), 4000);
        if (forcedWin.moves.length) {
            return {
                move: forcedWin.moves[0],
                reason: 'forced-sequence-win',
                candidates,
                defense,
                tacticalStats: makeStats({ forcedWin: true })
            };
        }

        const tacticalHints = [];
        const hintSet = new Set();
        const addHints = moves => {
            for (const move of moves || []) {
                if (candidates.includes(move) && !hintSet.has(move)) {
                    hintSet.add(move);
                    tacticalHints.push(move);
                }
            }
        };

        const material = runBounded(
            options => findForcedMaterialGain(candidates, options),
            4000
        );
        addHints(material.moves);

        const extended = runBounded(options => findExtendedTactic(candidates, options));
        addHints(extended.moves);

        const tacticalStats = makeStats({
            forcedMaterialGain: material.moves.length > 0,
            forcedTacticalSequence: extended.moves.length > 0,
            counterattackSequence: extended.opponentAttackReplies > 0,
            inducementValidated: Boolean(extended.inducementValidated),
            inducedDefenseBranches: extended.inducedDefenseBranches ?? 0,
            sacrificeValidated: Boolean(extended.sacrificeValidated),
            opponentAttackReplies: extended.opponentAttackReplies ?? 0,
            guaranteedSelfLoss: extended.guaranteedSelfLoss ?? material.guaranteedSelfLoss ?? 0,
            guaranteedRootLoss: material.guaranteedRootLoss ?? extended.guaranteedRootLoss ?? 0,
            guaranteedCascadeLoss: material.guaranteedCascadeLoss ?? extended.guaranteedCascadeLoss ?? 0,
            guaranteedNodeLoss: material.guaranteedNodeLoss ?? extended.guaranteedNodeLoss ?? 0,
            guaranteedNetNodeGain: material.guaranteedNetNodeGain ?? extended.guaranteedNodeGain ?? 0,
            tacticalHintCount: tacticalHints.length
        });

        return {
            move: search(candidates, {
                maxNodes: Math.max(0, maxNodes - usedWorkUnits)
            }, tacticalHints),
            reason: defensePriority ? 'defense-priority' :
                defenseRiskOrdered ? 'defense-risk-order' :
                    tacticalHints.length ? 'search-with-tactical-hints' : 'search-selection',
            candidates,
            defense,
            tacticalHints,
            tacticalStats
        };
    }
}
