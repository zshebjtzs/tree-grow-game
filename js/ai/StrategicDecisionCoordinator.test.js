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

test('without an immediate threat structural risk reorders but does not drop legal candidates', () => {
    const coordinator = new StrategicDecisionCoordinator();
    const legal = [{ id: 'a' }, { id: 'b' }];
    const riskOrdered = [legal[1], legal[0]];
    let searchedMoves;
    const result = coordinator.resolve(callbacks({
        rankedMoves: legal,
        analyzeMandatoryDefense: () => ({
            moves: riskOrdered,
            hasImmediateThreat: false,
            complete: true
        }),
        search: moves => { searchedMoves = moves; return moves[1]; }
    }));
    assert.deepEqual(searchedMoves, riskOrdered);
    assert.equal(searchedMoves.length, legal.length);
    assert.equal(result.move, legal[0]);
    assert.equal(result.reason, 'defense-risk-order');
});

test('tactical analyzers share one bounded node allowance in strict priority order', () => {
    const coordinator = new StrategicDecisionCoordinator();
    const budgets = [];
    let searchBudget = null;
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
        },
        search: (moves, budget) => { searchBudget = budget.maxNodes; return moves[0]; }
    }));
    assert.deepEqual(budgets, [4000, 4000, 4200]);
    assert.equal(result.tacticalStats.nodes, 1200);
    assert.equal(result.tacticalStats.complete, false);
    assert.equal(searchBudget, 7800);
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


test('coordinator keeps tactical check counts separate from weighted work units', () => {
    const coordinator = new StrategicDecisionCoordinator();
    let searchBudget = null;
    const result = coordinator.resolve(callbacks({
        maxNodes: 1000,
        analyzeMandatoryDefense: moves => ({
            moves, hasImmediateThreat: false, nodes: 2, workUnits: 10, complete: true
        }),
        findForcedWin: () => ({ moves: [], nodes: 3, workUnits: 20, complete: true }),
        findForcedMaterialGain: () => ({ moves: [], nodes: 4, workUnits: 30, complete: true }),
        findExtendedTactic: () => ({ moves: [], nodes: 1, workUnits: 5, complete: true }),
        search: (moves, budget) => { searchBudget = budget.maxNodes; return moves[0]; }
    }));

    assert.equal(searchBudget, 935);
    assert.equal(result.tacticalStats.nodes, 8);
    assert.equal(result.tacticalStats.workUnits, 55);
    assert.equal(result.tacticalStats.totalNodes, 10);
    assert.equal(result.tacticalStats.totalWorkUnits, 65);
    assert.equal(result.tacticalStats.mandatoryDefenseNodes, 2);
    assert.equal(result.tacticalStats.mandatoryDefenseWorkUnits, 10);
});

test('non-terminal tactical proofs become search hints instead of bypassing minimax', () => {
    const coordinator = new StrategicDecisionCoordinator();
    const ordinary = { id: 'ordinary' };
    const material = { id: 'material' };
    const extended = { id: 'extended' };
    const legal = [ordinary, material, extended];
    let searchedMoves;
    let searchedHints;
    let searchedBudget;

    const result = coordinator.resolve(callbacks({
        rankedMoves: legal,
        findForcedMaterialGain: () => ({
            moves: [material], nodes: 2, workUnits: 5, complete: true,
            guaranteedNetNodeGain: 3
        }),
        findExtendedTactic: () => ({
            moves: [extended, material], nodes: 3, workUnits: 7, complete: true,
            opponentAttackReplies: 1
        }),
        search: (moves, budget, hints) => {
            searchedMoves = moves;
            searchedBudget = budget.maxNodes;
            searchedHints = hints;
            return ordinary;
        }
    }));

    assert.deepEqual(searchedMoves, legal,
        'all legal candidates must remain in the unified search');
    assert.deepEqual(searchedHints, [material, extended],
        'proven non-terminal tactics should guide ordering without forcing the move');
    assert.equal(searchedBudget, 5978);
    assert.equal(result.move, ordinary,
        'the global search result, not the tactical hint, selects the action');
    assert.equal(result.reason, 'search-with-tactical-hints');
    assert.equal(result.tacticalStats.forcedMaterialGain, true);
    assert.equal(result.tacticalStats.forcedTacticalSequence, true);
    assert.equal(result.tacticalStats.counterattackSequence, true);
    assert.equal(result.tacticalStats.tacticalHintCount, 2);
});


test('tactical analysis preserves a minimum work budget for global search', () => {
    const coordinator = new StrategicDecisionCoordinator();
    let defenseBudget;
    let proofBudgets = [];
    let searchBudget;
    const result = coordinator.resolve(callbacks({
        maxNodes: 6000,
        analyzeMandatoryDefense: (moves, budget) => {
            defenseBudget = budget.maxNodes;
            return {
                moves, hasImmediateThreat: false,
                nodes: 3600, workUnits: 3600, complete: true
            };
        },
        findForcedWin: (_moves, budget) => {
            proofBudgets.push(budget.maxNodes);
            return { moves: [], nodes: 0, workUnits: 0, complete: true };
        },
        findForcedMaterialGain: (_moves, budget) => {
            proofBudgets.push(budget.maxNodes);
            return { moves: [], nodes: 0, workUnits: 0, complete: true };
        },
        findExtendedTactic: (_moves, budget) => {
            proofBudgets.push(budget.maxNodes);
            return { moves: [], nodes: 0, workUnits: 0, complete: true };
        },
        search: (moves, budget) => {
            searchBudget = budget.maxNodes;
            return moves[0];
        }
    }));

    assert.equal(defenseBudget, 3600);
    assert.deepEqual(proofBudgets, [0, 0, 0]);
    assert.equal(searchBudget, 2400);
    assert.equal(result.tacticalStats.totalWorkUnits, 3600);
});
