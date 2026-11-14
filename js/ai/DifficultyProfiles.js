// js/ai/DifficultyProfiles.js
/**
 * Fixed behavior profiles. These tune priorities, not game rules.
 * Tactical wins and mandatory defense remain difficulty-independent.
 */
const PROFILES = {
    easy: {
        label: '简单',
        progressWeight: 1.18,
        attackWeight: 0.58,
        rootAttackWeight: 1,
        expansionWeight: 1.45,
        safetyWeight: 0.72,
        structureWeight: 0.62,
        branchingWeight: 0.65,
        searchWidth: 0,
        maxDepth: 0,
        searchBudgetMs: 0,
        maxNodes: 0,
        selection: 'varied'
    },
    medium: {
        label: '普通',
        progressWeight: 1,
        attackWeight: 1,
        rootAttackWeight: 1,
        expansionWeight: 1,
        safetyWeight: 1,
        structureWeight: 1,
        branchingWeight: 1,
        searchWidth: 0,
        maxDepth: 0,
        searchBudgetMs: 0,
        maxNodes: 0,
        selection: 'weighted'
    },
    hard: {
        label: '困难',
        progressWeight: 0.96,
        attackWeight: 1.28,
        rootAttackWeight: 1.18,
        expansionWeight: 0.92,
        safetyWeight: 1.3,
        structureWeight: 1.18,
        branchingWeight: 1.15,
        searchWidth: 7,
        maxDepth: 7,
        searchBudgetMs: 700,
        maxNodes: 30000,
        selection: 'search'
    },
    expert: {
        label: '专家',
        progressWeight: 0.9,
        attackWeight: 1.38,
        rootAttackWeight: 1.3,
        expansionWeight: 0.82,
        safetyWeight: 1.55,
        structureWeight: 1.48,
        branchingWeight: 1.42,
        searchWidth: 10,
        maxDepth: 8,
        searchBudgetMs: 1200,
        maxNodes: 60000,
        selection: 'search'
    }
};

export function getDifficultyProfile(difficulty) {
    const profile = PROFILES[difficulty];
    if (!profile) throw new TypeError('AI 难度无效');
    return profile;
}

export function getDifficultyLabel(difficulty) {
    return PROFILES[difficulty]?.label || difficulty;
}

export const DIFFICULTY_LEVELS = Object.freeze(Object.keys(PROFILES));
