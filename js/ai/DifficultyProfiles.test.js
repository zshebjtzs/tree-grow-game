import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTY_LEVELS, getDifficultyProfile } from './DifficultyProfiles.js';

test('six AI difficulty profiles have strictly increasing search budgets', () => {
    assert.deepEqual(DIFFICULTY_LEVELS, [
        'beginner', 'easy', 'medium', 'advanced', 'hard', 'expert'
    ]);

    const profiles = DIFFICULTY_LEVELS.map(getDifficultyProfile);
    for (let index = 1; index < profiles.length; index++) {
        assert.ok(profiles[index].maxDepth > profiles[index - 1].maxDepth);
        assert.ok(profiles[index].searchBudgetMs > profiles[index - 1].searchBudgetMs);
        assert.ok(profiles[index].maxNodes > profiles[index - 1].maxNodes);
    }
});

test('all difficulty profiles share the same evaluation weights', () => {
    const profiles = DIFFICULTY_LEVELS.map(getDifficultyProfile);
    const keys = [
        'progressWeight', 'attackWeight', 'rootAttackWeight', 'expansionWeight',
        'safetyWeight', 'structureWeight', 'branchingWeight', 'rootSafetyWeight',
        'rootChainRiskWeight', 'softDistanceWeight', 'growthHeadroomWeight',
        'baseThreatWeight', 'siegePreparationWeight', 'siegeFortressWeight',
        'advantageConversionThreshold', 'advantageConversionScale', 'advantageConversionWeight',
        'disadvantageRiskThreshold', 'disadvantageRiskScale', 'disadvantageProgressWeight',
        'disadvantageRootAttackWeight', 'disadvantageCascadeWeight', 'disadvantageNetGainWeight',
        'disadvantageSelfLossPenalty', 'disadvantageOwnRootLossPenalty',
        'disadvantageRiskBonusCap', 'disadvantageRiskPenaltyCap'
    ];
    for (const key of keys) {
        assert.ok(profiles.every(profile => profile[key] === profiles[0][key]), `${key} must be shared`);
    }
});
