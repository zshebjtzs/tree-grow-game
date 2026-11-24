// js/ai/DifficultyProfiles.js
/**
 * Difficulty profiles share identical rules, evaluation weights, and search
 * implementation. Only the bounded computation budget changes their strength.
 */
const SHARED_EVALUATION = {
    progressWeight: 1,
    attackWeight: 1,
    rootAttackWeight: 1,
    expansionWeight: 1,
    safetyWeight: 1,
    structureWeight: 1,
    branchingWeight: 1,
    rootSafetyWeight: 2500,
    rootChainRiskWeight: 80,
    softDistanceWeight: 0.25,
    growthHeadroomWeight: 12,
    baseThreatWeight: 700,
    siegePreparationWeight: 350,
    siegeFortressWeight: 1500
};

const SEARCH_BUDGETS = {
    beginner: { maxDepth: 1, searchBudgetMs: 25,   maxNodes: 500 },
    easy:     { maxDepth: 2, searchBudgetMs: 50,   maxNodes: 1500 },
    medium:   { maxDepth: 4, searchBudgetMs: 150,  maxNodes: 6000 },
    advanced: { maxDepth: 5, searchBudgetMs: 300,  maxNodes: 12000 },
    hard:     { maxDepth: 9, searchBudgetMs: 1800, maxNodes: 120000 },
    expert:   { maxDepth: 10, searchBudgetMs: 3000, maxNodes: 250000 }
};

const LABELS = {
    beginner: '入门',
    easy: '简单',
    medium: '普通',
    advanced: '进阶',
    hard: '困难',
    expert: '专家'
};

const PROFILES = Object.fromEntries(
    Object.keys(SEARCH_BUDGETS).map(difficulty => [
        difficulty,
        Object.freeze({
            label: LABELS[difficulty],
            ...SHARED_EVALUATION,
            ...SEARCH_BUDGETS[difficulty]
        })
    ])
);

export function getDifficultyProfile(difficulty) {
    const profile = PROFILES[difficulty];
    if (!profile) throw new TypeError('AI 难度无效');
    return profile;
}

export function getDifficultyLabel(difficulty) {
    return PROFILES[difficulty]?.label || difficulty;
}

export const DIFFICULTY_LEVELS = Object.freeze(Object.keys(PROFILES));
