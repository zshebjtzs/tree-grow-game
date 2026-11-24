import test from 'node:test';
import assert from 'node:assert/strict';
import { TacticalAnalyzer } from './TacticalAnalyzer.js';

function position({ blueRoots = 1, redRoots = 1, vulnerable = false, isGameOver = false } = {}) {
    return {
        currentTurn: 'blue',
        isGameOver,
        getPlayerRootNodes(side) {
            if (side === 'blue') return Array.from({ length: blueRoots }, (_, id) => ({ id }));
            return Array.from({ length: redRoots }, (_, id) => ({ id }));
        },
        getAliveNodesByOwner(side) {
            return this.getPlayerRootNodes(side);
        },
        vulnerable
    };
}

test('defense ranking rejects a move that exposes a root to immediate destruction', () => {
    const analyzer = new TacticalAnalyzer();
    const game = position({ blueRoots: 2 });
    const safe = { parentNodeId: 1, targetAreaId: 4 };
    const risky = { parentNodeId: 2, targetAreaId: 5 };

    const generateMoves = (state, side) => {
        if (side === 'red' && state.vulnerable) {
            return [{ parentNodeId: 9, targetAreaId: 5, attacks: true }];
        }
        return [];
    };
    const simulateMove = (state, move, side) => {
        if (side === 'blue') {
            return position({ blueRoots: 2, vulnerable: move.targetAreaId === risky.targetAreaId });
        }
        if (side === 'red' && state.vulnerable && move.attacks) {
            return position({ blueRoots: 1 });
        }
        return state;
    };

    const selected = analyzer.rankDefenses(
        game, [safe, risky], 'blue', { red: 6, blue: 1 }, simulateMove, generateMoves
    );
    assert.deepEqual(selected, [safe]);
});

test('root-risk screening preserves all candidates when no immediate root loss exists', () => {
    const analyzer = new TacticalAnalyzer();
    const game = position();
    const moves = [
        { parentNodeId: 1, targetAreaId: 4 },
        { parentNodeId: 2, targetAreaId: 5 }
    ];
    const generateMoves = () => [];
    const simulateMove = state => state;

    assert.deepEqual(
        analyzer.rankDefenses(
            game, moves, 'blue', { red: 6, blue: 1 }, simulateMove, generateMoves
        ),
        moves
    );
});


test('defense ranking avoids multi-node cascade when root risk is equal', () => {
    const analyzer = new TacticalAnalyzer();
    const game = {
        ...position(),
        getAliveNodesByOwner(side) {
            return Array.from({ length: side === 'blue' ? 4 : 1 }, (_, id) => ({ id }));
        }
    };
    const safe = { parentNodeId: 1, targetAreaId: 4 };
    const exposed = { parentNodeId: 2, targetAreaId: 5 };
    const generateMoves = (state, side) => side === 'red' && state.cascade
        ? [{ parentNodeId: 9, targetAreaId: 5, attacks: true }]
        : [];
    const simulateMove = (state, move, side) => {
        if (side === 'blue') {
            const cascade = move.targetAreaId === exposed.targetAreaId;
            return {
                ...position({ vulnerable: cascade }),
                cascade,
                getAliveNodesByOwner(owner) {
                    return Array.from({ length: owner === 'blue' ? 4 : 1 }, (_, id) => ({ id }));
                }
            };
        }
        if (side === 'red' && state.cascade && move.attacks) {
            return {
                ...position(),
                getAliveNodesByOwner(owner) {
                    return Array.from({ length: owner === 'blue' ? 1 : 1 }, (_, id) => ({ id }));
                }
            };
        }
        return state;
    };

    assert.deepEqual(
        analyzer.rankDefenses(
            game, [safe, exposed], 'blue', { red: 6, blue: 1 }, simulateMove, generateMoves
        ),
        [safe]
    );
});


test('defense ranking rejects a move that creates an immediate enemy base invasion', () => {
    const analyzer = new TacticalAnalyzer();
    const game = position();
    const safe = { parentNodeId: 1, targetAreaId: 4 };
    const exposed = { parentNodeId: 2, targetAreaId: 5 };
    const generateMoves = (state, side) => side === 'red' && state.exposesBase
        ? [{ parentNodeId: 9, targetAreaId: 1, attacks: false }]
        : [];
    const simulateMove = (state, move, side) => side === 'blue'
        ? { ...position(), exposesBase: move.targetAreaId === exposed.targetAreaId }
        : state;

    assert.deepEqual(
        analyzer.rankDefenses(
            game, [safe, exposed], 'blue', { red: 6, blue: 1 }, simulateMove, generateMoves
        ),
        [safe]
    );
});


test('immediate-win scan simulates attacks only after checking direct base entries', () => {
    const analyzer = new TacticalAnalyzer();
    const game = position();
    const moves = [
        { parentNodeId: 1, targetAreaId: 6, attacks: false },
        { parentNodeId: 2, targetAreaId: 7, attacks: false },
        { parentNodeId: 3, targetAreaId: 8, attacks: true }
    ];
    const calls = [];
    const generateMoves = () => moves;
    const simulateMove = (_state, move) => {
        calls.push(move.targetAreaId);
        return {
            isGameOver: true,
            getPlayerRootNodes: side => side === 'blue' ? [] : [{}],
            getAliveNodesByOwner: () => []
        };
    };

    const count = analyzer.countImmediateWinningMoves(
        game, 'red', { red: 1, blue: 6 }, generateMoves, simulateMove
    );

    assert.equal(count, 2);
    assert.deepEqual(calls, [8]);
});


test('tactical reply generation and attack simulation are reused per candidate position', () => {
    const analyzer = new TacticalAnalyzer();
    const root = position();
    const candidates = [
        { parentNodeId: 1, targetAreaId: 4, _nextState: position() },
        { parentNodeId: 2, targetAreaId: 5, _nextState: position() }
    ];
    let generated = 0;
    let simulatedAttacks = 0;
    const generateMoves = (_state, side) => {
        generated++;
        return side === 'red' && _state !== root
            ? [{ targetAreaId: 8, attacks: true }]
            : [];
    };
    const simulateMove = (state, move, side) => {
        if (side === 'red') simulatedAttacks++;
        return state;
    };

    analyzer.rankDefenses(
        root, candidates, 'blue', { red: 6, blue: 1 }, simulateMove, generateMoves
    );

    assert.equal(generated, 3,
        'generate opponent replies once for the current position and once per candidate position');
    assert.equal(simulatedAttacks, 2,
        'each candidate position should simulate its attack reply only once');
});

test('cascade loss counts descendants correctly when the directly attacked target is a root', () => {
    const analyzer = new TacticalAnalyzer();
    const root = { id: 1, areaId: 2 };
    const child = { id: 2, areaId: 3 };
    const grandchild = { id: 3, areaId: 4 };
    const game = {
        isGameOver: false,
        getAliveNodesByOwner: side => side === 'blue' ? [root, child, grandchild] : [{ id: 9 }],
        getPlayerRootNodes: side => side === 'blue' ? [root] : [{ id: 9 }]
    };
    const next = {
        isGameOver: false,
        getAliveNodesByOwner: side => side === 'blue' ? [] : [{ id: 9 }],
        getPlayerRootNodes: side => side === 'blue' ? [] : [{ id: 9 }]
    };
    const risk = analyzer.measureAttackRisk(
        game, 'blue', 'red', { red: 6, blue: 1 },
        () => [{ targetAreaId: 2, attacks: true }],
        () => next
    );

    assert.equal(risk.maxRootLoss, 1);
    assert.equal(risk.maxNodeLoss, 3);
    assert.equal(risk.maxCascadeLoss, 2,
        'both non-root descendants are cascade losses; the attacked root is not subtracted twice');
});


test('tactical reply analysis sets and restores the attacker turn', () => {
    const analyzer = new TacticalAnalyzer();
    const game = position();
    game.currentTurn = 'blue';
    let observedTurn = null;

    analyzer.countImmediateWinningMoves(
        game,
        'red',
        { red: 1, blue: 6 },
        state => {
            observedTurn = state.currentTurn;
            return [];
        },
        () => null
    );

    assert.equal(observedTurn, 'red');
    assert.equal(game.currentTurn, 'blue',
        'tactical analysis must not leak its temporary turn change into the caller');
});


function tacticalState({ turn = 'blue', redRoots = 1, blueRoots = 1, isGameOver = false, tag = '' } = {}) {
    return {
        currentTurn: turn,
        isGameOver,
        tag,
        getPlayerRootNodes(side) {
            const count = side === 'red' ? redRoots : blueRoots;
            return Array.from({ length: count }, (_, id) => ({ id, owner: side }));
        }
    };
}

test('forcing-sequence analysis proves a win only when every opponent reply permits an immediate win', () => {
    const analyzer = new TacticalAnalyzer();
    const root = tacticalState({ turn: 'red', tag: 'root' });
    const afterCandidate = tacticalState({ turn: 'blue', tag: 'after-candidate' });
    const afterFirstReply = tacticalState({ turn: 'red', tag: 'reply-a' });
    const afterSecondReply = tacticalState({ turn: 'red', tag: 'reply-b' });
    const candidate = { parentNodeId: 1, targetAreaId: 4, _nextState: afterCandidate };
    const opponentReplies = [
        { parentNodeId: 20, targetAreaId: 10, nextState: afterFirstReply },
        { parentNodeId: 21, targetAreaId: 11, nextState: afterSecondReply }
    ];
    const visitedReplies = [];
    const result = analyzer.findForcedWinInTwoMoves(
        root,
        [candidate],
        'red',
        { red: 1, blue: 6 },
        (_state, move) => move.nextState,
        (state, side) => {
            if (side === 'blue') return opponentReplies;
            visitedReplies.push(state.tag);
            // The winning continuation may come from a different root:
            // this explicitly covers multi-root tactical cooperation.
            return [{ parentNodeId: state.tag === 'reply-a' ? 30 : 40, targetAreaId: 6 }];
        },
        state => state
    );

    assert.deepEqual(result.moves, [candidate]);
    assert.equal(result.complete, true);
    assert.ok(visitedReplies.includes('reply-a'));
    assert.ok(visitedReplies.includes('reply-b'));
});

test('forcing-sequence analysis rejects a candidate when one legal defense refutes the continuation', () => {
    const analyzer = new TacticalAnalyzer();
    const root = tacticalState({ turn: 'red' });
    const afterCandidate = tacticalState({ turn: 'blue', tag: 'after-candidate' });
    const winningReplyPosition = tacticalState({ turn: 'red', tag: 'winning-reply' });
    const refutedPosition = tacticalState({ turn: 'red', tag: 'refuted' });
    const candidate = { parentNodeId: 1, targetAreaId: 4, _nextState: afterCandidate };
    const replies = [
        { parentNodeId: 20, targetAreaId: 10, nextState: winningReplyPosition },
        { parentNodeId: 21, targetAreaId: 11, nextState: refutedPosition }
    ];

    const result = analyzer.findForcedWinInTwoMoves(
        root,
        [candidate],
        'red',
        { red: 1, blue: 6 },
        (_state, move) => move.nextState,
        (state, side) => side === 'blue'
            ? replies
            : state.tag === 'winning-reply'
                ? [{ parentNodeId: 30, targetAreaId: 6 }]
                : [],
        state => state
    );

    assert.deepEqual(result.moves, []);
    assert.equal(result.complete, true);
});

test('forcing-sequence analysis rejects an opponent reply that wins immediately', () => {
    const analyzer = new TacticalAnalyzer();
    const root = tacticalState({ turn: 'red' });
    const afterCandidate = tacticalState({ turn: 'blue' });
    const candidate = { parentNodeId: 1, targetAreaId: 4, _nextState: afterCandidate };

    const result = analyzer.findForcedWinInTwoMoves(
        root,
        [candidate],
        'red',
        { red: 1, blue: 6 },
        () => null,
        (_state, side) => side === 'blue'
            ? [{ parentNodeId: 20, targetAreaId: 1 }]
            : [{ parentNodeId: 30, targetAreaId: 6 }],
        state => state
    );

    assert.deepEqual(result.moves, []);
});

test('forcing-sequence analysis treats a no-move opponent turn as a pass', () => {
    const analyzer = new TacticalAnalyzer();
    const root = tacticalState({ turn: 'red' });
    const afterCandidate = tacticalState({ turn: 'blue', tag: 'after-candidate' });
    const afterPass = tacticalState({ turn: 'red', tag: 'after-pass' });
    const candidate = { parentNodeId: 1, targetAreaId: 4, _nextState: afterCandidate };
    let passCount = 0;

    const result = analyzer.findForcedWinInTwoMoves(
        root,
        [candidate],
        'red',
        { red: 1, blue: 6 },
        () => null,
        (state, side) => side === 'blue'
            ? []
            : [{ parentNodeId: 30, targetAreaId: 6 }],
        () => {
            passCount++;
            return afterPass;
        }
    );

    assert.deepEqual(result.moves, [candidate]);
    assert.equal(passCount, 1);
});

test('forcing-sequence analysis never reports a win when its node budget is exhausted', () => {
    const analyzer = new TacticalAnalyzer();
    const root = tacticalState({ turn: 'red' });
    const afterCandidate = tacticalState({ turn: 'blue' });
    const candidate = { parentNodeId: 1, targetAreaId: 4, _nextState: afterCandidate };

    const result = analyzer.findForcedWinInTwoMoves(
        root,
        [candidate],
        'red',
        { red: 1, blue: 6 },
        () => null,
        () => [{ parentNodeId: 20, targetAreaId: 10 }],
        state => state,
        { maxNodes: 1 }
    );

    assert.deepEqual(result.moves, []);
    assert.equal(result.complete, false);
    assert.equal(result.nodes, 1);
});

test('forcing-sequence analysis recognizes a terminal root-destruction win immediately', () => {
    const analyzer = new TacticalAnalyzer();
    const root = tacticalState({ turn: 'red' });
    const terminalWin = tacticalState({
        turn: 'blue', redRoots: 1, blueRoots: 0, isGameOver: true
    });
    const candidate = { parentNodeId: 1, targetAreaId: 5, _nextState: terminalWin };

    const result = analyzer.findForcedWinInTwoMoves(
        root, [candidate], 'red', { red: 1, blue: 6 },
        () => null, () => [], state => state
    );

    assert.deepEqual(result.moves, [candidate]);
});


test('immediate-win scan recognizes an attack that destroys the opponent final root', () => {
    const analyzer = new TacticalAnalyzer();
    const terminalWin = tacticalState({
        turn: 'blue', redRoots: 0, blueRoots: 1, isGameOver: true
    });
    const move = { parentNodeId: 7, targetAreaId: 5, _nextState: terminalWin };

    assert.equal(
        analyzer.findImmediateWinningMove([move], 'blue', { red: 1, blue: 6 }),
        move
    );
});


function materialState({ turn = 'red', tag = '', blueNodes = [], redNodes = [], isGameOver = false } = {}) {
    return {
        currentTurn: turn,
        tag,
        isGameOver,
        getAliveNodesByOwner(side) {
            return side === 'blue' ? blueNodes : redNodes;
        },
        getPlayerRootNodes(side) {
            return (side === 'blue' ? blueNodes : redNodes).filter(node => node.isRoot);
        }
    };
}

test('forced material-gain analysis rejects a candidate if one opponent reply removes the tactical continuation', () => {
    const analyzer = new TacticalAnalyzer();
    const root = materialState({
        turn: 'red',
        redNodes: [{ id: 20, areaId: 6, isRoot: true }],
        blueNodes: [
            { id: 1, areaId: 1, isRoot: true },
            { id: 2, areaId: 2, isRoot: false },
            { id: 3, areaId: 3, isRoot: false },
            { id: 4, areaId: 4, isRoot: false }
        ]
    });
    const afterCandidate = materialState({
        turn: 'blue',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const afterReplyA = materialState({
        turn: 'red',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: [
            { id: 1, areaId: 1, isRoot: true },
            { id: 2, areaId: 2, isRoot: false },
            { id: 3, areaId: 3, isRoot: false },
            { id: 4, areaId: 4, isRoot: false }
        ]
    });
    const afterReplyB = materialState({
        turn: 'red',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: [
            { id: 1, areaId: 1, isRoot: true },
            { id: 2, areaId: 2, isRoot: false },
            { id: 3, areaId: 3, isRoot: false },
            { id: 4, areaId: 4, isRoot: false }
        ]
    });
    const afterAttack = materialState({
        turn: 'blue',
        blueNodes: [{ id: 1, areaId: 1, isRoot: true }],
        redNodes: root.getAliveNodesByOwner('red')
    });
    const candidate = { parentNodeId: 20, targetAreaId: 5, _nextState: afterCandidate };
    const replies = [
        { targetAreaId: 7, nextState: afterReplyA },
        { targetAreaId: 8, nextState: afterReplyB }
    ];
    const result = analyzer.findForcedMaterialGainInTwoMoves(
        root, [candidate], 'red', { red: 6, blue: 1 },
        (_state, move) => move.nextState,
        (state, side) => side === 'blue'
            ? replies
            : [{ attacks: true, targetAreaId: 2, nextState: afterAttack }],
        state => state
    );

    assert.deepEqual(result.moves, [candidate]);
    assert.equal(result.complete, true);
    assert.equal(result.guaranteedRootLoss, 0);
    assert.equal(result.guaranteedCascadeLoss, 2);
    assert.equal(result.guaranteedNodeLoss, 3);
});

test('forced material-gain analysis requires a qualifying attack after every opponent reply', () => {
    const analyzer = new TacticalAnalyzer();
    const root = materialState({
        turn: 'red',
        redNodes: [{ id: 20, areaId: 6, isRoot: true }],
        blueNodes: [
            { id: 1, areaId: 1, isRoot: true },
            { id: 2, areaId: 2, isRoot: false },
            { id: 3, areaId: 3, isRoot: false },
            { id: 4, areaId: 4, isRoot: false }
        ]
    });
    const afterCandidate = materialState({
        turn: 'blue',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const safePosition = materialState({
        turn: 'red',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const unanswerablePosition = materialState({
        turn: 'red',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const afterAttack = materialState({
        turn: 'blue',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: [{ id: 1, areaId: 1, isRoot: true }]
    });
    const candidate = { parentNodeId: 20, targetAreaId: 5, _nextState: afterCandidate };
    const replies = [
        { targetAreaId: 7, nextState: safePosition },
        { targetAreaId: 8, nextState: unanswerablePosition }
    ];
    const attack = { attacks: true, targetAreaId: 2, nextState: afterAttack };
    const result = analyzer.findForcedMaterialGainInTwoMoves(
        root, [candidate], 'red', { red: 6, blue: 1 },
        (_state, move) => move.nextState,
        (state, side) => {
            if (side === 'blue') return replies;
            if (state === safePosition) return [attack];
            return [];
        },
        state => state
    );

    assert.deepEqual(result.moves, []);
    assert.equal(result.complete, true);
});

test('material proof does not count direct targets from earlier attacks as cascade losses', () => {
    const analyzer = new TacticalAnalyzer();
    const root = materialState({
        turn: 'red',
        redNodes: [{ id: 20, areaId: 6, isRoot: true }],
        blueNodes: [
            { id: 1, areaId: 1, isRoot: true },
            { id: 2, areaId: 2, isRoot: false },
            { id: 3, areaId: 3, isRoot: false },
            { id: 4, areaId: 4, isRoot: false }
        ]
    });
    const afterCandidate = materialState({
        turn: 'blue',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: [
            { id: 1, areaId: 1, isRoot: true },
            { id: 3, areaId: 3, isRoot: false },
            { id: 4, areaId: 4, isRoot: false }
        ]
    });
    const afterReply = materialState({
        turn: 'red',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: afterCandidate.getAliveNodesByOwner('blue')
    });
    const afterAttack = materialState({
        turn: 'blue',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: [{ id: 1, areaId: 1, isRoot: true }]
    });
    const candidate = { attacks: true, targetAreaId: 2, _nextState: afterCandidate };
    const reply = { targetAreaId: 7, nextState: afterReply };
    const attack = { attacks: true, targetAreaId: 3, nextState: afterAttack };
    const moveMap = new Map([[afterCandidate, [reply]], [afterReply, [attack]]]);

    const result = analyzer.findForcedMaterialGainInTwoMoves(
        root, [candidate], 'red', { red: 6, blue: 1 },
        (_state, move) => move.nextState,
        state => moveMap.get(state) || [],
        state => state
    );

    // Two direct kills and one cascade kill do not satisfy the two-cascade rule.
    assert.deepEqual(result.moves, []);
});

test('forced material-gain analysis never promotes an unexamined reply after budget exhaustion', () => {
    const analyzer = new TacticalAnalyzer();
    const root = materialState({
        turn: 'red',
        redNodes: [{ id: 20, areaId: 6, isRoot: true }],
        blueNodes: [{ id: 1, areaId: 1, isRoot: true }]
    });
    const afterCandidate = materialState({
        turn: 'blue',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const candidate = { parentNodeId: 20, targetAreaId: 5, _nextState: afterCandidate };

    const result = analyzer.findForcedMaterialGainInTwoMoves(
        root, [candidate], 'red', { red: 6, blue: 1 },
        () => null,
        () => [{ targetAreaId: 7 }],
        state => state,
        { maxNodes: 1 }
    );

    assert.deepEqual(result.moves, []);
    assert.equal(result.complete, false);
    assert.equal(result.nodes, 1);
});


test('forced material-gain ranking reports the weakest actual opponent reply, not independent metric minima', () => {
    const analyzer = new TacticalAnalyzer();
    const root = materialState({
        turn: 'red',
        redNodes: [{ id: 20, areaId: 6, isRoot: true }],
        blueNodes: [
            { id: 1, areaId: 1, isRoot: true },
            { id: 2, areaId: 2, isRoot: false },
            { id: 3, areaId: 3, isRoot: false },
            { id: 4, areaId: 4, isRoot: false }
        ]
    });
    const afterCandidate = materialState({
        turn: 'blue',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const afterRootReply = materialState({
        turn: 'red', tag: 'root-reply',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: [{ id: 1, areaId: 1, isRoot: true }]
    });
    const afterCascadeReply = materialState({
        turn: 'red', tag: 'cascade-reply',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: [
            { id: 1, areaId: 1, isRoot: true },
            { id: 2, areaId: 2, isRoot: false },
            { id: 3, areaId: 3, isRoot: false },
            { id: 4, areaId: 4, isRoot: false }
        ]
    });
    const rootDestroyed = materialState({
        turn: 'blue',
        blueNodes: [],
        redNodes: root.getAliveNodesByOwner('red')
    });
    const cascadeDestroyed = materialState({
        turn: 'blue',
        blueNodes: [{ id: 1, areaId: 1, isRoot: true }],
        redNodes: root.getAliveNodesByOwner('red')
    });
    const candidate = { targetAreaId: 5, _nextState: afterCandidate };

    const result = analyzer.findForcedMaterialGainInTwoMoves(
        root, [candidate], 'red', { red: 6, blue: 1 },
        (_state, move) => move.nextState,
        (state, side) => side === 'blue'
            ? [
                { targetAreaId: 7, nextState: afterRootReply },
                { targetAreaId: 8, nextState: afterCascadeReply }
            ]
            : [{
                attacks: true,
                targetAreaId: state.tag === 'root-reply' ? 1 : 2,
                nextState: state.tag === 'root-reply' ? rootDestroyed : cascadeDestroyed
            }],
        state => state
    );

    assert.deepEqual(result.moves, [candidate]);
    assert.equal(result.guaranteedRootLoss, 0);
    assert.equal(result.guaranteedCascadeLoss, 2);
    assert.equal(result.guaranteedNodeLoss, 3);
});


test('three-action tactical proof validates counterattack after two attacking replies and nets a sacrifice', () => {
    const analyzer = new TacticalAnalyzer();
    const root = materialState({
        turn: 'red',
        redNodes: [
            { id: 20, areaId: 20, isRoot: true },
            { id: 21, areaId: 21, isRoot: false }
        ],
        blueNodes: [
            { id: 1, areaId: 1, isRoot: true },
            { id: 2, areaId: 2, isRoot: false },
            { id: 3, areaId: 3, isRoot: false },
            { id: 4, areaId: 4, isRoot: false },
            { id: 5, areaId: 5, isRoot: false },
            { id: 6, areaId: 6, isRoot: false }
        ]
    });
    const afterCandidate = materialState({
        turn: 'blue',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const afterFirstAttack = materialState({
        turn: 'red',
        redNodes: [{ id: 20, areaId: 20, isRoot: true }],
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const afterSetup = materialState({
        turn: 'blue',
        redNodes: [
            { id: 20, areaId: 20, isRoot: true },
            { id: 22, areaId: 22, isRoot: false }
        ],
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const afterSecondAttack = materialState({
        turn: 'red',
        redNodes: [{ id: 20, areaId: 20, isRoot: true }],
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const afterCounterattack = materialState({
        turn: 'blue',
        redNodes: [{ id: 20, areaId: 20, isRoot: true }],
        blueNodes: [
            { id: 1, areaId: 1, isRoot: true },
            { id: 6, areaId: 6, isRoot: false }
        ]
    });

    const candidate = { targetAreaId: 30, nextState: afterCandidate };
    const firstReply = { attacks: true, targetAreaId: 21, nextState: afterFirstAttack };
    const setup = { targetAreaId: 31, nextState: afterSetup };
    const secondReply = { attacks: true, targetAreaId: 22, nextState: afterSecondAttack };
    const finalAttack = { attacks: true, targetAreaId: 2, nextState: afterCounterattack };
    const immediateThreat = { targetAreaId: 1 };

    const result = analyzer.findForcedTacticalSequenceInThreeMoves(
        root, [candidate], 'red', { red: 20, blue: 1 },
        (_state, move) => move.nextState,
        (state, side) => {
            if (state === afterCandidate && side === 'red') return [immediateThreat];
            if (state === afterCandidate) return [firstReply];
            if (state === afterFirstAttack) return [setup];
            if (state === afterSetup) return [secondReply];
            if (state === afterSecondAttack) return [finalAttack];
            return [];
        },
        state => state
    );

    assert.deepEqual(result.moves, [candidate]);
    assert.deepEqual(result.sequence, [candidate, setup, finalAttack]);
    assert.equal(result.complete, true);
    assert.equal(result.guaranteedRootLoss, 0);
    assert.equal(result.guaranteedCascadeLoss, 3);
    assert.equal(result.guaranteedNodeGain, 2);
    assert.equal(result.guaranteedSelfLoss, 2);
    assert.equal(result.opponentAttackReplies, 2);
    assert.equal(result.inducedDefensiveReplies, 1);
    assert.equal(result.inducementValidated, true);
    assert.equal(result.sacrificeValidated, true);
});

test('three-action tactical proof rejects a sacrifice whose worst-case net gain is negative', () => {
    const analyzer = new TacticalAnalyzer();
    const root = materialState({
        turn: 'red',
        redNodes: [
            { id: 20, areaId: 20, isRoot: true },
            { id: 21, areaId: 21, isRoot: false },
            { id: 22, areaId: 22, isRoot: false }
        ],
        blueNodes: [
            { id: 1, areaId: 1, isRoot: true },
            { id: 2, areaId: 2, isRoot: false },
            { id: 3, areaId: 3, isRoot: false },
            { id: 4, areaId: 4, isRoot: false }
        ]
    });
    const afterCandidate = materialState({
        turn: 'blue',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const afterFirstAttack = materialState({
        turn: 'red',
        redNodes: [{ id: 20, areaId: 20, isRoot: true }, { id: 22, areaId: 22, isRoot: false }],
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const afterSetup = materialState({
        turn: 'blue',
        redNodes: [
            { id: 20, areaId: 20, isRoot: true },
            { id: 22, areaId: 22, isRoot: false }
        ],
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const afterSecondAttack = materialState({
        turn: 'red',
        redNodes: [{ id: 20, areaId: 20, isRoot: true }],
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const afterCounterattack = materialState({
        turn: 'blue',
        redNodes: [{ id: 20, areaId: 20, isRoot: true }],
        blueNodes: [{ id: 1, areaId: 1, isRoot: true }]
    });
    const candidate = { targetAreaId: 30, nextState: afterCandidate };
    const setup = { targetAreaId: 31, nextState: afterSetup };
    const finalAttack = { attacks: true, targetAreaId: 2, nextState: afterCounterattack };

    const result = analyzer.findForcedTacticalSequenceInThreeMoves(
        root, [candidate], 'red', { red: 20, blue: 1 },
        (_state, move) => move.nextState,
        state => {
            if (state === afterCandidate) return [
                { attacks: true, targetAreaId: 21, nextState: afterFirstAttack }
            ];
            if (state === afterFirstAttack) return [setup];
            if (state === afterSetup) return [
                { attacks: true, targetAreaId: 22, nextState: afterSecondAttack }
            ];
            if (state === afterSecondAttack) return [finalAttack];
            return [];
        },
        state => state
    );

    assert.deepEqual(result.moves, []);
    assert.equal(result.complete, true);
});


test('three-action tactical proof rejects a single defensive reply that breaks the final attack', () => {
    const analyzer = new TacticalAnalyzer();
    const root = materialState({
        turn: 'red',
        redNodes: [{ id: 20, areaId: 20, isRoot: true }],
        blueNodes: [{ id: 1, areaId: 1, isRoot: true }]
    });
    const afterCandidate = materialState({
        turn: 'blue',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const afterFirstReply = materialState({
        turn: 'red',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const afterSetup = materialState({
        turn: 'blue',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const safeReply = materialState({
        turn: 'red',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const refutingReply = materialState({
        turn: 'red',
        redNodes: root.getAliveNodesByOwner('red'),
        blueNodes: root.getAliveNodesByOwner('blue')
    });
    const afterWinningAttack = materialState({
        turn: 'blue',
        redNodes: [{ id: 20, areaId: 20, isRoot: true }],
        blueNodes: []
    });
    const candidate = { targetAreaId: 30, nextState: afterCandidate };
    const setup = { targetAreaId: 31, nextState: afterSetup };
    const finalAttack = { attacks: true, targetAreaId: 1, nextState: afterWinningAttack };

    const result = analyzer.findForcedTacticalSequenceInThreeMoves(
        root, [candidate], 'red', { red: 20, blue: 1 },
        (_state, move) => move.nextState,
        (state, side) => {
            if (state === afterCandidate && side === 'blue') return [{ targetAreaId: 32, nextState: afterFirstReply }];
            if (state === afterFirstReply) return [setup];
            if (state === afterSetup) return [
                { targetAreaId: 33, nextState: safeReply },
                { targetAreaId: 34, nextState: refutingReply }
            ];
            if (state === safeReply) return [finalAttack];
            return [];
        },
        state => state
    );

    assert.deepEqual(result.moves, []);
    assert.equal(result.complete, true);
});

test('three-action tactical proof never accepts an incomplete node-budget search', () => {
    const analyzer = new TacticalAnalyzer();
    const root = materialState({
        turn: 'red',
        redNodes: [{ id: 20, areaId: 20, isRoot: true }]
    });
    const candidate = {
        targetAreaId: 30,
        _nextState: materialState({
            turn: 'blue',
            redNodes: [{ id: 20, areaId: 20, isRoot: true }]
        })
    };

    const result = analyzer.findForcedTacticalSequenceInThreeMoves(
        root, [candidate], 'red', { red: 20, blue: 1 },
        () => null,
        () => [],
        state => state,
        { maxNodes: 1 }
    );

    assert.deepEqual(result.moves, []);
    assert.equal(result.complete, false);
    assert.equal(result.nodes, 1);
});


test('mandatory defense filtering preserves every candidate when no immediate win exists', () => {
    const analyzer = new TacticalAnalyzer();
    const game = position({ blueRoots: 2 });
    const safe = { parentNodeId: 1, targetAreaId: 4 };
    const risky = { parentNodeId: 2, targetAreaId: 5 };
    const generateMoves = (state, side) => side === 'red' && state.vulnerable
        ? [{ parentNodeId: 9, targetAreaId: 5, attacks: true }]
        : [];
    const simulateMove = (state, move, side) => {
        if (side === 'blue') {
            return position({ blueRoots: 2, vulnerable: move.targetAreaId === risky.targetAreaId });
        }
        if (side === 'red' && state.vulnerable && move.attacks) {
            return position({ blueRoots: 1 });
        }
        return state;
    };

    const result = analyzer.findMandatoryDefenses(
        game, [safe, risky], 'blue', { red: 6, blue: 1 }, simulateMove, generateMoves
    );

    assert.equal(result.hasImmediateThreat, false);
    assert.equal(result.immediateWinningMoves, 0);
    assert.deepEqual(result.moves, [safe, risky]);
});
