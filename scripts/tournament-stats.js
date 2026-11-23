// scripts/tournament-stats.js
const T_95 = [
    null, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262,
    2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093,
    2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045,
    2.042
];

function studentTCritical95(degreesOfFreedom) {
    if (degreesOfFreedom < 1) return Infinity;
    if (degreesOfFreedom < T_95.length) return T_95[degreesOfFreedom];

    // Cornish-Fisher expansion around the 97.5th percentile of N(0, 1).
    // This avoids the premature 1.96 normal approximation for finite samples.
    const z = 1.959963984540054;
    const v = degreesOfFreedom;
    const z2 = z * z;
    const z3 = z2 * z;
    const z5 = z3 * z2;
    const z7 = z5 * z2;
    return z
        + (z3 + z) / (4 * v)
        + (5 * z5 + 16 * z3 + 3 * z) / (96 * v * v)
        + (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * v * v * v);
}

export function validatePairGames(value) {
    if (!Number.isInteger(value) || value < 2 || value % 2 !== 0) {
        throw new TypeError('--pair-games must be an even integer greater than or equal to 2');
    }
    return value;
}

export function scoreInterval(scores) {
    if (!scores.length) {
        return { mean: 0, lower95: null, upper95: null, samples: 0, method: 'paired-t' };
    }

    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    if (scores.length === 1) {
        return {
            mean: Number(mean.toFixed(3)),
            lower95: null,
            upper95: null,
            samples: 1,
            method: 'insufficient-samples'
        };
    }

    const variance = scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) /
        (scores.length - 1);
    if (variance === 0) {
        return {
            mean: Number(mean.toFixed(3)),
            lower95: null,
            upper95: null,
            samples: scores.length,
            method: 'zero-variance'
        };
    }
    const standardError = Math.sqrt(variance / scores.length);
    const criticalValue = studentTCritical95(scores.length - 1);
    const margin = criticalValue * standardError;

    return {
        mean: Number(mean.toFixed(3)),
        lower95: Number(Math.max(0, mean - margin).toFixed(3)),
        upper95: Number(Math.min(1, mean + margin).toFixed(3)),
        samples: scores.length,
        method: 'paired-t'
    };
}

function scoreForDifficulty(match, difficulty) {
    if (!match.winner) return 0.5;
    const winnerDifficulty = match[match.winner === 'red' ? 'redDifficulty' : 'blueDifficulty'];
    return winnerDifficulty === difficulty ? 1 : 0;
}

/**
 * Treats each same-map, same-random-seed, color-swapped pair as one sample.
 * Confidence intervals are calculated across paired samples, not individual games.
 */
export function calculatePairedScoreRate(matches, firstDifficulty) {
    const groups = new Map();
    for (const match of matches) {
        if (typeof match.pairId !== 'string' || !match.pairId) {
            throw new TypeError('Every tournament match must include a pairId');
        }
        const group = groups.get(match.pairId) || [];
        group.push(match);
        groups.set(match.pairId, group);
    }

    const pairedScores = [];
    for (const [pairId, pair] of groups) {
        if (pair.length !== 2) {
            throw new Error(`Tournament pair ${pairId} must contain exactly two color-swapped games`);
        }
        const [first, second] = pair;
        if (first.seed !== second.seed || first.randomSeed !== second.randomSeed) {
            throw new Error(`Tournament pair ${pairId} must use the same map and random seeds`);
        }
        if (first.redDifficulty !== second.blueDifficulty ||
            first.blueDifficulty !== second.redDifficulty) {
            throw new Error(`Tournament pair ${pairId} must swap red and blue difficulty assignments`);
        }
        pairedScores.push((
            scoreForDifficulty(first, firstDifficulty) +
            scoreForDifficulty(second, firstDifficulty)
        ) / 2);
    }

    return {
        pairedSamples: pairedScores.length,
        firstScoreRate: scoreInterval(pairedScores)
    };
}
