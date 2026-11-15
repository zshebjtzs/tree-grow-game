import { GameState } from '../game/GameState.js';
import { RuleEngine } from '../game/RuleEngine.js';
import { MapManager } from '../core/MapManager.js';

/**
 * Build a fresh, validated tutorial runtime from immutable scenario data.
 * A private MapManager is used so failed scenario loading cannot mutate the
 * active match's map or topology.
 */
export function createTutorialScenario(scenario, { width = 1800, height = 1200 } = {}) {
    if (!scenario || typeof scenario !== 'object' ||
        typeof scenario.id !== 'string' || !scenario.id.trim()) {
        throw new TypeError('教学场景必须包含有效的 id');
    }
    if (!Number.isFinite(width) || width <= 0 ||
        !Number.isFinite(height) || height <= 0) {
        throw new TypeError('教学地图尺寸无效');
    }

    const mapManager = new MapManager(width, height);
    const mapAreas = mapManager.loadMapFromSeeds(scenario.mapSeeds);
    const game = GameState.fromJSON(scenario.gameState);

    if (game.isGameOver) {
        throw new TypeError('教学场景不能从已结束的对局状态开始');
    }

    const areaIds = new Set(mapAreas.map(area => area.id));
    const { redBaseId, blueBaseId } = scenario;
    if (!Number.isInteger(redBaseId) || !areaIds.has(redBaseId) ||
        !Number.isInteger(blueBaseId) || !areaIds.has(blueBaseId) ||
        redBaseId === blueBaseId) {
        throw new TypeError('教学场景的双方基地引用无效');
    }

    for (const node of game.nodes) {
        if (!areaIds.has(node.areaId)) {
            throw new TypeError(`教学节点 #${node.id} 引用了不存在的区域`);
        }
        if (mapManager.getAreaAtPoint(node.x, node.y) !== node.areaId) {
            throw new TypeError(`教学节点 #${node.id} 的坐标与所属区域不一致`);
        }
    }

    const redRoots = game.getPlayerRootNodes('red');
    const blueRoots = game.getPlayerRootNodes('blue');
    if (!redRoots.some(node => node.areaId === redBaseId) ||
        !blueRoots.some(node => node.areaId === blueBaseId)) {
        throw new TypeError('教学场景必须在双方基地中分别包含至少一个存活根节点');
    }

    return {
        sessionType: 'tutorial',
        scenarioId: scenario.id,
        mapManager,
        mapAreas,
        mapSeeds: mapManager.seeds.map(seed => [...seed]),
        game,
        ruleEngine: new RuleEngine(mapManager),
        redBaseId,
        blueBaseId
    };
}
