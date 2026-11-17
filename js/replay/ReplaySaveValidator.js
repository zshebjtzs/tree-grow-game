import { GameState } from '../game/GameState.js';
import { MatchHistory } from '../game/MatchHistory.js';
import { MatchTracker } from '../game/MatchTracker.js';
import { MapManager } from '../core/MapManager.js';

const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') {
        return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
    }
    return JSON.stringify(value);
}
const same = (a, b) => stable(a) === stable(b);
const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'];

function validateSnapshot(snapshot, mapManager, areaIds, redBaseId, blueBaseId) {
    if (!snapshot || typeof snapshot !== 'object' ||
        !snapshot.gameState || typeof snapshot.gameState !== 'object' ||
        !(snapshot.matchTracker === null || typeof snapshot.matchTracker === 'object') ||
        !(snapshot.lastMatchResult == null || typeof snapshot.lastMatchResult === 'object')) {
        throw new TypeError('棋谱快照结构无效');
    }

    const game = GameState.fromJSON(snapshot.gameState);
    for (const node of game.nodes) {
        if (node.x < 0 || node.x > 1800 || node.y < 0 || node.y > 1200 ||
            !areaIds.has(node.areaId) || mapManager.getAreaAtPoint(node.x, node.y) !== node.areaId) {
            throw new TypeError('棋谱节点坐标与所属地图区域不一致');
        }
        if (node.isRoot && node.areaId !== (node.owner === 'red' ? redBaseId : blueBaseId)) {
            throw new TypeError('棋谱根节点与所属方基地不一致');
        }
    }

    if (snapshot.matchTracker !== null) {
        const tracker = MatchTracker.fromJSON(snapshot.matchTracker);
        if (!tracker || tracker.events.some((event, index) =>
            !event || event.id !== index + 1 || !['red', 'blue'].includes(event.side) ||
            typeof event.type !== 'string' || !Number.isInteger(event.turn) ||
            !Number.isFinite(event.at))) {
            throw new TypeError('棋谱中的对局统计数据无效');
        }
    }
    if (snapshot.lastMatchResult != null &&
        (!Number.isInteger(snapshot.lastMatchResult.schemaVersion) ||
            !['red', 'blue', null].includes(snapshot.lastMatchResult.winner))) {
        throw new TypeError('棋谱中的对局结果数据无效');
    }
    return game;
}

export class ReplaySaveValidator {
    static validate(rawData) {
        if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
            throw new TypeError('存档必须是 JSON 对象');
        }
        if (rawData.schemaVersion != null && ![1, 2].includes(rawData.schemaVersion)) {
            throw new TypeError('暂不支持该版本的存档');
        }
        if (!Array.isArray(rawData.mapSeeds) || rawData.mapSeeds.length !== 50 ||
            !rawData.mapSeeds.every(seed => Array.isArray(seed) && seed.length === 2 &&
                Number.isFinite(seed[0]) && Number.isFinite(seed[1]) &&
                seed[0] >= 0 && seed[0] <= 1800 && seed[1] >= 0 && seed[1] <= 1200)) {
            throw new TypeError('存档地图种子无效或地图区域数量不正确');
        }
        if (rawData.gamePhase != null && rawData.gamePhase !== 'playing') {
            throw new TypeError('只有正式对局开始后的存档可以进入回放');
        }
        if (!Number.isInteger(rawData.redBaseId) || !Number.isInteger(rawData.blueBaseId) ||
            rawData.redBaseId < 1 || rawData.blueBaseId < 1 || rawData.redBaseId === rawData.blueBaseId) {
            throw new TypeError('存档双方基地信息无效');
        }
        if (rawData.isAIMode != null && typeof rawData.isAIMode !== 'boolean') {
            throw new TypeError('存档对战模式字段无效');
        }
        if (rawData.playerSide != null && !['red', 'blue'].includes(rawData.playerSide)) {
            throw new TypeError('存档玩家阵营字段无效');
        }
        if (rawData.difficulty != null && !DIFFICULTIES.includes(rawData.difficulty)) {
            throw new TypeError('存档 AI 难度字段无效');
        }

        const mapManager = new MapManager(1800, 1200);
        const mapAreas = mapManager.loadMapFromSeeds(rawData.mapSeeds);
        const areaIds = new Set(mapAreas.map(area => area.id));
        if (!areaIds.has(rawData.redBaseId) || !areaIds.has(rawData.blueBaseId)) {
            throw new TypeError('存档基地引用了不存在的地图区域');
        }

        const currentGame = GameState.fromJSON(rawData.gameState);
        for (const node of currentGame.nodes) {
            if (node.x < 0 || node.x > 1800 || node.y < 0 || node.y > 1200 ||
                !areaIds.has(node.areaId) || mapManager.getAreaAtPoint(node.x, node.y) !== node.areaId) {
                throw new TypeError('当前棋盘节点与地图区域不一致');
            }
            if (node.isRoot && node.areaId !== (node.owner === 'red' ? rawData.redBaseId : rawData.blueBaseId)) {
                throw new TypeError('根节点与所属方基地不一致');
            }
        }
        if (rawData.matchTracker != null && !MatchTracker.fromJSON(rawData.matchTracker)) {
            throw new TypeError('存档对局统计数据无效');
        }

        const currentSnapshot = MatchHistory.capture({
            gameState: currentGame.toJSON(),
            matchTracker: rawData.matchTracker ?? null,
            lastMatchResult: rawData.lastMatchResult ?? null
        });

        let history;
        const warnings = [];
        if (rawData.matchHistory == null) {
            history = MatchHistory.start(currentSnapshot, { historyIncomplete: true });
            warnings.push('该存档没有历史棋谱，只能查看保存时的局面，无法还原此前行动。');
        } else {
            history = MatchHistory.fromJSON(rawData.matchHistory);
        }

        let previousSnapshot = history.initialSnapshot;
        validateSnapshot(previousSnapshot, mapManager, areaIds, rawData.redBaseId, rawData.blueBaseId);
        for (const [index, actionRecord] of history.actions.entries()) {
            if (!same(actionRecord.before, previousSnapshot)) {
                throw new TypeError(`棋谱第 ${index + 1} 步与前一步状态无法衔接`);
            }
            validateSnapshot(actionRecord.before, mapManager, areaIds, rawData.redBaseId, rawData.blueBaseId);
            validateSnapshot(actionRecord.after, mapManager, areaIds, rawData.redBaseId, rawData.blueBaseId);

            const action = actionRecord.action;
            const beforeGame = GameState.fromJSON(actionRecord.before.gameState);
            const afterGame = GameState.fromJSON(actionRecord.after.gameState);
            const nextSide = actionRecord.side === 'red' ? 'blue' : 'red';
            if (beforeGame.isGameOver || beforeGame.currentTurn !== actionRecord.side) {
                throw new TypeError(`棋谱第 ${index + 1} 步的行动方与行动前回合不一致`);
            }
            if (!afterGame.isGameOver && afterGame.currentTurn !== nextSide) {
                throw new TypeError(`棋谱第 ${index + 1} 步结束后没有正确切换行动方`);
            }
            if (action.type === 'growth') {
                if (!Number.isInteger(action.parentNodeId) || action.parentNodeId < 1 ||
                    !Number.isInteger(action.targetAreaId) || !areaIds.has(action.targetAreaId) ||
                    !Number.isInteger(action.nodeId) || action.nodeId < 1 ||
                    typeof action.isAttack !== 'boolean' ||
                    (action.path != null && (!Array.isArray(action.path) || action.path.length < 2 ||
                        !action.path.every(id => Number.isInteger(id) && areaIds.has(id))))) {
                    throw new TypeError(`棋谱第 ${index + 1} 步的生长行动字段无效`);
                }
                const parent = beforeGame.getNode(action.parentNodeId);
                if (!parent || parent.owner !== actionRecord.side || parent.isDestroyed ||
                    action.nodeId !== beforeGame.nodeIdCounter + 1 ||
                    afterGame.nodeIdCounter !== action.nodeId) {
                    throw new TypeError(`棋谱第 ${index + 1} 步引用了无效的父节点或新节点编号`);
                }
                if (action.path != null) {
                    if (action.path[0] !== parent.areaId ||
                        action.path[action.path.length - 1] !== action.targetAreaId) {
                        throw new TypeError(`棋谱第 ${index + 1} 步的生长路径端点无效`);
                    }
                    for (let pathIndex = 1; pathIndex < action.path.length; pathIndex++) {
                        const from = action.path[pathIndex - 1];
                        const to = action.path[pathIndex];
                        if (!(mapManager.adjacency[from] || []).includes(to)) {
                            throw new TypeError(`棋谱第 ${index + 1} 步包含不连通的地图路径`);
                        }
                    }
                }
            } else if (action.type === 'skip') {
                if (afterGame.nodeIdCounter !== beforeGame.nodeIdCounter ||
                    afterGame.isGameOver || afterGame.currentTurn !== nextSide) {
                    throw new TypeError(`棋谱第 ${index + 1} 步的跳过回合状态无效`);
                }
            } else {
                throw new TypeError(`棋谱第 ${index + 1} 步包含未知行动类型`);
            }
            previousSnapshot = actionRecord.after;
        }

        if (!same(previousSnapshot, currentSnapshot)) {
            throw new TypeError('棋谱末端快照与存档当前棋盘不一致');
        }
        if (history.historyIncomplete && warnings.length === 0) {
            warnings.push('该棋谱只包含一个不完整历史段；历史起点之前的行动不可恢复。');
        }

        const normalizedData = copy(rawData);
        normalizedData.matchHistory = history.toJSON();
        normalizedData.matchTracker = currentSnapshot.matchTracker;
        normalizedData.lastMatchResult = currentSnapshot.lastMatchResult;
        return {
            data: normalizedData,
            history,
            mapManager,
            mapAreas,
            currentGame,
            warnings,
            metadata: {
                mode: rawData.isAIMode ? 'pve' : 'pvp',
                playerSide: rawData.playerSide === 'blue' ? 'blue' : 'red',
                difficulty: rawData.difficulty || 'medium',
                redBaseId: rawData.redBaseId,
                blueBaseId: rawData.blueBaseId
            }
        };
    }
}
