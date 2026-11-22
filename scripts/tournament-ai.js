import { performance } from 'node:perf_hooks';
import { GameState } from '../js/game/GameState.js';
import { AIController } from '../js/ai/AIController.js';

const LEVELS = ['easy', 'medium', 'hard', 'expert'];
const DEFAULTS = { pairGames: 2, seedCount: 2, maxPlies: 120 };

function parseArgs(argv) {
    const options = { ...DEFAULTS, seeds: null, only: null };
    for (let index = 0; index < argv.length; index++) {
        const [key, inlineValue] = argv[index].split('=', 2);
        const value = inlineValue ?? argv[++index];
        if (key === '--pair-games') options.pairGames = Number(value);
        else if (key === '--seed-count') options.seedCount = Number(value);
        else if (key === '--max-plies') options.maxPlies = Number(value);
        else if (key === '--seeds') options.seeds = value.split(',').map(Number);
        else if (key === '--only') options.only = value.split(',').map(pair => pair.split(':'));
        else throw new TypeError(`Unknown argument: ${key}`);
    }
    for (const key of ['pairGames', 'seedCount', 'maxPlies']) {
        if (!Number.isInteger(options[key]) || options[key] < 1) {
            throw new TypeError(`--${key.replace(/[A-Z]/g, match => '-' + match.toLowerCase())} must be a positive integer`);
        }
    }
    if (options.seeds && (!options.seeds.length || options.seeds.some(seed => !Number.isSafeInteger(seed)))) {
        throw new TypeError('--seeds must contain comma-separated safe integers');
    }
    if (options.only?.some(pair => pair.length !== 2 || pair.some(level => !LEVELS.includes(level)))) {
        throw new TypeError(`--only pairs must use: ${LEVELS.join(', ')}`);
    }
    return options;
}

function createRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function createMap(seed, areaCount = 50) {
    const random = createRandom(seed);
    const edges = Array.from({ length: areaCount + 1 }, () => new Set());
    const connect = (left, right) => {
        if (left === right) return;
        edges[left].add(right);
        edges[right].add(left);
    };
    for (let area = 1; area <= areaCount; area++) {
        connect(area, area === areaCount ? 1 : area + 1);
    }
    // Add deterministic long-range edges while preserving a connected base ring.
    for (let area = 1; area <= areaCount; area++) {
        for (let edge = 0; edge < 2; edge++) {
            const target = 1 + Math.floor(random() * areaCount);
            connect(area, target);
        }
    }
    const adjacency = Object.fromEntries(
        Array.from({ length: areaCount }, (_, index) => [
            index + 1, [...edges[index + 1]].sort((a, b) => a - b)
        ])
    );
    const areaCenters = Array.from({ length: areaCount }, (_, index) => [
        (index % 10) * 100, Math.floor(index / 10) * 100
    ]);
    return { adjacency, areaCenters, areaCount };
}

function createInitialState(areaCenters) {
    const game = new GameState();
    game.currentTurn = 'red';
    game.addNode(null, ...areaCenters[0], 1, 'red');
    game.currentTurn = 'blue';
    game.addNode(null, ...areaCenters[25], 26, 'blue');
    game.currentTurn = 'red';
    return game;
}

function percentile(values, fraction) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function summarizeDecisions(samples) {
    const times = samples.map(sample => sample.elapsedMs);
    const nodes = samples.map(sample => sample.nodes);
    const depths = samples.map(sample => sample.depth).filter(depth => depth > 0);
    return {
        decisions: samples.length,
        meanMs: times.length ? Number((times.reduce((sum, value) => sum + value, 0) / times.length).toFixed(2)) : 0,
        p50Ms: Number(percentile(times, 0.50).toFixed(2)),
        p95Ms: Number(percentile(times, 0.95).toFixed(2)),
        maxMs: Number(Math.max(0, ...times).toFixed(2)),
        meanNodes: nodes.length ? Math.round(nodes.reduce((sum, value) => sum + value, 0) / nodes.length) : 0,
        maxNodes: Math.max(0, ...nodes),
        minCompletedDepth: depths.length ? Math.min(...depths) : 0,
        maxCompletedDepth: depths.length ? Math.max(...depths) : 0
    };
}

function playGame({ seed, redDifficulty, blueDifficulty, maxPlies }) {
    const { adjacency, areaCenters } = createMap(seed);
    let game = createInitialState(areaCenters);
    const bases = { red: 1, blue: 26 };
    const controllers = {
        red: new AIController(redDifficulty, adjacency, areaCenters),
        blue: new AIController(blueDifficulty, adjacency, areaCenters)
    };
    const decisionSamples = { red: [], blue: [] };
    let winner = null;
    let reason = 'ply-limit';
    let plies = 0;

    while (!game.isGameOver && plies < maxPlies) {
        const side = game.currentTurn;
        const enemy = side === 'red' ? 'blue' : 'red';
        const controller = controllers[side];
        const snapshot = { ...game.toJSON(), redBaseId: bases.red, blueBaseId: bases.blue };
        const startedAt = performance.now();
        const move = controller.getBestMove(snapshot, side);
        const elapsedMs = performance.now() - startedAt;
        const stats = controller.lastSearchStats;
        decisionSamples[side].push({
            elapsedMs,
            nodes: stats?.nodes ?? 0,
            depth: stats?.completedDepth ?? 0
        });

        let next;
        if (move) {
            next = controller._simulateMove(game, move, side, bases, { alreadyValidated: true });
            if (!next) throw new Error(`AI returned an unapplicable move: ${side}/${JSON.stringify(move)}`);
            if (move.targetAreaId === bases[enemy]) {
                winner = side;
                reason = 'base-invasion';
            }
        } else {
            next = controller._simulatePass(game, side);
        }

        game = next;
        plies++;
        if (game.isGameOver && !winner) {
            const ownRoots = game.getPlayerRootNodes(side).length;
            const enemyRoots = game.getPlayerRootNodes(enemy).length;
            winner = ownRoots === 0 ? enemy : enemyRoots === 0 ? side : null;
            reason = winner ? 'root-elimination' : 'game-over';
        }
    }

    return {
        seed,
        redDifficulty,
        blueDifficulty,
        winner,
        reason,
        plies,
        draw: winner === null,
        decisions: {
            red: summarizeDecisions(decisionSamples.red),
            blue: summarizeDecisions(decisionSamples.blue)
        }
    };
}

function scoreInterval(scores) {
    if (!scores.length) return { mean: 0, lower95: 0, upper95: 0 };
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    if (scores.length === 1) {
        return { mean: Number(mean.toFixed(3)), lower95: null, upper95: null };
    }
    const variance = scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / (scores.length - 1);
    const margin = 1.96 * Math.sqrt(variance / scores.length);
    return {
        mean: Number(mean.toFixed(3)),
        lower95: Number(Math.max(0, mean - margin).toFixed(3)),
        upper95: Number(Math.min(1, mean + margin).toFixed(3))
    };
}

function buildPairs(only) {
    if (only) return only;
    const pairs = [];
    for (let left = 0; left < LEVELS.length; left++) {
        for (let right = left + 1; right < LEVELS.length; right++) {
            pairs.push([LEVELS[left], LEVELS[right]]);
        }
    }
    return pairs;
}

function runTournament(options) {
    const seeds = options.seeds || Array.from(
        { length: options.seedCount }, (_, index) => 20261122 + index
    );
    const pairs = buildPairs(options.only);
    const matches = [];

    for (let pairIndex = 0; pairIndex < pairs.length; pairIndex++) {
        const [first, second] = pairs[pairIndex];
        for (const seed of seeds) {
            for (let gameIndex = 0; gameIndex < options.pairGames; gameIndex++) {
                const redDifficulty = gameIndex % 2 === 0 ? first : second;
                const blueDifficulty = gameIndex % 2 === 0 ? second : first;
                const mapSeed = (seed + pairIndex * 997) >>> 0;
                const randomSeed = (seed + pairIndex * 997 + Math.floor(gameIndex / 2) * 7919) >>> 0;
                const originalRandom = Math.random;
                Math.random = createRandom(randomSeed);
                try {
                    matches.push(playGame({
                        seed: mapSeed,
                        redDifficulty,
                        blueDifficulty,
                        maxPlies: options.maxPlies
                    }));
                } finally {
                    Math.random = originalRandom;
                }
            }
        }
    }

    const summaries = pairs.map(([first, second]) => {
        const games = matches.filter(match =>
            [match.redDifficulty, match.blueDifficulty].includes(first) &&
            [match.redDifficulty, match.blueDifficulty].includes(second)
        );
        const scores = games.map(match => {
            if (!match.winner) return 0.5;
            return match[match.winner === 'red' ? 'redDifficulty' : 'blueDifficulty'] === first ? 1 : 0;
        });
        return {
            matchup: `${first} vs ${second}`,
            games: games.length,
            firstWins: scores.filter(score => score === 1).length,
            draws: scores.filter(score => score === 0.5).length,
            secondWins: scores.filter(score => score === 0).length,
            firstScoreRate: scoreInterval(scores)
        };
    });

    return {
        tournament: 'tree-grow-ai-round-robin',
        levels: LEVELS,
        settings: { seeds, pairGames: options.pairGames, maxPlies: options.maxPlies },
        summaries,
        matches
    };
}

const options = parseArgs(process.argv.slice(2));
console.log(JSON.stringify(runTournament(options), null, 2));
