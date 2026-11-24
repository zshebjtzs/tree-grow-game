// js/ai/DisadvantageRiskAnalyzer.js
/**
 * Adds bounded comeback-oriented move-ordering value when the current side is
 * objectively behind. It rewards concrete high-leverage outcomes, not risk
 * taking by itself, and never overrides terminal or proven tactical results.
 */
export class DisadvantageRiskAnalyzer {
    getRiskFactor(positionValue, profile) {
        const threshold = profile.disadvantageRiskThreshold ?? 250;
        const scale = Math.max(1, profile.disadvantageRiskScale ?? 1500);
        return Math.max(0, Math.min(1, (-positionValue - threshold) / scale));
    }

    evaluateMove({ riskFactor, progress = 0, exchange = null }, profile) {
        if (riskFactor <= 0) return 0;

        const leverage =
            Math.max(0, progress) * (profile.disadvantageProgressWeight ?? 80) +
            (exchange?.enemyRootLoss ?? 0) * (profile.disadvantageRootAttackWeight ?? 1200) +
            (exchange?.cascadeLoss ?? 0) * (profile.disadvantageCascadeWeight ?? 55) +
            Math.max(0, exchange?.netNodeGain ?? 0) * (profile.disadvantageNetGainWeight ?? 45);

        const selfCost =
            (exchange?.ownNodeLoss ?? 0) * (profile.disadvantageSelfLossPenalty ?? 90) +
            (exchange?.ownRootLoss ?? 0) * (profile.disadvantageOwnRootLossPenalty ?? 2400);

        const boundedValue = Math.max(
            -(profile.disadvantageRiskPenaltyCap ?? 900),
            Math.min(profile.disadvantageRiskBonusCap ?? 1800, leverage - selfCost)
        );
        return boundedValue * riskFactor;
    }
}
