// js/ai/StrategicAnalyzer.js
/**
 * Converts overlapping phase signals into deterministic, bounded evaluation
 * multipliers and spatial bonuses. Baseline profile values remain authoritative;
 * phase signals only adjust their relative importance for the current position.
 */
export class StrategicAnalyzer {
    getDynamicWeights(profile, phase) {
        return Object.freeze({
            progressWeight: profile.progressWeight * (1 + phase.expansion * 0.2 + phase.siege * 0.1),
            attackWeight: profile.attackWeight * (1 + phase.tactical * 0.45),
            rootAttackWeight: profile.rootAttackWeight * (1 + phase.tactical * 0.55),
            expansionWeight: profile.expansionWeight * (1 + phase.expansion * 0.4),
            safetyWeight: profile.safetyWeight * (1 + phase.defense * 0.65),
            structureWeight: profile.structureWeight * (1 + phase.multiRoot * 0.2),
            branchingWeight: profile.branchingWeight * (1 + phase.expansion * 0.25),
            rootSafetyWeight: profile.rootSafetyWeight * (1 + phase.defense * 0.5),
            rootChainRiskWeight: profile.rootChainRiskWeight * (1 + phase.defense * 0.55),
            softDistanceWeight: profile.softDistanceWeight * (1 + phase.expansion * 0.2),
            growthHeadroomWeight: profile.growthHeadroomWeight * (1 + phase.expansion * 0.45),
            baseThreatWeight: profile.baseThreatWeight * (1 + phase.tactical * 0.7),
            siegePreparationWeight: profile.siegePreparationWeight * (1 + phase.siege * 0.6),
            siegeFortressWeight: profile.siegeFortressWeight * (1 + phase.siege * 0.4)
        });
    }

    evaluateSpatial(position, profile) {
        return position.expansionPotential * profile.expansionPotentialWeight +
            position.frontierControl * profile.frontierControlWeight +
            position.multiRootCoordination * profile.multiRootCoordinationWeight +
            position.rootSafety * profile.rootSafetyPotentialWeight -
            position.defensivePressure * profile.defensivePressureWeight;
    }
}
