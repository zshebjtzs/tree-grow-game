import { performance } from 'node:perf_hooks';
import { GameState } from '../js/game/GameState.js';
import { AIController } from '../js/ai/AIController.js';

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

function percentile(sorted, fraction) {
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

const fixture = createFixture();
const results = [];

for (const difficulty of ['easy', 'medium', 'hard', 'expert']) {
    const ai = new AIController(difficulty, fixture.adjacency, fixture.areaCenters);
    for (let index = 0; index < WARMUP; index++) {
        ai.getBestMove(fixture.snapshot, 'blue');
    }

    const samples = [];
    const searchStats = [];
    for (let index = 0; index < ITERATIONS; index++) {
        const start = performance.now();
        ai.getBestMove(fixture.snapshot, 'blue');
        samples.push(performance.now() - start);
        if (ai.lastSearchStats) searchStats.push(ai.lastSearchStats);
    }
    samples.sort((a, b) => a - b);
    results.push({
        difficulty,
        samples: samples.length,
        meanMs: Number((samples.reduce((sum, value) => sum + value, 0) / samples.length).toFixed(3)),
        p50Ms: Number(percentile(samples, 0.50).toFixed(3)),
        p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
        maxMs: Number(samples.at(-1).toFixed(3)),
        meanNodes: searchStats.length
            ? Math.round(searchStats.reduce((sum, item) => sum + item.nodes, 0) / searchStats.length)
            : 0,
        maxNodes: searchStats.length ? Math.max(...searchStats.map(item => item.nodes)) : 0,
        completedDepthMin: searchStats.length
            ? Math.min(...searchStats.map(item => item.completedDepth))
            : 0,
        completedDepthMax: searchStats.length
            ? Math.max(...searchStats.map(item => item.completedDepth))
            : 0
    });
}

console.log(JSON.stringify({
    benchmark: 'tree-grow-ai-baseline',
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    areas: AREA_COUNT,
    warmup: WARMUP,
    iterations: ITERATIONS,
    results
}, null, 2));
