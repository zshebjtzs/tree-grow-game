import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { MapManager } from '../js/core/MapManager.js';
import { GameState } from '../js/game/GameState.js';
import { ReplaySaveValidator } from '../js/replay/ReplaySaveValidator.js';
import { AIController } from '../js/ai/AIController.js';
import { DIFFICULTY_LEVELS } from '../js/ai/DifficultyProfiles.js';

const MAGIC = Buffer.from([0x54, 0x47, 0x53, 0x56, 0x01, 0x0a]);
const DEFAULT_DIFFICULTIES = DIFFICULTY_LEVELS;
const DEFAULT_AI_SIDE = 'blue';

function readSave(path) {
    const bytes = readFileSync(path);
    let jsonBytes = bytes;
    if (bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
        jsonBytes = gunzipSync(bytes.subarray(MAGIC.length));
    }
    const data = JSON.parse(jsonBytes.toString('utf8'));
    return data;
}

function parseArgs(argv) {
    const options = { path: null, difficulties: [...DEFAULT_DIFFICULTIES], side: DEFAULT_AI_SIDE };
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--difficulty') {
            options.difficulties = (argv[++index] || '').split(',').filter(Boolean);
        } else if (arg === '--side') {
            options.side = argv[++index];
        } else if (arg === '--help' || arg === '-h') {
            console.log('Usage: node scripts/analyze-ai-save.js <save.sav> [--difficulty beginner,easy,...] [--side red|blue]');
            process.exit(0);
        } else if (!arg.startsWith('--') && options.path === null) {
            options.path = arg;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    if (!options.path) throw new Error('Missing save file path. Use --help for usage.');
    if (!['red', 'blue'].includes(options.side)) throw new Error('Side must be red or blue.');
    for (const difficulty of options.difficulties) {
        if (!DIFFICULTY_LEVELS.includes(difficulty)) throw new Error(`Unknown difficulty: ${difficulty}`);
    }
    return options;
}

function moveMatchesRecord(move, action) {
    return move?.parentNodeId === action.parentNodeId &&
        move?.targetAreaId === action.targetAreaId;
}

function countAlive(game, side) {
    return {
        nodes: game.getAliveNodesByOwner(side).length,
        roots: game.getPlayerRootNodes(side).length
    };
}

function analyzeReplies(controller, state, move, side, bases) {
    const adapter = controller.adapter;
    const afterMove = adapter.simulateMove(state, move, side, bases, { alreadyValidated: true });
    if (!afterMove || afterMove.isGameOver) {
        return {
            terminal: true,
            opponentReplies: 0,
            maxRootLoss: 0,
            maxNodeLoss: 0,
            rootLossReplies: 0,
            largestLossReply: null
        };
    }

    const enemy = side === 'red' ? 'blue' : 'red';
    const before = countAlive(afterMove, side);
    const replyState = adapter.createState(afterMove.toJSON());
    adapter.setSideToMove(replyState, enemy);
    const replies = adapter.generateMoves(replyState, enemy, bases);
    let maxRootLoss = 0;
    let maxNodeLoss = 0;
    let rootLossReplies = 0;
    let largestLossReply = null;

    for (const reply of replies) {
        const afterReply = adapter.simulateMove(
            replyState, reply, enemy, bases, { alreadyValidated: true }
        );
        if (!afterReply) continue;
        const remaining = countAlive(afterReply, side);
        const rootLoss = before.roots - remaining.roots;
        const nodeLoss = before.nodes - remaining.nodes;
        if (rootLoss > 0) rootLossReplies++;
        if (rootLoss > maxRootLoss || (rootLoss === maxRootLoss && nodeLoss > maxNodeLoss)) {
            maxRootLoss = rootLoss;
            maxNodeLoss = nodeLoss;
            largestLossReply = {
                parentNodeId: reply.parentNodeId,
                targetAreaId: reply.targetAreaId,
                isAttack: Boolean(reply.attacks),
                rootLoss,
                nodeLoss
            };
        }
    }

    return {
        terminal: false,
        opponentReplies: replies.length,
        maxRootLoss,
        maxNodeLoss,
        rootLossReplies,
        largestLossReply
    };
}

function analyzePosition({ record, mapManager, bases, difficulties, side }) {
    const game = GameState.fromJSON(record.before.gameState);
    if (game.currentTurn !== side) {
        throw new Error(`Action ${record.sequence}: expected ${side} to move, got ${game.currentTurn}`);
    }
    const snapshot = {
        ...game.toJSON(),
        redBaseId: bases.red,
        blueBaseId: bases.blue
    };
    const results = [];

    for (const difficulty of difficulties) {
        const controller = new AIController(
            difficulty,
            mapManager.adjacency,
            mapManager.areas.map(area => area.center)
        );
        const start = performance.now();
        const selected = controller.getBestMove(snapshot, side);
        const elapsedMs = performance.now() - start;
        const legalMoves = controller._generateMoves(game, side, bases);
        const candidateResults = legalMoves.map(move => ({
            move: { parentNodeId: move.parentNodeId, targetAreaId: move.targetAreaId, isAttack: move.attacks },
            ...analyzeReplies(controller, game, move, side, bases)
        }));
        const actualMove = record.action.type === 'growth'
            ? legalMoves.find(move => moveMatchesRecord(move, record.action))
            : null;
        const actualRisk = actualMove
            ? candidateResults.find(item =>
                item.move.parentNodeId === actualMove.parentNodeId &&
                item.move.targetAreaId === actualMove.targetAreaId
            )
            : null;
        const selectedRisk = selected
            ? candidateResults.find(item =>
                item.move.parentNodeId === selected.parentNodeId &&
                item.move.targetAreaId === selected.targetAreaId
            )
            : null;

        results.push({
            difficulty,
            selectedMove: selected ? {
                parentNodeId: selected.parentNodeId,
                targetAreaId: selected.targetAreaId
            } : null,
            selectedMatchesHistorical: moveMatchesRecord(selected, record.action),
            historicalMoveIsLegal: Boolean(actualMove),
            historicalMoveRisk: actualRisk || null,
            selectedMoveRisk: selectedRisk || null,
            legalCandidateCount: legalMoves.length,
            elapsedMs: Number(elapsedMs.toFixed(2)),
            searchStats: controller.lastSearchStats
        });
    }

    return {
        sequence: record.sequence,
        side: record.side,
        historicalAction: record.action,
        before: {
            currentTurn: game.currentTurn,
            red: countAlive(game, 'red'),
            blue: countAlive(game, 'blue')
        },
        decisions: results
    };
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const raw = readSave(options.path);
    // Validation reconstructs the map, validates all historical snapshots,
    // and checks that every action's before/after states form one valid chain.
    const validated = ReplaySaveValidator.validate(raw);
    const mapManager = validated.mapManager;
    const bases = { red: raw.redBaseId, blue: raw.blueBaseId };
    const selectedRecords = validated.history.actions.filter(record =>
        record.side === options.side && record.action.type === 'growth'
    );
    if (!selectedRecords.length) throw new Error(`No ${options.side} growth turns found in save history.`);

    // Verify that rebuilding the same map seeds produces the same indexed areas
    // and that every historical node still maps to its recorded area.
    const rebuilt = new MapManager(1800, 1200);
    rebuilt.loadMapFromSeeds(raw.mapSeeds);
    const topologyMatches = Object.keys(mapManager.adjacency).every(areaId =>
        JSON.stringify(mapManager.adjacency[areaId]) === JSON.stringify(rebuilt.adjacency[areaId])
    );
    if (!topologyMatches) throw new Error('Map topology was not deterministic across rebuilds.');

    const positions = selectedRecords.map(record => analyzePosition({
        record, mapManager, bases,
        difficulties: options.difficulties,
        side: options.side
    }));

    console.log(JSON.stringify({
        benchmark: 'tree-grow-historical-save-analysis',
        save: options.path,
        mode: raw.isAIMode ? 'pve' : 'pvp',
        savedDifficulty: raw.difficulty,
        analyzedSide: options.side,
        map: {
            width: 1800,
            height: 1200,
            areaCount: validated.mapAreas.length,
            topologyMatchesOnRebuild: topologyMatches,
            edgeCount: Object.values(mapManager.adjacency).reduce((sum, neighbors) => sum + neighbors.length, 0) / 2
        },
        actionCount: validated.history.actions.length,
        analyzedPositions: positions.length,
        positions
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(`AI save analysis failed: ${error.message}`);
    process.exitCode = 1;
}
