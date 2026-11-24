import test from 'node:test';
import assert from 'node:assert/strict';
import { StrategicDecisionCoordinator } from './StrategicDecisionCoordinator.js';

function callbacks(overrides = {}) {
    return {
        rankedMoves: [{ id: 'a' }, { id: 'b' }],
        maxNodes: 6000,
        findImmediateWin: () => null,
        analyzeMandatoryDefense: moves => ({ moves, hasImmediateThreat: false }),
        findForcedWin: () => ({ moves: [], nodes: 10, complete: true }),
        findForcedMaterialGain: () => ({ moves: [], nodes: 10, complete: true }),
        findExtendedTactic: () => ({ moves: [], nodes: 10, complete: true }),
        search: moves => moves[0],
        ...overrides
    };
}

test('immediate victory is absolute priority and skips every lower layer', () => {
    const coordinator = new StrategicDecisionCoordinator();
    let lowerLayers = 0;
    const winningMove = { id: 'win' };
    const result = coordinator.resolve(callbacks({
        findImmediateWin: () => winningMove,
        analyzeMandatoryDefense: () => { lowerLayers++; throw new Error('must not run'); },
        findForcedWin: () => { lowerLayers++; throw new Error('must not run'); },
        search: () => { lowerLayers++; throw new Error('must not run'); }
    }));
    assert.equal(result.move, winningMove);
    assert.equal(result.reason, 'immediate-win');
    assert.equal(lowerLayers, 0);
});

test('mandatory defense narrows candidates before tactical proofs without overriding a proven win', () => {
    const coordinator = new StrategicDecisionCoordinator();
    const safe = { id: 'safe' };
    const defensive = { id: 'defense' };
    let searched = false;
    const result = coordinator.resolve(callbacks({
        analyzeMandatoryDefense: () => ({
            moves: [defensive],
            hasImmediateThreat: true
        }),
        findForcedWin: moves => {
            assert.deepEqual(moves, [defensive]);
            return { moves: [safe], nodes: 5, complete: true };
        },
        search: () => { searched = true; }
    }));
    assert.equal(result.move, safe);
    assert.equal(result.reason, 'forced-sequence-win');
    assert.equal(searched, false);
});

test('without an immediate threat all legal candidates reach tactical analysis and search', () => {
    const coordinator = new StrategicDecisionCoordinator();
    const legal = [{ id: 'a' }, { id: 'b' }];
    let searchedMoves;
    const result = coordinator.resolve(callbacks({
        rankedMoves: legal,
        analyzeMandatoryDefense: () => ({ moves: [legal[0]], hasImmediateThreat: false }),
        search: moves => { searchedMoves = moves; return moves[1]; }
    }));
    assert.deepEqual(searchedMoves, legal);
    assert.equal(result.move, legal[1]);
    assert.equal(result.reason, 'search-selection');
});

test('tactical analyzers share one bounded node allowance in strict priority order', () => {
    const coordinator = new StrategicDecisionCoordinator();
    const budgets = [];
    const result = coordinator.resolve(callbacks({
        maxNodes: 9000,
        findForcedWin: (_moves, budget) => {
            budgets.push(budget.maxNodes);
            return { moves: [], nodes: 600, complete: true };
        },
        findForcedMaterialGain: (_moves, budget) => {
            budgets.push(budget.maxNodes);
            return { moves: [], nodes: 600, complete: true };
        },
        findExtendedTactic: (_moves, budget) => {
            budgets.push(budget.maxNodes);
            return { moves: [], nodes: 0, complete: false };
        }
    }));
    assert.deepEqual(budgets, [4000, 4000, 7800]);
    assert.equal(result.tacticalStats.nodes, 1200);
    assert.equal(result.tacticalStats.complete, false);
});


test('incomplete mandatory-defense scan keeps the full candidate set', () => {
    const coordinator = new StrategicDecisionCoordinator();
    const legal = [{ id: 'a' }, { id: 'b' }];
    let tacticalCandidates;
    const result = coordinator.resolve(callbacks({
        rankedMoves: legal,
        analyzeMandatoryDefense: moves => ({
            moves: [moves[0]],
            hasImmediateThreat: true,
            nodes: 4,
            complete: false
        }),
        findForcedWin: moves => {
            tacticalCandidates = moves;
            return { moves: [], nodes: 0, complete: false };
        },
        findForcedMaterialGain: () => ({ moves: [], nodes: 0, complete: false }),
        findExtendedTactic: () => ({ moves: [], nodes: 0, complete: false }),
        search: moves => moves[1]
    }));
    assert.deepEqual(tacticalCandidates, legal);
    assert.equal(result.move, legal[1]);
    assert.equal(result.tacticalStats.defenseComplete, false);
    assert.equal(result.tacticalStats.complete, false);
});
