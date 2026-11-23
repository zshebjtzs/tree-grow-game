import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GameState } from '../js/game/GameState.js';
import { MapManager } from '../js/core/MapManager.js';
import { AIController } from '../js/ai/AIController.js';
import { DIFFICULTY_LEVELS } from '../js/ai/DifficultyProfiles.js';
import { calculatePairedScoreRate, validatePairGames } from './tournament-stats.js';

const LEVELS = DIFFICULTY_LEVELS;
const DEFAULTS = { pairGames: 2, seedCount: 2, maxPlies: 120 };

function parseArgs(argv) {
    const options = { ...DEFAULTS, seeds: null, only: null, baselineController: null };
    for (let index = 0; index < argv.length; index++) {
        const [key, inlineValue] = argv[index].split('=', 2);
        const value = inlineValue ?? argv[++index];
        if (key === '--pair-games') options.pairGames = Number(value);
        else if (key === '--seed-count') options.seedCount = Number(value);
        else if (key === '--max-plies') options.maxPlies = Number(value);
        else if (key === '--seeds') options.seeds = value.split(',').map(Number);
        else if (key === '--only') options.only = value.split(',').map(pair => pair.split(':'));
        else if (key === '--baseline-controller') options.baselineController = value;
        else if (key === '--help' || key === '-h') {
            console.log('Usage: node scripts/tournament-ai.js [--seed-count N] [--pair-games N] [--max-plies N] [--only hard:expert,...] [--baseline-controller <legacy-worktree>/js/ai/AIController.js]');
            process.exit(0);
        } else throw new TypeError(`Unknown argument: ${key}`);
    }
    validatePairGames(options.pairGames);
    for (const key of ['seedCount', 'maxPlies']) {
        if (!Number.isInteger(options[key]) || options[key] < 1) {
            throw new TypeError(`--${key.replace(/[A-Z]/g, match => '-' + match.toLowerCase())} must be a positive integer`);
        }
    }
    if (options.seeds && (!options.seeds.length || options.seeds.some(seed => !Number.isSafeInteger(seed)))) {
        throw new TypeError('--seeds must contain comma-separated safe integers');
    }
    if (options.baselineController !== null && !options.baselineController) {
        throw new TypeError('--baseline-controller requires a module path');
    }
    const supportedLevels = options.baselineController ? [...LEVELS, 'legacy-hard'] : LEVELS;
    if (options.only?.some(pair => pair.length !== 2 || pair.some(level => !supportedLevels.includes(level)))) {
        throw new TypeError(`--only pairs must use: ${supportedLevels.join(', ')}`);
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
    // Use the same Voronoi + Lloyd-relaxation generator as the live game.
    // The seeded Math.random stream makes the generated map reproducible.
    const originalRandom = Math.random;
    const originalLog = console.log;
    Math.random = createRandom(seed);
    console.log = () => {};
    try {
        const manager = new MapManager(1800, 1200);
        manager.generateMap(areaCount, 6);
        const adjacency = manager.adjacency;
        const areaCenters = manager.areas.map(area => [...area.center]);

        let redBaseId = 1;
        let blueBaseId = areaCount;
        let baseDistance = -1;
        for (let start = 1; start <= areaCount; start++) {
            const distances = new Map([[start, 0]]);
            const queue = [start];
            for (let head = 0; head < queue.length; head++) {
                const current = queue[head];
                for (const next of adjacency[current] || []) {
                    if (distances.has(next)) continue;
                    distances.set(next, distances.get(current) + 1);
                    queue.push(next);
                }
            }
            for (let target = start + 1; target <= areaCount; target++) {
                const distance = distances.get(target);
                if (distance !== undefined && distance > baseDistance) {
                    redBaseId = start;
                    blueBaseId = target;
                    baseDistance = distance;
                }
            }
        }

        return {
            adjacency,
            areaCenters,
            areaCount: manager.areas.length,
            redBaseId,
            blueBaseId,
            baseDistance,
            generator: 'voronoi-lloyd'
        };
    } finally {
        Math.random = originalRandom;
        console.log = originalLog;
    }
}

function createInitialState(areaCenters, bases) {
    const game = new GameState();
    game.currentTurn = 'red';
    game.addNode(null, ...areaCenters[bases.redBaseId - 1], bases.redBaseId, 'red');
    game.currentTurn = 'blue';
    game.addNode(null, ...areaCenters[bases.blueBaseId - 1], bases.blueBaseId, 'blue');
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
    const preparationTimes = samples.map(sample => sample.preparationMs);
    const searchTimes = samples.map(sample => sample.searchMs);
    return {
        decisions: samples.length,
        meanMs: times.length ? Number((times.reduce((sum, value) => sum + value, 0) / times.length).toFixed(2)) : 0,
        p50Ms: Number(percentile(times, 0.50).toFixed(2)),
        p95Ms: Number(percentile(times, 0.95).toFixed(2)),
        maxMs: Number(Math.max(0, ...times).toFixed(2)),
        meanPreparationMs: preparationTimes.length ? Number((preparationTimes.reduce((sum, value) => sum + value, 0) / preparationTimes.length).toFixed(2)) : 0,
        meanSearchMs: searchTimes.length ? Number((searchTimes.reduce((sum, value) => sum + value, 0) / searchTimes.length).toFixed(2)) : 0,
        deadlineExceeded: samples.filter(sample => sample.deadlineExceeded).length,
        meanNodes: nodes.length ? Math.round(nodes.reduce((sum, value) => sum + value, 0) / nodes.length) : 0,
        maxNodes: Math.max(0, ...nodes),
        minCompletedDepth: depths.length ? Math.min(...depths) : 0,
        maxCompletedDepth: depths.length ? Math.max(...depths) : 0
    };
}

function playGame({ seed, pairId, randomSeed, redDifficulty, blueDifficulty, maxPlies, BaselineAIController }) {
    const map = createMap(seed);
    const { adjacency, areaCenters } = map;
    let game = createInitialState(areaCenters, map);
    const bases = { red: map.redBaseId, blue: map.blueBaseId };
    const createController = difficulty => difficulty === 'legacy-hard'
        ? new BaselineAIController('hard', adjacency, areaCenters)
        : new AIController(difficulty, adjacency, areaCenters);
    const controllers = {
        red: createController(redDifficulty),
        blue: createController(blueDifficulty)
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
            depth: stats?.completedDepth ?? 0,
            preparationMs: stats?.preparationMs ?? 0,
            searchMs: stats?.elapsedMs ?? 0,
            deadlineExceeded: stats?.deadlineExceeded ?? false
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
        pairId,
        randomSeed,
        baseDistance: map.baseDistance,
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

function buildPairs(only, levels) {
    if (only) return only;
    const pairs = [];
    for (let left = 0; left < levels.length; left++) {
        for (let right = left + 1; right < levels.length; right++) {
            pairs.push([levels[left], levels[right]]);
        }
    }
    return pairs;
}

function runTournament(options, BaselineAIController = null) {
    const levels = BaselineAIController ? [...LEVELS, 'legacy-hard'] : LEVELS;
    const seeds = options.seeds || Array.from(
        { length: options.seedCount }, (_, index) => 20261122 + index
    );
    const pairs = buildPairs(options.only, levels);
    const matches = [];

    for (let pairIndex = 0; pairIndex < pairs.length; pairIndex++) {
        const [first, second] = pairs[pairIndex];
        for (const seed of seeds) {
            for (let gameIndex = 0; gameIndex < options.pairGames; gameIndex++) {
                const redDifficulty = gameIndex % 2 === 0 ? first : second;
                const blueDifficulty = gameIndex % 2 === 0 ? second : first;
                const mapSeed = (seed + pairIndex * 997) >>> 0;
                const swapPairIndex = Math.floor(gameIndex / 2);
                const randomSeed = (seed + pairIndex * 997 + swapPairIndex * 7919) >>> 0;
                const pairId = `${pairIndex}:${seed}:${swapPairIndex}`;
                const originalRandom = Math.random;
                Math.random = createRandom(randomSeed);
                try {
                    matches.push(playGame({
                        seed: mapSeed,
                        pairId,
                        randomSeed,
                        redDifficulty,
                        blueDifficulty,
                        maxPlies: options.maxPlies,
                        BaselineAIController
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
        const gameScores = games.map(match => {
            if (!match.winner) return 0.5;
            return match[match.winner === 'red' ? 'redDifficulty' : 'blueDifficulty'] === first ? 1 : 0;
        });
        const paired = calculatePairedScoreRate(games, first);
        return {
            matchup: `${first} vs ${second}`,
            games: games.length,
            pairedSamples: paired.pairedSamples,
            firstWins: gameScores.filter(score => score === 1).length,
            draws: gameScores.filter(score => score === 0.5).length,
            secondWins: gameScores.filter(score => score === 0).length,
            firstScoreRate: paired.firstScoreRate
        };
    });

    return {
        tournament: 'tree-grow-ai-round-robin',
        levels,
        settings: {
            seeds,
            pairGames: options.pairGames,
            maxPlies: options.maxPlies,
            mapGenerator: 'voronoi-lloyd',
            baselineController: Boolean(BaselineAIController)
        },
        summaries,
        matches
    };
}

async function loadBaselineController(path) {
    const moduleUrl = pathToFileURL(resolve(path)).href;
    const module = await import(moduleUrl);
    if (typeof module.AIController !== 'function') {
        throw new TypeError('Baseline module must export AIController');
    }
    return module.AIController;
}

const options = parseArgs(process.argv.slice(2));
const BaselineAIController = options.baselineController
    ? await loadBaselineController(options.baselineController)
    : null;
console.log(JSON.stringify(runTournament(options, BaselineAIController), null, 2));
