import test from 'node:test';
import assert from 'node:assert/strict';
import { DisadvantageRiskAnalyzer } from './DisadvantageRiskAnalyzer.js';

const profile = {
    disadvantageRiskThreshold: 250,
    disadvantageRiskScale: 1500,
    disadvantageProgressWeight: 80,
    disadvantageRootAttackWeight: 1200,
    disadvantageCascadeWeight: 55,
    disadvantageNetGainWeight: 45,
    disadvantageSelfLossPenalty: 90,
    disadvantageOwnRootLossPenalty: 2400,
    disadvantageRiskBonusCap: 1800,
    disadvantageRiskPenaltyCap: 900
};

test('comeback risk factor is zero when even or ahead and bounded when behind', () => {
    const analyzer = new DisadvantageRiskAnalyzer();
    assert.equal(analyzer.getRiskFactor(0, profile), 0);
    assert.equal(analyzer.getRiskFactor(500, profile), 0);
    assert.equal(analyzer.getRiskFactor(-250, profile), 0);
    assert.equal(analyzer.getRiskFactor(-1000, profile), 0.5);
    assert.equal(analyzer.getRiskFactor(-5000, profile), 1);
});

test('disadvantage rewards concrete high-leverage attacks, not risk by itself', () => {
    const analyzer = new DisadvantageRiskAnalyzer();
    const factor = 0.75;
    assert.equal(analyzer.evaluateMove({ riskFactor: factor, progress: 0 }, profile), 0);
    const rootAttack = analyzer.evaluateMove({
        riskFactor: factor,
        progress: 1,
        exchange: { enemyRootLoss: 1, cascadeLoss: 0, netNodeGain: -1, ownNodeLoss: 2, ownRootLoss: 0 }
    }, profile);
    assert.ok(rootAttack > 0,
        'a costly local sacrifice may be justified when it damages an enemy root');
});

test('comeback risk never makes own-root destruction attractive', () => {
    const analyzer = new DisadvantageRiskAnalyzer();
    const score = analyzer.evaluateMove({
        riskFactor: 1,
        progress: 3,
        exchange: { enemyRootLoss: 1, cascadeLoss: 4, netNodeGain: 2, ownNodeLoss: 0, ownRootLoss: 1 }
    }, profile);
    assert.equal(score, -650, 'the bounded penalty must dominate non-terminal own-root loss');
});
