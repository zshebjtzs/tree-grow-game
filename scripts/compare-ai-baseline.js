import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const baseSha = process.env.AI_BASE_SHA;

if (!/^[0-9a-f]{40}$/i.test(baseSha || '')) {
    throw new Error('AI_BASE_SHA must contain the exact 40-character PR base commit SHA');
}

function git(args, cwd = repoRoot) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function createFixtures(GameState) {
    const areaCount = 50;
    const edges = Array.from({ length: areaCount + 1 }, () => new Set());
    const connect = (left, right) => {
        edges[left].add(right);
        edges[right].add(left);
    };

    for (let area = 1; area <= areaCount; area++) {
        connect(area, area === areaCount ? 1 : area + 1);
        connect(area, ((area + 12) % areaCount) + 1);
    }

    const adjacency = Object.fromEntries(
        Array.from({ length: areaCount }, (_, index) => [index + 1, [...edges[index + 1]]])
    );
    const areaCenters = Array.from({ length: areaCount }, (_, index) => [index * 10, 0]);

    const build = (name, setup, redBaseId, blueBaseId) => {
        const game = new GameState();
        setup(game);
        game.currentTurn = 'blue';
        return {
            name,
            snapshot: { ...game.toJSON(), redBaseId, blueBaseId },
            adjacency,
            areaCenters
        };
    };

    return [
        build('sparse', game => {
            game.currentTurn = 'red';
            game.addNode(null, 0, 0, 1, 'red');
            const redBranch = game.addNode(1, 10, 0, 2, 'red');
            game.addNode(redBranch.id, 20, 0, 3, 'red');

            game.currentTurn = 'blue';
            game.addNode(null, 250, 0, 26, 'blue');
            const blueBranch = game.addNode(4, 260, 0, 27, 'blue');
            game.addNode(blueBranch.id, 270, 0, 28, 'blue');
            game.addNode(blueBranch.id, 270, 10, 37, 'blue');
        }, 1, 26),
        build('branching', game => {
            game.currentTurn = 'red';
            const redRoot = game.addNode(null, 0, 0, 1, 'red');
            const redBranch = game.addNode(redRoot.id, 10, 0, 2, 'red');
            game.addNode(redBranch.id, 20, 0, 3, 'red');
            game.addNode(redBranch.id, 150, 0, 15, 'red');

            game.currentTurn = 'blue';
            const blueRoot = game.addNode(null, 250, 0, 26, 'blue');
            const blueBranch = game.addNode(blueRoot.id, 260, 0, 27, 'blue');
            game.addNode(blueBranch.id, 270, 0, 28, 'blue');
            game.addNode(blueBranch.id, 400, 0, 40, 'blue');
        }, 1, 26),
        build('combat', game => {
            game.currentTurn = 'red';
            const redRoot = game.addNode(null, 0, 0, 1, 'red');
            const redBranch = game.addNode(redRoot.id, 130, 0, 14, 'red');
            game.addNode(redBranch.id, 140, 0, 15, 'red');

            game.currentTurn = 'blue';
            const blueRoot = game.addNode(null, 250, 0, 26, 'blue');
            const blueBranch = game.addNode(blueRoot.id, 260, 0, 27, 'blue');
            game.addNode(blueBranch.id, 270, 0, 28, 'blue');
        }, 1, 26)
    ];
}

function moveKey(move) {
    return move ? `${move.parentNodeId}:${move.targetAreaId}` : null;
}

async function loadVersion(root) {
    const load = path => import(pathToFileURL(join(root, path)).href);
    const [{ GameState }, { AIController }] = await Promise.all([
        load('js/game/GameState.js'),
        load('js/ai/AIController.js')
    ]);
    return { GameState, AIController };
}

function getLegacyStaticRanking(AIController, fixture, difficulty) {
    const ai = new AIController(difficulty, fixture.adjacency, fixture.areaCenters);
    const state = ai.adapter.createState(fixture.snapshot);
    ai.adapter.setSideToMove(state, 'blue');
    const bases = ai.adapter.getBases(fixture.snapshot);
    const moves = ai._generateMoves(state, 'blue', bases);

    return moves.map((move, index) => {
        const next = ai._simulateMove(state, move, 'blue', bases, { alreadyValidated: true });
        return {
            key: moveKey(move),
            score: ai._scoreMove(state, move, 'blue', bases, next),
            index
        };
    }).sort((left, right) => right.score - left.score || left.index - right.index);
}

async function runVersion(root) {
    const { GameState, AIController } = await loadVersion(root);
    const fixtures = createFixtures(GameState);
    const results = [];

    for (const fixture of fixtures) {
        for (const difficulty of ['hard', 'expert']) {
            const ai = new AIController(difficulty, fixture.adjacency, fixture.areaCenters);
            const move = ai.getBestMove(fixture.snapshot, 'blue');
            const stats = ai.lastSearchStats || {};
            results.push({
                fixture: fixture.name,
                difficulty,
                legalMoveCount: ai._generateMoves(
                    ai.adapter.createState(fixture.snapshot),
                    'blue',
                    ai.adapter.getBases(fixture.snapshot)
                ).length,
                move,
                moveKey: moveKey(move),
                decisionReason: ai.lastDecisionReason ?? stats.decisionReason ?? null,
                completedDepth: stats.completedDepth ?? 0,
                nodes: stats.nodes ?? 0,
                workUnits: stats.totalWorkUnits ?? stats.workUnits ?? 0,
                totalMs: Number((stats.totalMs ?? stats.elapsedMs ?? 0).toFixed(3))
            });
        }
    }
    return results;
}

const tempRoot = mkdtempSync(join(tmpdir(), 'tree-grow-ai-baseline-'));
const baseRoot = join(tempRoot, 'base');

try {
    git(['worktree', 'add', '--detach', baseRoot, baseSha]);
    symlinkSync(join(repoRoot, 'node_modules'), join(baseRoot, 'node_modules'), 'dir');

    const [baseline, candidate] = await Promise.all([
        runVersion(baseRoot),
        runVersion(repoRoot)
    ]);
    const baselineByKey = new Map(
        baseline.map(result => [`${result.fixture}:${result.difficulty}`, result])
    );
    const { GameState, AIController } = await loadVersion(baseRoot);
    const fixtures = createFixtures(GameState);

    const comparisons = candidate.map(result => {
        const key = `${result.fixture}:${result.difficulty}`;
        const oldResult = baselineByKey.get(key);
        const fixture = fixtures.find(item => item.name === result.fixture);
        const legacyRanking = getLegacyStaticRanking(AIController, fixture, result.difficulty);
        const candidateRank = legacyRanking.findIndex(item => item.key === result.moveKey);
        const selectedLegacyScore = candidateRank >= 0 ? legacyRanking[candidateRank].score : null;
        const bestLegacyScore = legacyRanking[0]?.score ?? null;

        return {
            fixture: result.fixture,
            difficulty: result.difficulty,
            baselineMove: oldResult?.move ?? null,
            candidateMove: result.move ?? null,
            sameMove: oldResult?.moveKey === result.moveKey,
            candidateMoveLegalInBaseline: candidateRank >= 0,
            candidateRankByLegacyStaticScore: candidateRank >= 0 ? candidateRank + 1 : null,
            legacyStaticScoreGap: selectedLegacyScore === null || bestLegacyScore === null
                ? null
                : Number((bestLegacyScore - selectedLegacyScore).toFixed(3)),
            baselineCompletedDepth: oldResult?.completedDepth ?? 0,
            candidateCompletedDepth: result.completedDepth,
            baselineNodes: oldResult?.nodes ?? 0,
            candidateNodes: result.nodes,
            baselineTotalMs: oldResult?.totalMs ?? 0,
            candidateTotalMs: result.totalMs,
            baselineDecisionReason: oldResult?.decisionReason ?? null,
            candidateDecisionReason: result.decisionReason
        };
    });

    console.log(JSON.stringify({
        benchmark: 'tree-grow-ai-base-compatibility',
        schemaVersion: 1,
        baseSha,
        candidateSha: git(['rev-parse', 'HEAD']),
        fixtures: ['sparse', 'branching', 'combat'],
        difficulties: ['hard', 'expert'],
        interpretation: [
            'This is a deterministic decision comparison, not a strength verdict.',
            'A changed move is not automatically a regression.',
            'candidateRankByLegacyStaticScore and legacyStaticScoreGap measure compatibility with the old one-ply heuristic only.',
            'Human game positions and tactical outcome review are still required before tuning evaluation weights.'
        ],
        comparisons
    }, null, 2));
} finally {
    try {
        git(['worktree', 'remove', '--force', baseRoot]);
    } catch {
        // The temporary worktree may not have been registered if setup failed.
    }
    rmSync(tempRoot, { recursive: true, force: true });
}
