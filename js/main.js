// js/main.js
import { GameState } from './game/GameState.js';
import { AppState } from './app/AppState.js';
import { MapManager } from './core/MapManager.js';
import { CanvasDrawer } from './renderer/CanvasDrawer.js';
import { RuleEngine } from './game/RuleEngine.js';
import { resolveCombat } from './game/CombatResolver.js';

// 1. 初始化各模块
const appState = new AppState();
let activeMatchConfig = null;
const LAST_MATCH_KEY = 'treeGrow:lastMatch:v1';
let game = new GameState();
const mapManager = new MapManager(1800, 1200);
let mapAreas = [];
const drawer = new CanvasDrawer('gameCanvas');
let ruleEngine = new RuleEngine(mapManager);

// 2. 游戏阶段与状态变量
let gamePhase = 'selectRed';
let redBaseId = null;
let blueBaseId = null;
let selectedNodeId = null;
let legalAreaIds = new Set();

let dyingNodes = [];
let isAnimating = false;
let isPaused = false;
let combatTimeoutId = null;

// --- AI 相关变量 ---
let isAIMode = false;       
let isAIThinking = false;   
let aiWorker = null;
let aiRequestId = 0;         

// 3. 获取 UI 控件
const turnIndicator = document.getElementById('turnIndicator');
const gameHint = document.getElementById('game-hint');
const stageCaption = document.getElementById('stage-caption-text');
const endTurnBtn = document.getElementById('endTurn');
const saveBtn = document.getElementById('saveBtn');
const loadBtn = document.getElementById('loadBtn');
const pauseBtn = document.getElementById('pauseBtn');
const restartBtn = document.getElementById('restartBtn');
const menuBtn = document.getElementById('menuBtn');
const redNodeCount = document.getElementById('red-node-count');
const blueNodeCount = document.getElementById('blue-node-count');
const modeIndicator = document.getElementById('mode-indicator');
const zoomOutBtn = document.getElementById('zoom-out-btn');
const zoomInBtn = document.getElementById('zoom-in-btn');
const fitMapBtn = document.getElementById('fit-map-btn');
const zoomLevel = document.getElementById('zoom-level');
const modeSelect = document.getElementById('mode-select');
const difficultySelect = document.getElementById('difficulty-select');
const difficultyGroup = document.getElementById('difficulty-group');
const startGameBtn = document.getElementById('start-game-btn');
const menuScreen = document.getElementById('menu-screen');
const setupScreen = document.getElementById('setup-screen');
const gameScreen = document.getElementById('game-screen');
const newGameBtn = document.getElementById('new-game-btn');
const continueGameBtn = document.getElementById('continue-game-btn');
const loadMenuBtn = document.getElementById('load-menu-btn');
const backToMenuBtn = document.getElementById('back-to-menu-btn');
const rulesMenuBtn = document.getElementById('rules-menu-btn');
const rulesPanel = document.getElementById('rules-panel');
const closeRulesBtn = document.getElementById('close-rules-btn');

// --- AI Worker 初始化 ---
function failAITurn(message) {
    console.error('AI 对战不可继续:', message);
    invalidateAIRequest();
    game.isGameOver = true;
    updateUI();
    renderGame();
    alert('AI 对战发生错误，已停止本局游戏。请重新开始或切换双人模式。');
}

if (window.Worker) {
    try {
        aiWorker = new Worker(new URL('./ai/AIWorker.js', import.meta.url), { type: 'module' });
    } catch (error) {
        console.error('AI Worker 初始化失败:', error);
        aiWorker = null;
    }
}

if (aiWorker) {
    aiWorker.onerror = function(e) {
        e.preventDefault();
        failAITurn(e.message || 'Worker 加载或运行失败');
    };

    // 接收 AI 动作并复核后接入主战场逻辑
    aiWorker.onmessage = function(e) {
        if (!e.data || e.data.requestId !== aiRequestId) {
            console.log('【AI 响应丢弃】请求已失效:', e.data?.requestId);
            return;
        }
        // 1. 优先判断 AI 有没有抛出致命报错
        if (e.data.error) {
            console.error('❌ 收到 AI 内部报错:', e.data.error);
            failAITurn(e.data.error);
            return;
        }

        console.log('【AI 追踪 4】主线程收到了 Worker 的返回值:', e.data);
        const { parentNodeId, targetAreaId } = e.data;
        isAIThinking = false;

        // Null/Null is the only valid representation of "no legal move".
        if (parentNodeId === null && targetAreaId === null) {
            console.log('【AI 判定】当前无合法落子点，自动跳过回合。');
            performSkipTurn();
            return;
        }
        if (!Number.isSafeInteger(parentNodeId) || parentNodeId < 1 ||
            !Number.isSafeInteger(targetAreaId) || targetAreaId < 1) {
            failAITurn('AI 返回了格式无效的落子结果');
            return;
        }

        const parentNode = game.getNode(parentNodeId);
        const targetArea = mapAreas.find(area => area.id === targetAreaId);
        if (!parentNode || !targetArea) {
            failAITurn('AI 返回的父节点或目标区域已不存在');
            return;
        }

        const validation = ruleEngine.canGrow(game, parentNode, targetAreaId, {
            ownBaseId: blueBaseId,
            enemyBaseId: redBaseId
        });
        if (!validation.allowed) {
            failAITurn(`AI 落子未通过主线程规则复核：${validation.reason}`);
            return;
        }

        const [x, y] = targetArea.center;
        const newNode = game.addNode(parentNodeId, x, y, targetAreaId, 'blue');
        if (!newNode) {
            failAITurn('AI 落子通过规则复核，但节点创建失败');
            return;
        }

        console.log(`【AI执行】父节点 ${parentNodeId} -> 新节点 ${newNode.id} (区域 ${targetAreaId})`);
        selectedNodeId = null;
        processSuccessfulGrowth(newNode, 'blue');
    };
} else {
    console.warn('浏览器不支持 Web Worker，AI 模式无法运行。');
}

const pveOption = modeSelect.querySelector('option[value="pve"]');
if (!aiWorker && pveOption) {
    pveOption.disabled = true;
    difficultyGroup.style.display = 'none';
}

// --- 【核心提取】通用成长后处理函数（人类和 AI 共用） ---
function processSuccessfulGrowth(newNode, owner) {
    selectedNodeId = null;

    // Entering the enemy base wins immediately; no combat resolution is needed.
    const enemyBaseId = owner === 'red' ? blueBaseId : redBaseId;
    if (newNode.areaId === enemyBaseId) {
        const winner = owner === 'red' ? '🔴 红方' : '🔵 蓝方';
        alert(`${winner} 成功突入敌方基地！取得最终胜利！`);
        game.isGameOver = true;
        updateUI();
        renderGame();
        return;
    }

    // Combat is triggered only when the new node occupies an enemy node's area.
    const rivalNode = game.getAliveNodes().find(node =>
        node.id !== newNode.id &&
        node.owner !== owner &&
        node.areaId === newNode.areaId
    );

    if (!rivalNode) {
        performTurnSwitch();
        return;
    }

    const combat = resolveCombat(game, newNode, rivalNode);
    const nodesToDelete = [...new Set(combat.nodesToDelete)];
    const freezeTargetId = combat.freezeTargetId;
    console.log(`-> 战斗结算：摧毁 ${nodesToDelete.length} 个节点${freezeTargetId ? `，冻结节点 ${freezeTargetId}` : ''}`);

    if (nodesToDelete.length === 0) {
        if (freezeTargetId) {
            const targetNode = game.getNode(freezeTargetId);
            if (targetNode) targetNode.isFrozen = true;
        }
        performTurnSwitch();
        return;
    }

    isAnimating = true;
    dyingNodes = nodesToDelete.map(id => game.getNode(id)).filter(Boolean);
    renderGame();

    combatTimeoutId = setTimeout(() => {
        combatTimeoutId = null;
        game.deleteNodes(nodesToDelete);
        dyingNodes = [];

        if (freezeTargetId) {
            const targetNode = game.getNode(freezeTargetId);
            if (targetNode) {
                targetNode.isFrozen = true;
                console.log(`【冻结执行】节点 ${targetNode.id} (区域 ${targetNode.areaId}) 的分支被摧毁。`);
            }
        }

        isAnimating = false;

        const redRoots = game.getPlayerRootNodes('red');
        const blueRoots = game.getPlayerRootNodes('blue');
        if (redRoots.length === 0) {
            alert('🔴 红方所有根节点被摧毁！🔵 蓝方胜利！');
            game.isGameOver = true;
        } else if (blueRoots.length === 0) {
            alert('🔵 蓝方所有根节点被摧毁！🔴 红方胜利！');
            game.isGameOver = true;
        } else {
            performTurnSwitch();
        }
        updateUI();
        renderGame();
    }, 500);
}

// --- 切换回合（包含 AI 触发） ---
function performTurnSwitch() {
    if (game.isGameOver || gamePhase !== 'playing' || isAnimating) return;

    // 以 GameState.currentTurn 为唯一权威来源，避免调用方传错属主。
    // 这里清理的是刚结束行动的玩家；防守方被冻结节点仍保留到其行动结束。
    const endingOwner = game.currentTurn;
    const aliveOwnNodes = game.getAliveNodesByOwner(endingOwner);
    let unfrozenCount = 0;
    for (const node of aliveOwnNodes) {
        if (node.isFrozen) {
            node.isFrozen = false;
            unfrozenCount++;
        }
    }
    if (unfrozenCount > 0) {
        console.log(`【解冻】${endingOwner} 完成行动，解除 ${unfrozenCount} 个冻结节点。`);
    }

    game.switchTurn();
    selectedNodeId = null;
    updateUI();
    renderGame();

    if (isAIMode && game.currentTurn === 'blue' && !game.isGameOver && !isAIThinking) {
        triggerAITurn();
    }
}

// --- 主动跳过回合（针对玩家或 AI 无棋可走） ---
function performSkipTurn() {
    // Skipping is a turn completion, not a separate state transition.
    // Reuse the authoritative cleanup/switch/AI path so frozen nodes and
    // AI scheduling cannot diverge from a normal completed action.
    performTurnSwitch();
}

function invalidateAIRequest() {
    aiRequestId++;
    isAIThinking = false;
}

// --- 触发 AI 运算 ---
function triggerAITurn() {
    console.log('【AI 追踪 1】检测到 AI 回合，准备发送消息给 Worker');
    if (isPaused || !isAIMode || game.currentTurn !== 'blue' || isAIThinking || game.isGameOver) return;
    if (!aiWorker) {
        failAITurn('当前环境不支持 AI Worker');
        return;
    }
    isAIThinking = true;
    updateUI();

    const gameStateData = game.toJSON();

    // 【核心改动】把地图拓扑结构和区域中心直接传过去！
    const adjacency = ruleEngine.adjacency;
    const areaCenters = mapAreas.map(area => area.center);

    const requestId = ++aiRequestId;
    try {
        aiWorker.postMessage({
            requestId,
            gameStateData: gameStateData,
            adjacency: adjacency,
            areaCenters: areaCenters,
            difficulty: difficultySelect.value,
            playerSide: 'blue',
            redBaseId: redBaseId,
            blueBaseId: blueBaseId
        });
    } catch (error) {
        failAITurn(error?.message || '无法向 AI Worker 发送请求');
    }
}

// 界面更新函数
function updateUI() {
    if (pauseBtn) { pauseBtn.textContent = isPaused ? '继续' : '暂停'; pauseBtn.disabled = gamePhase !== 'playing' || game.isGameOver || isAnimating || isAIThinking; }
    if (restartBtn) restartBtn.disabled = isAnimating || isAIThinking;
    if (menuBtn) menuBtn.disabled = isAnimating || isAIThinking;
    if (redNodeCount) redNodeCount.textContent = String(game.getAliveNodesByOwner('red').length);
    if (blueNodeCount) blueNodeCount.textContent = String(game.getAliveNodesByOwner('blue').length);
    if (modeIndicator) modeIndicator.textContent = isAIMode ? `人机 · ${difficultySelect.value === 'easy' ? '简单' : difficultySelect.value === 'hard' ? '困难' : '普通'}` : '双人对战';
    if (isPaused) { turnIndicator.textContent = '对局已暂停'; endTurnBtn.disabled = true; }
    else if (gamePhase === 'selectRed') {
        turnIndicator.innerHTML = '🔴 <strong>红方玩家</strong>，请点击地图上的区域作为你的基地！';
        endTurnBtn.disabled = true;
    } else if (gamePhase === 'selectBlue') {
        turnIndicator.innerHTML = '🔵 <strong>蓝方玩家</strong>，请点击地图上的区域作为你的基地！';
        endTurnBtn.disabled = true;
    } else if (isAIThinking) {
        turnIndicator.innerHTML = '🤖 <strong>AI 对手</strong> 正在思考...';
        endTurnBtn.disabled = true;
    } else {
        const playerLabel = game.currentTurn === 'red' ? '🔴 红方' : (isAIMode ? '🤖 AI 蓝方' : '🔵 蓝方');
        turnIndicator.innerHTML = `当前回合：${playerLabel}`;
        endTurnBtn.textContent = '⏭️ 跳过回合';
        endTurnBtn.disabled = game.isGameOver;
    }

    if (stageCaption && gameHint) {
        if (isPaused) {
            stageCaption.textContent = '已暂停';
            gameHint.textContent = '对局已暂停。点击“继续”恢复操作。';
        } else if (game.isGameOver) {
            stageCaption.textContent = '对局结束';
            gameHint.textContent = '本局已结束。';
        } else if (gamePhase === 'selectRed') {
            stageCaption.textContent = '基地部署';
            gameHint.textContent = '点击地图区域，为红方选择基地。';
        } else if (gamePhase === 'selectBlue') {
            stageCaption.textContent = '基地部署';
            gameHint.textContent = isAIMode ? 'AI 正在选择蓝方基地…' : '点击地图区域，为蓝方选择基地。';
        } else {
            stageCaption.textContent = '对局进行中';
            gameHint.textContent = isAIThinking ? 'AI 对手正在思考…' : '选择己方可生长节点，查看合法目标区域。';
        }
    }
}


function generateRootNodesInArea(areaId, owner, count = 3) {
    const area = mapAreas.find(a => a.id === areaId);
    if (!area) return [];
    const center = area.center;
    const nodes = [];
    let attempts = 0;
    while (nodes.length < count && attempts < 1000) {
        attempts++;
        const dx = (Math.random() - 0.5) * 80;
        const dy = (Math.random() - 0.5) * 80;
        const px = center[0] + dx;
        const py = center[1] + dy;
        if (mapManager.getAreaAtPoint(px, py) === areaId) {
            let tooClose = false;
            for (let n of nodes) { const dist = Math.hypot(n.x - px, n.y - py); if (dist < 15) { tooClose = true; break; } }
            if (!tooClose) {
                const node = game.addNode(null, px, py, areaId, owner);
                if (node) nodes.push(node);
            }
        }
    }
    // If random placement failed, scan deterministic offsets but still verify
    // point-location. Never create a node whose coordinates belong to another cell.
    for (let radius = 2; nodes.length < count && radius <= 40; radius += 2) {
        for (let angle = 0; angle < 360 && nodes.length < count; angle += 15) {
            const radians = angle * Math.PI / 180;
            const px = center[0] + Math.cos(radians) * radius;
            const py = center[1] + Math.sin(radians) * radius;
            if (mapManager.getAreaAtPoint(px, py) !== areaId) continue;
            if (nodes.some(n => Math.hypot(n.x - px, n.y - py) < 15)) continue;
            const node = game.addNode(null, px, py, areaId, owner);
            if (node) nodes.push(node);
        }
    }
    console.log(`【开局】在区域 ${areaId} 为 ${owner} 生成了 ${nodes.length} 个根节点`);
    return nodes;
}

drawer.renderMap(mapAreas);
drawer.renderNodes(game.getAliveNodes(), selectedNodeId);
updateUI();
showAppScreen('menu');

// 存读档逻辑
function getGameBlob() {
    if (isAnimating || isAIThinking) {
        alert('当前战斗动画或 AI 运算尚未结束，请稍后再保存。');
        return null;
    }
    if (gamePhase !== 'playing') {
        alert('请先完成双方基地选择并正式开始游戏，再进行保存。');
        return null;
    }
    const data = {
        schemaVersion: 1,
        gameState: game.toJSON(),
        mapSeeds: mapManager.seeds,
        redBaseId: redBaseId,
        blueBaseId: blueBaseId,
        gamePhase: gamePhase,
        isAIMode: isAIMode,
        difficulty: activeMatchConfig?.difficulty || difficultySelect.value
    };
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

async function saveGame() {
    const blob = getGameBlob();
    if (!blob) return;

    try {
        // 方案一：使用现代浏览器 API 弹出系统原生“另存为”对话框
        if ('showSaveFilePicker' in window) {
            const handle = await window.showSaveFilePicker({
                suggestedName: 'growth_tree_save.sav',
                types: [{
                    description: '生长树存档文件',
                    accept: { 'application/json': ['.sav'] }
                }]
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            alert(`✅ 存档已成功保存到：${handle.name}`);
        } else {
            // 方案二：浏览器不支持系统弹窗时的兜底下载方案
            fallbackDownload(blob);
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('保存出错：', err);
            fallbackDownload(blob);
        }
    }
}

// 兜底下载方案
function fallbackDownload(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'growth_tree_save.sav';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    alert('💾 游戏已以 .sav 文件下载，请在浏览器下载文件夹中查找。');
}

async function loadGame() {
    try {
        let file;
        if ('showOpenFilePicker' in window) {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: '生长树存档文件', accept: { 'application/json': ['.sav', '.json'] } }],
                multiple: false
            });
            file = await handle.getFile();
        } else {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.sav,.json';
            const filePromise = new Promise(resolve => {
                input.addEventListener('change', event => resolve(event.target.files?.[0] ?? null), { once: true });
                input.addEventListener('cancel', () => resolve(null), { once: true });
            });
            input.click();
            file = await filePromise;
            if (!file) return;
        }
        applyLoadedGameData(JSON.parse(await file.text()), file.name);
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('读档出错：', err);
            alert('❌ 读取存档失败，请检查文件或控制台报错。');
        }
    }
}

function applyLoadedGameData(data, sourceName = '存档') {
        // 先在临时对象中完整验证存档，失败时不触碰当前游戏。
        if (!Array.isArray(data.mapSeeds) || data.mapSeeds.length !== 50 ||
            !data.mapSeeds.every(seed => Array.isArray(seed) && seed.length === 2 &&
                Number.isFinite(seed[0]) && Number.isFinite(seed[1])) ||
            !['selectBlue', 'playing'].includes(data.gamePhase) ||
            !Number.isInteger(data.redBaseId) || data.redBaseId < 1 ||
            (data.gamePhase === 'playing' &&
                (!Number.isInteger(data.blueBaseId) || data.blueBaseId < 1)) ||
            (data.gamePhase === 'selectBlue' && data.blueBaseId !== null)) {
            throw new TypeError('存档地图或阶段字段无效');
        }

        const restoredGame = GameState.fromJSON(data.gameState);
        // Rebuild on a temporary manager so a bad save cannot mutate the active map.
        const restoredMapManager = new MapManager(1800, 1200);
        const restoredMapAreas = restoredMapManager.loadMapFromSeeds(data.mapSeeds);
        const areaIds = new Set(restoredMapAreas.map(area => area.id));
        if (!areaIds.has(data.redBaseId) ||
            (data.blueBaseId !== null && (!areaIds.has(data.blueBaseId) || data.blueBaseId === data.redBaseId)) ||
            restoredGame.nodes.some(node => !areaIds.has(node.areaId))) {
            throw new TypeError('存档节点或基地引用了不存在的区域');
        }

        invalidateAIRequest();
        if (combatTimeoutId !== null) {
            clearTimeout(combatTimeoutId);
            combatTimeoutId = null;
        }
        isAnimating = false;
        isPaused = false;
        dyingNodes = [];
        mapManager.areas = restoredMapManager.areas;
        mapManager.voronoi = restoredMapManager.voronoi;
        mapManager.delaunay = restoredMapManager.delaunay;
        mapManager.seeds = restoredMapManager.seeds;
        mapManager.adjacency = restoredMapManager.adjacency;
        mapManager.portals = restoredMapManager.portals;
        mapManager.shortEdges = restoredMapManager.shortEdges;
        mapAreas = restoredMapAreas;
        game = restoredGame;

        // Restore the match mode and difficulty saved with the game.
        // Older saves do not contain these fields; retain the current UI choice for compatibility.
        if (typeof data.isAIMode === 'boolean') {
            isAIMode = data.isAIMode;
            modeSelect.value = isAIMode ? 'pve' : 'pvp';
        }
        if (['easy', 'medium', 'hard'].includes(data.difficulty)) {
            difficultySelect.value = data.difficulty;
        }
        difficultyGroup.hidden = !isAIMode;

        // 恢复变量
        redBaseId = data.redBaseId;
        blueBaseId = data.blueBaseId;
        gamePhase = data.gamePhase;
        selectedNodeId = null;
        legalAreaIds = new Set();

        // 重建规则引擎
        ruleEngine = new RuleEngine(mapManager);

        activeMatchConfig = Object.freeze({ mode: isAIMode ? 'pve' : 'pvp', difficulty: difficultySelect.value, playerSide: 'red' });
        appState.startMatch(activeMatchConfig);
        renderGame();
        updateUI();
        showAppScreen('game');
        if (isAIMode && gamePhase === 'playing' && game.currentTurn === 'blue' && !game.isGameOver) {
            triggerAITurn();
        }
        console.log('【读档成功】已恢复之前进度！');
        if (sourceName !== '最近一次对局') alert(`✅ 读档成功！读取到文件：${sourceName}`);
}

saveBtn.addEventListener('click', saveGame);
loadBtn.addEventListener('click', loadGame);
modeSelect.addEventListener('change', () => {
    difficultyGroup.hidden = modeSelect.value !== 'pve';
});

function showAppScreen(screen) {
    appState.navigate(screen);
    menuScreen.hidden = screen !== 'menu';
    setupScreen.hidden = screen !== 'setup';
    gameScreen.hidden = screen !== 'game';
    document.body.dataset.screen = screen;
    if (screen === 'game') requestAnimationFrame(() => fitGameCanvas());
    if (screen === 'menu') updateMenuUI();
}

function hasRecoverableMatch() {
    try {
        const data = JSON.parse(localStorage.getItem(LAST_MATCH_KEY) || 'null');
        return !!data && Array.isArray(data.mapSeeds) &&
            ['selectBlue', 'playing'].includes(data.gamePhase) && Number.isInteger(data.redBaseId);
    } catch { return false; }
}

function updateMenuUI() {
    continueGameBtn.disabled = !hasRecoverableMatch();
}

function persistLastMatch() {
    if (game.isGameOver || !['selectBlue', 'playing'].includes(gamePhase) || !redBaseId) return;
    if (isAIMode && gamePhase === 'selectBlue' && blueBaseId === null) return;
    if (isAnimating || isAIThinking) return;
    try {
        localStorage.setItem(LAST_MATCH_KEY, JSON.stringify({
            schemaVersion: 1, gameState: game.toJSON(), mapSeeds: mapManager.seeds,
            redBaseId, blueBaseId, gamePhase, isAIMode,
            difficulty: activeMatchConfig?.difficulty || difficultySelect.value
        }));
    } catch (error) { console.warn('最近对局自动保存失败：', error); }
}

function beginNewMatch() {
    const config = Object.freeze({
        mode: modeSelect.value === 'pve' ? 'pve' : 'pvp',
        difficulty: difficultySelect.value,
        playerSide: 'red'
    });
    activeMatchConfig = config;
    appState.startMatch(config);
    isAIMode = config.mode === 'pve';
    invalidateAIRequest();
    if (combatTimeoutId !== null) {
        clearTimeout(combatTimeoutId);
        combatTimeoutId = null;
    }

    // 重置整个游戏到开局状态
    game = new GameState();
    mapAreas = mapManager.generateMap(50);
    ruleEngine = new RuleEngine(mapManager);
    
    gamePhase = 'selectRed';
    redBaseId = null;
    blueBaseId = null;
    selectedNodeId = null;
    legalAreaIds = new Set();
    dyingNodes = [];
    isAnimating = false;
    isAIThinking = false;
    isPaused = false;
    
    // 重新渲染地图
    drawer.renderMap(mapAreas);
    drawer.renderNodes(game.getAliveNodes(), selectedNodeId);
    updateUI();
    showAppScreen('game');
    console.log('【新游戏】已重置，等待红方选择基地。');
}

newGameBtn.addEventListener('click', () => {
    rulesPanel.hidden = true;
    modeSelect.value = 'pvp';
    difficultySelect.value = 'medium';
    difficultyGroup.hidden = true;
    appState.openSetup();
    showAppScreen('setup');
});
backToMenuBtn.addEventListener('click', () => showAppScreen('menu'));
rulesMenuBtn.addEventListener('click', () => { rulesPanel.hidden = !rulesPanel.hidden; });
closeRulesBtn.addEventListener('click', () => { rulesPanel.hidden = true; });
continueGameBtn.addEventListener('click', () => {
    try {
        const data = JSON.parse(localStorage.getItem(LAST_MATCH_KEY) || 'null');
        if (!data) throw new Error('没有可继续的对局');
        applyLoadedGameData(data, '最近一次对局');
    } catch (error) {
        console.error('恢复最近对局失败：', error);
        alert('无法恢复最近一次对局，请重新开始或读取存档。');
        updateMenuUI();
    }
});
loadMenuBtn.addEventListener('click', loadGame);
startGameBtn.addEventListener('click', beginNewMatch);

// ==========================================
// 画布点击事件
// ==========================================
document.getElementById('gameCanvas').addEventListener('click', (e) => {
    if (isPaused || isAnimating || isAIThinking) return; 
    const rect = e.target.getBoundingClientRect();
    const scaleX = e.target.width / rect.width;
    const scaleY = e.target.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const clickedAreaId = mapManager.getAreaAtPoint(x, y);
    if (clickedAreaId === null) return;

    // ... 基地选址代码保持不变 ...
    if (gamePhase === 'selectRed') {
        redBaseId = clickedAreaId;
        gamePhase = 'selectBlue';
        drawer.renderMap(mapAreas, redBaseId, null); 
        drawer.renderNodes(game.getAliveNodes(), selectedNodeId);
        updateUI();
        persistLastMatch();

        // 如果开启了人机模式，蓝方基地自动由 AI 选址
        if (isAIMode) {
            // ==========================================
            // 【优化】利用 BFS 图论算法，强制 AI 与玩家基地保持距离
            // ==========================================
            const MIN_DISTANCE = 4; // 至少相隔 4 条黑线（跨越 3 个区域），避免贴脸
            
            // 1. 找出所有符合距离条件的候选区域
            let candidateAreas = mapAreas.filter(area => {
                if (area.id === redBaseId) return false; // 不能是红方基地
                
                // 调用已有的 ruleEngine 计算图论最短路径
                const path = ruleEngine.getAreaPath(redBaseId, area.id);
                if (!path) return false; // 如果被“阻断红线”隔绝或不可达，直接排除
                
                const distance = path.length - 1; // 计算跨越的黑线数量
                return distance >= MIN_DISTANCE;
            });

            let selectedArea;
            // 2. 如果有符合条件的距离足够远的区域，从中随机选一个
            if (candidateAreas.length > 0) {
                selectedArea = candidateAreas[Math.floor(Math.random() * candidateAreas.length)];
            } else {
                // 3. 兜底逻辑：如果地图被红线阻断得极其厉害，找不到这么远的区域，
                // 强行选择距离红方基地“最远”的那块区域
                let maxDist = -1;
                for (const area of mapAreas) {
                    if (area.id === redBaseId) continue;
                    const path = ruleEngine.getAreaPath(redBaseId, area.id);
                    if (path && path.length - 1 > maxDist) {
                        maxDist = path.length - 1;
                        selectedArea = area;
                    }
                }
            }
            
            if (!selectedArea) {
                // 即使地图拓扑不连通，也允许 AI 从任意非红方基地的区域开局。
                selectedArea = mapAreas.find(area => area.id !== redBaseId);
            }
            if (!selectedArea) {
                gamePhase = 'selectRed';
                blueBaseId = null;
                updateUI();
                alert('无法为 AI 选择基地，请重新开始游戏。');
                return;
            }

            setTimeout(() => {
                blueBaseId = selectedArea.id;
                // 直接进入开局
                gamePhase = 'playing';
                generateRootNodesInArea(redBaseId, 'red', 3);
                generateRootNodesInArea(blueBaseId, 'blue', 3);
                selectedNodeId = null;
                drawer.renderMap(mapAreas, redBaseId, blueBaseId);
                drawer.renderNodes(game.getAliveNodes(), selectedNodeId);
                updateUI();
                persistLastMatch();
                // 如果玩家是红方，AI 是蓝方，轮到玩家先手。
            }, 600); // 模拟 AI 思考 0.6 秒
        }
        return;
    }
    if (gamePhase === 'selectBlue') {
        // 双人模式走原有的逻辑
        if (clickedAreaId === redBaseId) { alert('这块地盘已经被红方占领了！'); return; }
        blueBaseId = clickedAreaId;
        gamePhase = 'playing';
        generateRootNodesInArea(redBaseId, 'red', 3);
        generateRootNodesInArea(blueBaseId, 'blue', 3);
        selectedNodeId = null;
        drawer.renderMap(mapAreas, redBaseId, blueBaseId);
        drawer.renderNodes(game.getAliveNodes(), selectedNodeId);
        updateUI();
        persistLastMatch();
        return;
    }

    if (game.isGameOver) return;
    const aliveNodes = game.getAliveNodes();
    let clickedNode = null;
    for (let i = aliveNodes.length - 1; i >= 0; i--) {
        const node = aliveNodes[i];
        const dx = node.x - x;
        const dy = node.y - y;
        if ((dx * dx + dy * dy) <= 256) { clickedNode = node; break; }
    }

    // A highlighted enemy-occupied area is a valid attack destination.
    // Clicking the enemy node itself must therefore fall through to target-area handling.
    if (clickedNode && clickedNode.owner !== game.currentTurn &&
        selectedNodeId !== null && legalAreaIds.has(clickedNode.areaId)) {
        clickedNode = null;
    }

    if (clickedNode) {
        // 1. 所有拦截判断：利用卫语句提前阻断非法操作

        // 1.1 如果是对方的节点，直接拦截
        if (clickedNode.owner !== game.currentTurn) {
            alert('这是对手的节点！');
            selectedNodeId = null;
            renderGame();
            return;
        }

        // 1.2 如果是处于冻结状态的节点，直接拦截
        if (clickedNode.isFrozen) {
            alert('规则限制：该节点因分支刚被摧毁，本回合处于休整状态，无法生长！');
            selectedNodeId = null;
            renderGame();
            return;
        }

        // 1.3 如果是已有子节点的根节点，直接拦截
        if (clickedNode.isRoot && clickedNode.childrenIds.length > 0) {
            alert('规则限制：根节点不能作为分叉点再次生长。');
            selectedNodeId = null;
            renderGame();
            return;
        }

        // 2. 核心选中逻辑：通过所有拦截后，执行选中
        selectedNodeId = clickedNode.id;
        console.log(`已选中父节点 ID: ${selectedNodeId}`);
        renderGame();
        return;
    }

    if (selectedNodeId === null) {
        alert('请先点击一个属于你且不是根节点的节点作为生长的起点！');
        return;
    }

    const parentNode = aliveNodes.find(n => n.id === selectedNodeId);
    if (!parentNode || parentNode.owner !== game.currentTurn) { selectedNodeId = null; renderGame(); return; }

    const currentBaseId = game.currentTurn === 'red' ? redBaseId : blueBaseId;
    const enemyBaseId = game.currentTurn === 'red' ? blueBaseId : redBaseId;
    const result = ruleEngine.canGrow(game, parentNode, clickedAreaId, { ownBaseId: currentBaseId, enemyBaseId });
    if (!result.allowed) { alert(`非法生长！原因：${result.reason}`); return; }

    // 除了己方基地，一个区域只能容纳一个节点
    // 1. 绝对禁止向己方基地区域生长（防止绕回老巢）
    if (clickedAreaId === currentBaseId) {
        alert('规则限制：禁止向己方基地区域生长！');
        return;
    }

    // 2. 普通区域和敌方基地的节点碰撞限制
    // 敌方基地必须是特例，因为它要用来触发“突入获胜”的胜利条件。
    // 如果不是敌方基地，且区域内已经有存活节点，则禁止堆叠生长。
    if (clickedAreaId !== enemyBaseId) {
        // 必须只查找己方节点，敌方节点不禁止，用来触发进攻！
        const hasOwnNodeInArea = game.getAliveNodesByOwner(game.currentTurn).some(n => n.areaId === clickedAreaId);
        if (hasOwnNodeInArea) {
            alert('规则限制：除基地外，己方在一个区域内只能拥有一个据点！');
            return; // 阻止生长
        }
    }

    // 第三步：执行生长
    const newNode = game.addNode(parentNode.id, x, y, clickedAreaId, game.currentTurn);
    if (newNode) {
        console.log(`【生长成功】父节点 ID: ${parentNode.id}，新节点 ID: ${newNode.id}，位于区域 ${clickedAreaId}`);
        processSuccessfulGrowth(newNode, game.currentTurn);
    }
});

pauseBtn.addEventListener('click', () => {
    if (gamePhase !== 'playing' || game.isGameOver || isAnimating || isAIThinking) return;
    isPaused = !isPaused; selectedNodeId = null; updateUI(); renderGame();
});
restartBtn.addEventListener('click', () => {
    if (isAnimating || isAIThinking || !confirm('重新开始将结束当前对局并生成新地图，是否继续？')) return;
    beginNewMatch();
});
menuBtn.addEventListener('click', () => {
    if (isAnimating || isAIThinking || !confirm('返回主菜单？当前对局会自动保存，可从主菜单继续。')) return;
    isPaused = false; selectedNodeId = null; showAppScreen('menu');
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !gameScreen.hidden && pauseBtn && !pauseBtn.disabled) pauseBtn.click();
});

endTurnBtn.addEventListener('click', () => {
    if (isPaused || game.isGameOver || gamePhase !== 'playing' || isAnimating || isAIThinking) return;
    selectedNodeId = null;
    // 所有跳过回合入口统一处理解冻、切换回合及 AI 触发。
    performSkipTurn();
});

function refreshLegalAreaHighlights() {
    legalAreaIds = new Set();

    // The preview is for the human player's current action only. In PVE,
    // never expose the AI's legal destinations while it is thinking or acting.
    if (gamePhase !== 'playing' || game.isGameOver || isAnimating || isAIThinking ||
        (isAIMode && game.currentTurn === 'blue') || selectedNodeId === null) {
        return;
    }

    const parentNode = game.getNode(selectedNodeId);
    if (!parentNode || parentNode.isDestroyed || parentNode.owner !== game.currentTurn) {
        return;
    }

    const ownBaseId = game.currentTurn === 'red' ? redBaseId : blueBaseId;
    const enemyBaseId = game.currentTurn === 'red' ? blueBaseId : redBaseId;
    const areaIds = mapAreas.map(area => area.id);
    legalAreaIds = new Set(ruleEngine.getLegalGrowthAreas(
        game,
        parentNode,
        areaIds,
        { ownBaseId, enemyBaseId }
    ));
}

function renderGame() {
    refreshLegalAreaHighlights();
    // 将地图拓扑与合法目标区域交给绘制层；规则仍由 RuleEngine 独占。
    drawer.renderMap(
        mapAreas,
        redBaseId,
        blueBaseId,
        mapManager.shortEdges || [],
        legalAreaIds
    );
    drawer.renderNodes(game.getAliveNodes(), selectedNodeId, dyingNodes, mapManager.portals);
    persistLastMatch();
}
// Expose a lightweight startup diagnostic after the game module and UI event
// handlers have initialized. The desktop smoke test uses this without touching
// gameplay state or requiring a test-only code path.
const canvasContainer = document.getElementById('canvas-container');
function updateZoomUI() {
    if (zoomLevel) zoomLevel.textContent = `${Math.round(drawer.zoom * 100)}%`;
    if (zoomOutBtn) zoomOutBtn.disabled = drawer.zoom <= 0.5;
    if (zoomInBtn) zoomInBtn.disabled = drawer.zoom >= 2;
}
function fitGameCanvas() {
    if (!canvasContainer || gameScreen.hidden) return;
    drawer.fitToContainer(canvasContainer);
    updateZoomUI();
}
zoomOutBtn.addEventListener('click', () => { drawer.setZoom(drawer.zoom - 0.1); updateZoomUI(); });
zoomInBtn.addEventListener('click', () => { drawer.setZoom(drawer.zoom + 0.1); updateZoomUI(); });
fitMapBtn.addEventListener('click', () => { drawer.setZoom(1); fitGameCanvas(); });
if ('ResizeObserver' in window && canvasContainer) {
    const canvasResizeObserver = new ResizeObserver(() => {
        fitGameCanvas();
        if (!gameScreen.hidden && mapAreas.length) renderGame();
    });
    canvasResizeObserver.observe(canvasContainer);
} else {
    window.addEventListener('resize', () => { fitGameCanvas(); if (!gameScreen.hidden && mapAreas.length) renderGame(); });
}
document.documentElement.dataset.treeGrowAppReady = 'true';
document.documentElement.dataset.treeGrowAiWorkerAvailable = String(!!aiWorker);
