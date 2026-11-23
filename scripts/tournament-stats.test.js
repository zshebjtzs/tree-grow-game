import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePairedScoreRate, scoreInterval, studentTCritical95, validatePairGames } from './tournament-stats.js';

function swappedPair(pairId, seed, randomSeed, firstWinner, secondWinner) {
    return [
        {
            pairId, seed, randomSeed,
            redDifficulty: 'hard', blueDifficulty: 'expert',
            winner: firstWinner
        },
        {
            pairId, seed, randomSeed,
            redDifficulty: 'expert', blueDifficulty: 'hard',
            winner: secondWinner
        }
    ];
}

test('paired score combines color-swapped games into one independent sample', () => {
    const result = calculatePairedScoreRate(
        swappedPair('map-a:0', 10, 100, 'red', 'red'),
        'hard'
    );

    assert.equal(result.pairedSamples, 1);
    assert.equal(result.firstScoreRate.mean, 0.5);
    assert.equal(result.firstScoreRate.lower95, null);
    assert.equal(result.firstScoreRate.upper95, null);
    assert.equal(result.firstScoreRate.samples, 1);
});

test('paired confidence interval counts map pairs rather than individual games', () => {
    const matches = [
        ...swappedPair('map-a:0', 10, 100, 'red', 'red'),
        ...swappedPair('map-b:0', 20, 200, 'red', 'blue')
    ];
    const result = calculatePairedScoreRate(matches, 'hard');

    assert.equal(result.pairedSamples, 2);
    assert.equal(result.firstScoreRate.samples, 2);
    assert.equal(result.firstScoreRate.mean, 0.75);
    assert.equal(result.firstScoreRate.method, 'paired-t');
});

test('paired statistics reject incomplete or non-swapped pairs', () => {
    assert.throws(
        () => calculatePairedScoreRate(swappedPair('map-a:0', 10, 100, 'red', 'red').slice(0, 1), 'hard'),
        /exactly two/
    );
    const invalid = swappedPair('map-a:0', 10, 100, 'red', 'red');
    invalid[1].blueDifficulty = 'medium';
    assert.throws(() => calculatePairedScoreRate(invalid, 'hard'), /swap/);
});

test('paired statistics reject pairs with different map or random seeds', () => {
    const invalid = swappedPair('map-a:0', 10, 100, 'red', 'red');
    invalid[1].seed = 11;
    assert.throws(() => calculatePairedScoreRate(invalid, 'hard'), /same map and random seeds/);
});

test('pair game count must guarantee a complete color swap', () => {
    assert.equal(validatePairGames(2), 2);
    assert.equal(validatePairGames(4), 4);
    assert.throws(() => validatePairGames(1), /even integer/);
    assert.throws(() => validatePairGames(3), /even integer/);
});

test('zero-variance paired samples do not produce a misleading point confidence interval', () => {
    const result = scoreInterval([0.5, 0.5, 0.5, 0.5, 0.5]);

    assert.equal(result.mean, 0.5);
    assert.equal(result.lower95, null);
    assert.equal(result.upper95, null);
    assert.equal(result.samples, 5);
    assert.equal(result.method, 'zero-variance');
});


test('paired t interval uses finite-sample critical values beyond 30 degrees of freedom', () => {
    assert.ok(Math.abs(studentTCritical95(40) - 2.021075) < 0.0001);
    assert.ok(studentTCritical95(40) > 1.96);
    assert.equal(studentTCritical95(30), 2.042);
});
