import { performance } from 'node:perf_hooks';
import { GameState } from '../js/game/GameState.js';
import { AIController } from '../js/ai/AIController.js';
import { DIFFICULTY_LEVELS } from '../js/ai/DifficultyProfiles.js';

const AREA_COUNT = 50;
const ITERATIONS = 40;
const WARMUP = 5;

function createFixture() {
    const adjacency = {};
    const edges = Array.from({ length: AREA_COUNT + 1 }, () => new Set());
    const connect = (left, right) => {
        edges[left].add(right);
        edges[right].add(left);
    };
    for (let area = 1; area <= AREA_COUNT; area++) {
        connect(area, area === AREA_COUNT ? 1 : area + 1);
        connect(area, ((area + 12) % AREA_COUNT) + 1);
    }
    for (let area = 1; area <= AREA_COUNT; area++) {
        adjacency[area] = [...edges[area]];
    }
    const areaCenters = Array.from({ length: AREA_COUNT }, (_, index) => [index * 10, 0]);
    const game = new GameState();

    game.currentTurn = 'red';
    game.addNode(null, 0, 0, 1, 'red');
    const redBranch = game.addNode(1, 10, 0, 2, 'red');
    game.addNode(redBranch.id, 20, 0, 3, 'red');

    game.currentTurn = 'blue';
    game.addNode(null, 250, 0, 26, 'blue');
    const blueBranch = game.addNode(4, 260, 0, 27, 'blue');
    game.addNode(blueBranch.id, 270, 0, 28, 'blue');
    game.addNode(blueBranch.id, 270, 10, 37, 'blue');

    game.currentTurn = 'blue';
    return {
        snapshot: { ...game.toJSON(), redBaseId: 1, blueBaseId: 26 },
        adjacency,
        areaCenters
    };
}

function createPositionFixture(kind) {
    const base = createFixture();
    const game = new GameState();

    if (kind === 'branching') {
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
    } else if (kind === 'combat') {
        game.currentTurn = 'red';
        const redRoot = game.addNode(null, 0, 0, 1, 'red');
        const redBranch = game.addNode(redRoot.id, 130, 0, 14, 'red');
        game.addNode(redBranch.id, 140, 0, 15, 'red');

        game.currentTurn = 'blue';
        const blueRoot = game.addNode(null, 250, 0, 26, 'blue');
        const blueBranch = game.addNode(blueRoot.id, 260, 0, 27, 'blue');
        game.addNode(blueBranch.id, 270, 0, 28, 'blue');
    } else {
        throw new TypeError(`Unknown benchmark fixture: ${kind}`);
    }

    game.currentTurn = 'blue';
    return {
        name: kind,
        snapshot: { ...game.toJSON(), redBaseId: 1, blueBaseId: 26 },
        adjacency: base.adjacency,
        areaCenters: base.areaCenters
    };
}

function percentile(sorted, fraction) {
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

const fixtures = [
    { name: 'sparse', ...createFixture() },
    createPositionFixture('branching'),
    createPositionFixture('combat')
];
const results = [];

for (const fixture of fixtures) {
    for (const difficulty of DIFFICULTY_LEVELS) {
        const variants = ['hard', 'expert'].includes(difficulty)
            ? ['alpha-beta', 'pvs']
            : ['pvs'];
        const createAI = variant => {
            const ai = new AIController(difficulty, fixture.adjacency, fixture.areaCenters);
            if (variant === 'alpha-beta') {
                const search = ai.searchEngine.search.bind(ai.searchEngine);
                ai.searchEngine.search = options => search({
                    ...options,
                    principalVariationSearch: false
                });
            }
            return ai;
        };
        if (['hard', 'expert'].includes(difficulty)) {
            const baselineAI = createAI('alpha-beta');
            const optimizedAI = createAI('pvs');
            const baselineMove = baselineAI.getBestMove(fixture.snapshot, 'blue');
            const optimizedMove = optimizedAI.getBestMove(fixture.snapshot, 'blue');
            const sameMove = baselineMove?.parentNodeId === optimizedMove?.parentNodeId &&
                baselineMove?.targetAreaId === optimizedMove?.targetAreaId;
            const baselineStats = baselineAI.lastSearchStats;
            const optimizedStats = optimizedAI.lastSearchStats;
            if (!sameMove || baselineStats.value !== optimizedStats.value ||
                baselineStats.completedDepth !== optimizedStats.completedDepth) {
                throw new Error(
                    `PVS parity failed for ${fixture.name}/${difficulty}: ` +
                    `baseline=${JSON.stringify({ baselineMove, baselineStats })}, ` +
                    `optimized=${JSON.stringify({ optimizedMove, optimizedStats })}`
                );
            }
        }
        for (const variant of variants) {
        const ai = createAI(variant);
        const probe = GameState.fromJSON(fixture.snapshot);
        probe.currentTurn = 'blue';
        const legalMoveCount = ai._generateMoves(probe, 'blue', {
            red: fixture.snapshot.redBaseId,
            blue: fixture.snapshot.blueBaseId
        }).length;
        if (legalMoveCount === 0) {
            throw new Error(`Benchmark fixture ${fixture.name} has no legal blue moves for ${difficulty}`);
        }
        for (let index = 0; index < WARMUP; index++) {
            ai.getBestMove(fixture.snapshot, 'blue');
        }

        const samples = [];
        const preparationSamples = [];
        const searchStats = [];
        for (let index = 0; index < ITERATIONS; index++) {
            const start = performance.now();
            ai.getBestMove(fixture.snapshot, 'blue');
            const totalElapsedMs = performance.now() - start;
            samples.push(totalElapsedMs);
            if (ai.lastSearchStats) {
                searchStats.push(ai.lastSearchStats);
                preparationSamples.push(Math.max(0, totalElapsedMs - ai.lastSearchStats.elapsedMs));
            }
        }
        samples.sort((a, b) => a - b);
        results.push({
            fixture: fixture.name,
            legalMoveCount,
            difficulty,
            searchVariant: variant,
            samples: samples.length,
            meanMs: Number((samples.reduce((sum, value) => sum + value, 0) / samples.length).toFixed(3)),
            p50Ms: Number(percentile(samples, 0.50).toFixed(3)),
            p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
            maxMs: Number(samples.at(-1).toFixed(3)),
            meanPreparationMs: preparationSamples.length
                ? Number((preparationSamples.reduce((sum, value) => sum + value, 0) /
                    preparationSamples.length).toFixed(3))
                : 0,
            p95PreparationMs: preparationSamples.length
                ? Number(percentile([...preparationSamples].sort((a, b) => a - b), 0.95).toFixed(3))
                : 0,
            meanSearchMs: searchStats.length
                ? Number((searchStats.reduce((sum, item) => sum + item.elapsedMs, 0) /
                    searchStats.length).toFixed(3))
                : 0,
            meanNodes: searchStats.length
                ? Math.round(searchStats.reduce((sum, item) => sum + item.nodes, 0) / searchStats.length)
                : 0,
            maxNodes: searchStats.length ? Math.max(...searchStats.map(item => item.nodes)) : 0,
            meanAspirationResearches: searchStats.length
                ? Number((searchStats.reduce((sum, item) => sum + (item.aspirationResearches || 0), 0) /
                    searchStats.length).toFixed(2))
                : 0,
            meanAspirationOneSidedResearches: searchStats.length
                ? Number((searchStats.reduce((sum, item) =>
                    sum + (item.aspirationOneSidedResearches || 0), 0) /
                    searchStats.length).toFixed(2))
                : 0,
            aspirationOneSidedResearchCount: searchStats.reduce((sum, item) =>
                sum + (item.aspirationOneSidedResearches || 0), 0),
            aspirationFailHighCount: searchStats.reduce((sum, item) =>
                sum + (item.aspirationFailHigh || 0), 0),
            aspirationFailLowCount: searchStats.reduce((sum, item) =>
                sum + (item.aspirationFailLow || 0), 0),
            completedDepthMin: searchStats.length
                ? Math.min(...searchStats.map(item => item.completedDepth))
                : 0,
            completedDepthMax: searchStats.length
                ? Math.max(...searchStats.map(item => item.completedDepth))
                : 0
        });
        }
    }
}

console.log(JSON.stringify({
    benchmark: 'tree-grow-ai-multi-position',
    difficulties: DIFFICULTY_LEVELS,
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    areas: AREA_COUNT,
    fixtures: fixtures.map(fixture => fixture.name),
    warmup: WARMUP,
    iterations: ITERATIONS,
    results
}, null, 2));
