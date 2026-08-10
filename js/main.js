// js/main.js
import { GameState } from './game/GameState.js';
import { MapManager } from './core/MapManager.js';
import { CanvasDrawer } from './renderer/CanvasDrawer.js';
import { RuleEngine } from './game/RuleEngine.js';

// 1. 初始化各模块
let game = new GameState();
const mapManager = new MapManager(1800, 1200);
let mapAreas = mapManager.generateMap(50);
const drawer = new CanvasDrawer('gameCanvas');
let ruleEngine = new RuleEngine(mapManager);

// 2. 游戏阶段与状态变量
let gamePhase = 'selectRed';
let redBaseId = null;
let blueBaseId = null;
let selectedNodeId = null;

let dyingNodes = [];
let isAnimating = false;

// --- AI 相关变量 ---
let isAIMode = false;       
let isAIThinking = false;   
let aiWorker = null;        

// 3. 获取 UI 控件
const turnIndicator = document.getElementById('turnIndicator');
const endTurnBtn = document.getElementById('endTurn');
const saveBtn = document.getElementById('saveBtn');
const loadBtn = document.getElementById('loadBtn');
const modeSelect = document.getElementById('mode-select');
const difficultySelect = document.getElementById('difficulty-select');
const difficultyGroup = document.getElementById('difficulty-group');
const startGameBtn = document.getElementById('start-game-btn');

// --- AI Worker 初始化 ---
if (window.Worker) {
    aiWorker = new Worker('js/ai/AIWorker.js', { type: 'module' });
    
    // 【第四阶段核心】接收 AI 动作，接入主战场逻辑
    aiWorker.onmessage = function(e) {
        // 1. 优先判断 AI 有没有抛出致命报错
        if (e.data.error) {
            console.error('❌ 收到 AI 内部报错:', e.data.error);
            isAIThinking = false;
            updateUI();
            // 如果 AI 出错，只能自动让它跳过回合
            performSkipTurn();
            return;
        }

        console.log('【AI 追踪 4】主线程收到了 Worker 的返回值:', e.data);
        const { parentNodeId, targetAreaId } = e.data;
        isAIThinking = false;

        // 1. 如果 AI 有合法的动作，执行生长
        if (parentNodeId && targetAreaId) {
            const parentNode = game.getNode(parentNodeId);
            const targetArea = mapAreas.find(a => a.id === targetAreaId);
            if (parentNode && targetArea) {
                const [x, y] = targetArea.center;
                const newNode = game.addNode(parentNodeId, x, y, targetAreaId, 'blue');
                
                // 【关键复用】AI 落子后，调用通用的成长处理函数
                if (newNode) {
                    console.log(`【AI执行】父节点 ${parentNodeId} -> 新节点 ${newNode.id} (区域 ${targetAreaId})`);
                    selectedNodeId = null;
                    // 立刻复用人类点击成功后的完整流程（战斗、冻结、重置）
                    processSuccessfulGrowth(newNode, 'blue');
                    return;
                }
            }
        } 
        
        // 2. 如果 AI 返回 Null（没有棋可走），自动执行“跳过回合”
        console.log('【AI 判定】当前无合法落子点，自动跳过回合。');
        performSkipTurn();
    };
} else {
    console.warn('浏览器不支持 Web Worker，AI 模式无法运行。');
}

// --- 【核心提取】通用成长后处理函数（人类和 AI 共用） ---
function processSuccessfulGrowth(newNode, owner) {
    selectedNodeId = null; 

    // A. 检查突入敌方基地获胜
    const enemyBaseId = owner === 'red' ? blueBaseId : redBaseId;
    if (newNode.areaId === enemyBaseId) {
        const winner = owner === 'red' ? '🔴 红方' : '🔵 蓝方';
        alert(`${winner} 成功突入敌方基地！取得最终胜利！`);
        game.isGameOver = true;
        updateUI();
        renderGame();
        return;
    }

    // B. 检查战斗触发
    const currentAlive = game.getAliveNodes();
    const rivalNode = currentAlive.find(n => 
        n.id !== newNode.id && 
        n.owner !== newNode.owner && 
        n.areaId === newNode.areaId
    );

    if (rivalNode) {
        let nodesToDelete = [];
        let freezeTargetId = null;
        console.log(`【战斗触发】玩家 ${newNode.owner} 进入了 ${rivalNode.owner} 的区域`);

        let stopNode = null;
        let cursor = rivalNode;
        while (cursor) {
            if (cursor.childrenIds.length >= 2) { stopNode = cursor; break; }
            if (!cursor.parentId) break;
            cursor = game.getNode(cursor.parentId);
        }

        if (rivalNode.childrenIds.length >= 2 && rivalNode.getDegree() <= 3) {
            console.log(`-> 触发【直接摧毁分支点】ID ${rivalNode.id}`);
            let queue = [rivalNode.id];
            while (queue.length > 0) {
                let cId = queue.shift();
                nodesToDelete.push(cId);
                let cNode = game.getNode(cId);
                if (cNode) { for (let childId of cNode.childrenIds) queue.push(childId); }
            }
        } else if (rivalNode.getDegree() > 3) {
            console.log(`-> 触发【免疫堡垒自动防御】ID ${rivalNode.id} 绝对安全。`);
            nodesToDelete.push(newNode.id);
        } else {
            console.log(`-> 触发【连锁摧毁】向上回溯`);
            let pathIds = [];
            let delCursor = rivalNode;
            while (delCursor) {
                if (stopNode && delCursor.id === stopNode.id) break;
                pathIds.push(delCursor.id);
                if (!delCursor.parentId) break;
                delCursor = game.getNode(delCursor.parentId);
            }
            let queue = [...pathIds];
            while (queue.length > 0) {
                let cId = queue.shift();
                nodesToDelete.push(cId);
                let cNode = game.getNode(cId);
                if (cNode) { for (let childId of cNode.childrenIds) queue.push(childId); }
            }
            if (stopNode && !nodesToDelete.includes(stopNode.id) && !stopNode.isRoot) {
                freezeTargetId = stopNode.id;
                console.log(`-> 即将冻结起始分支点 ID: ${freezeTargetId}`);
            }
        }

        // C. 执行战斗动画与清理
        if (nodesToDelete.length > 0) {
            nodesToDelete = [...new Set(nodesToDelete)];
            isAnimating = true;
            dyingNodes = nodesToDelete.map(id => game.getNode(id)).filter(Boolean);
            renderGame();

            setTimeout(() => {
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
                renderGame();

                // D. 胜负判定与回合接力
                const redRoots = game.getPlayerRootNodes('red');
                const blueRoots = game.getPlayerRootNodes('blue');
                if (redRoots.length === 0) {
                    alert('🔴 红方所有根节点被摧毁！🔵 蓝方胜利！'); game.isGameOver = true;
                } else if (blueRoots.length === 0) {
                    alert('🔵 蓝方所有根节点被摧毁！🔴 红方胜利！'); game.isGameOver = true;
                } else {
                    performTurnSwitch(newNode.owner);
                }
                updateUI();
                renderGame();
            }, 500);
            return;
        }
    }

    // E. 无战斗：直接切换回合
    performTurnSwitch(owner);
}

// --- 切换回合（包含 AI 触发） ---
function performTurnSwitch(currentOwner) {
    console.log(`【AI 排查诊断】performTurnSwitch 已被调用。当前 isAIMode 值: ${isAIMode}, 回合属主: ${game.currentTurn}`);
    // 先清理当前玩家的冻结（解冻）
    const aliveOwnNodes = game.getAliveNodesByOwner(currentOwner);
    for (const node of aliveOwnNodes) {
        if (node.isFrozen) node.isFrozen = false;
    }

    if (game.isGameOver) return;

    game.switchTurn(); // 切换回合
    updateUI();
    renderGame();

    // 【AI 触发】如果现在是 AI 的回合，且不是游戏结束状态
    if (isAIMode && game.currentTurn === 'blue' && !game.isGameOver && !isAIThinking) {
        triggerAITurn();
    }
}

// --- 主动跳过回合（针对玩家或 AI 无棋可走） ---
function performSkipTurn() {
    if (game.isGameOver || gamePhase !== 'playing' || isAnimating) return;
    const currentOwner = game.currentTurn;

    // 清理冻结
    const aliveOwnNodes = game.getAliveNodesByOwner(currentOwner);
    for (const node of aliveOwnNodes) { if (node.isFrozen) node.isFrozen = false; }

    game.switchTurn();
    updateUI();
    renderGame();

    if (isAIMode && game.currentTurn === 'blue' && !game.isGameOver && !isAIThinking) {
        triggerAITurn();
    }
}

// --- 触发 AI 运算 ---
function triggerAITurn() {
    console.log('【AI 追踪 1】检测到 AI 回合，准备发送消息给 Worker');
    if (!isAIMode || game.currentTurn !== 'blue' || isAIThinking || game.isGameOver) return;
    isAIThinking = true;
    updateUI();

    const gameStateData = {
        nodes: game.nodes,
        currentTurn: game.currentTurn,
        nodeIdCounter: game.nodeIdCounter
    };

    // 【核心改动】把地图拓扑结构和区域中心直接传过去！
    const adjacency = ruleEngine.adjacency;
    const areaCenters = mapAreas.map(area => area.center);

    aiWorker.postMessage({
        gameStateData: gameStateData,
        adjacency: adjacency,
        areaCenters: areaCenters,
        difficulty: difficultySelect.value,
        playerSide: 'blue',
        redBaseId: redBaseId,
        blueBaseId: blueBaseId
    });
}

// 界面更新函数
function updateUI() {
    if (gamePhase === 'selectRed') {
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
    while (nodes.length < count) {
        const dx = (Math.random() - 0.5) * 40;
        const dy = (Math.random() - 0.5) * 40;
        const px = center[0] + dx;
        const py = center[1] + dy;
        const node = game.addNode(null, px, py, areaId, owner);
        if (node) nodes.push(node);
    }
    console.log(`【开局】在区域 ${areaId} 为 ${owner} 生成了 ${nodes.length} 个根节点`);
    return nodes;
}

drawer.renderMap(mapAreas);
drawer.renderNodes(game.getAliveNodes(), selectedNodeId);
updateUI();

// 存读档逻辑
function getGameBlob() {
    if (gamePhase === 'selectRed') {
        alert('游戏还没正式开局（未选好基地），无法保存！');
        return null;
    }
    const data = {
        gameState: game.toJSON(),
        mapSeeds: mapManager.seeds,
        redBaseId: redBaseId,
        blueBaseId: blueBaseId,
        gamePhase: gamePhase
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
        // 方案一：调用系统原生的“打开文件”选择框
        if ('showOpenFilePicker' in window) {
            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: '生长树存档文件',
                    accept: { 'application/json': ['.sav', '.json'] }
                }],
                multiple: false
            });
            file = await handle.getFile();
        } else {
            // 方案二：兼容不支持 API 的浏览器，通过隐藏的 input 元素选取文件
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.sav,.json';
            const filePromise = new Promise((resolve) => {
                input.onchange = (e) => resolve(e.target.files[0]);
            });
            input.click();
            file = await filePromise;
            if (!file) return;
        }

        const text = await file.text();
        const data = JSON.parse(text);

        // 验证存档完整性
        if (!data.mapSeeds || !data.gameState) {
            alert('❌ 存档文件格式错误，无法读取！');
            return;
        }

        // 1. 恢复地图
        mapAreas = mapManager.loadMapFromSeeds(data.mapSeeds);
        
        // 2. 恢复游戏状态
        game = GameState.fromJSON(data.gameState);
        
        // 3. 恢复变量
        redBaseId = data.redBaseId;
        blueBaseId = data.blueBaseId;
        gamePhase = data.gamePhase;
        selectedNodeId = null;

        // 4. 重建规则引擎
        ruleEngine = new RuleEngine(mapManager);

        // 5. 重新渲染并更新UI
        renderGame();
        updateUI();
        console.log('【读档成功】已恢复之前进度！');
        alert(`✅ 读档成功！读取到文件：${file.name}`);
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('读档出错：', err);
            alert('❌ 读取存档失败，请检查文件或控制台报错。');
        }
    }
}

saveBtn.addEventListener('click', saveGame);
loadBtn.addEventListener('click', loadGame);
// 1. 监听模式切换
modeSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    isAIMode = (val === 'pve'); // true 为 PVE，false 为 PVP
    // 切换模式时，显示或隐藏难度选择框
    difficultyGroup.style.display = isAIMode ? 'flex' : 'none';
    // 并重置 UI 状态，防止上一次游戏遗留信息
    turnIndicator.innerHTML = '准备开局';
    endTurnBtn.disabled = true;
});

// 2. 监听“开始游戏”按钮
startGameBtn.addEventListener('click', () => {
    // 重置整个游戏到开局状态
    game = new GameState();
    mapAreas = mapManager.generateMap(50);
    ruleEngine = new RuleEngine(mapManager);
    
    gamePhase = 'selectRed';
    redBaseId = null;
    blueBaseId = null;
    selectedNodeId = null;
    dyingNodes = [];
    isAnimating = false;
    isAIThinking = false;
    
    // 重新渲染地图
    drawer.renderMap(mapAreas);
    drawer.renderNodes(game.getAliveNodes(), selectedNodeId);
    updateUI();
    console.log('【新游戏】已重置，等待红方选择基地。');
    difficultyGroup.style.display = isAIMode ? 'flex' : 'none';
});

// ==========================================
// 画布点击事件
// ==========================================
document.getElementById('gameCanvas').addEventListener('click', (e) => {
    // 增加 AI 思考打断
    if (isAnimating || isAIThinking) return; 
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

    const result = ruleEngine.canGrow(game, parentNode, clickedAreaId);
    if (!result.allowed) { alert(`非法生长！原因：${result.reason}`); return; }

    // 除了己方基地，一个区域只能容纳一个节点
    const currentBaseId = game.currentTurn === 'red' ? redBaseId : blueBaseId;
    const enemyBaseId = game.currentTurn === 'red' ? blueBaseId : redBaseId;

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
        selectedNodeId = null; 

        const enemyBaseId = newNode.owner === 'red' ? blueBaseId : redBaseId;
        if (newNode.areaId === enemyBaseId) {
            const winner = newNode.owner === 'red' ? '🔴 红方' : '🔵 蓝方';
            alert(`${winner} 成功突入敌方基地！取得最终胜利！`);
            game.isGameOver = true;
            updateUI();
            renderGame();
            return;
        }

        const currentAlive = game.getAliveNodes();
        const rivalNode = currentAlive.find(n => 
            n.id !== newNode.id && 
            n.owner !== newNode.owner && 
            n.areaId === newNode.areaId
        );

        // ==========================================
        // 战斗摧毁模块的重构
        // ==========================================
        if (rivalNode) {
            let nodesToDelete = [];
            let freezeTargetId = null; // 【关键修改】用于存储需要冻结的分支点ID
            console.log(`【战斗触发】玩家 ${newNode.owner} 进入了 ${rivalNode.owner} 的区域`);

            // --- 分支决策部分 ---
            let stopNode = null; // 记录回溯停止的位置
            let cursor = rivalNode;
            while (cursor) {
                if (cursor.childrenIds.length >= 2) { stopNode = cursor; break; }
                if (!cursor.parentId) break;
                cursor = game.getNode(cursor.parentId);
            }

            // 判定1：是否触发“直接摧毁分支点（≤3条连接）”
            if (rivalNode.childrenIds.length >= 2 && rivalNode.getDegree() <= 3) {
                console.log(`-> 触发【直接摧毁分支点】ID ${rivalNode.id}`);
                let queue = [rivalNode.id];
                while (queue.length > 0) {
                    let cId = queue.shift();
                    nodesToDelete.push(cId);
                    let cNode = game.getNode(cId);
                    if (cNode) { for (let childId of cNode.childrenIds) queue.push(childId); }
                }
            } 
            // 判定2：是否触发“免疫堡垒（>3条连接）”
            else if (rivalNode.getDegree() > 3) {
                console.log(`-> 触发【免疫堡垒自动防御】ID ${rivalNode.id} 绝对安全。`);
                nodesToDelete.push(newNode.id);
            } 
            // 判定3：普通连锁摧毁（向上回溯到分支点）
            else {
                console.log(`-> 触发【连锁摧毁】向上回溯`);
                // 收集从被攻击节点到 stopNode 之间的路径（不包含 stopNode 本身）
                let pathIds = [];
                let delCursor = rivalNode;
                while (delCursor) {
                    if (stopNode && delCursor.id === stopNode.id) break;
                    pathIds.push(delCursor.id);
                    if (!delCursor.parentId) break;
                    delCursor = game.getNode(delCursor.parentId);
                }
                // 收集这些路径及其下属全部子节点
                let queue = [...pathIds];
                while (queue.length > 0) {
                    let cId = queue.shift();
                    nodesToDelete.push(cId);
                    let cNode = game.getNode(cId);
                    if (cNode) { for (let childId of cNode.childrenIds) queue.push(childId); }
                }

                // 【核心修复】：确认需要冻结的起始点
                // 只有当分支点（stopNode）存在，且它没有被列入这次的摧毁名单时，才冻结它
                if (stopNode && !nodesToDelete.includes(stopNode.id)) {
                    // 如果分支点不是根节点，则记录它的ID
                    if (!stopNode.isRoot) {
                        freezeTargetId = stopNode.id;
                        console.log(`-> 即将冻结起始分支点 ID: ${freezeTargetId}`);
                    }
                }
            }

            // --- 执行动画与清理 ---
            if (nodesToDelete.length > 0) {
                nodesToDelete = [...new Set(nodesToDelete)];
                isAnimating = true;
                dyingNodes = nodesToDelete.map(id => game.getNode(id)).filter(Boolean);
                renderGame(); // 显示红色闪烁特效

                setTimeout(() => {
                    // 1. 执行内存清理
                    game.deleteNodes(nodesToDelete);
                    dyingNodes = [];

                    // 2. 【应用冻结】直接对记录下来的分支点进行标记
                    if (freezeTargetId) {
                        const targetNode = game.getNode(freezeTargetId);
                        if (targetNode) {
                            targetNode.isFrozen = true;
                            console.log(`【冻结执行】节点 ${targetNode.id} (区域 ${targetNode.areaId}) 的分支被摧毁，本回合被封禁。`);
                        }
                    }

                    // 3. 解除动画锁定，重绘
                    isAnimating = false;
                    renderGame();

                    // 4. 胜利判定
                    const redRoots = game.getPlayerRootNodes('red');
                    const blueRoots = game.getPlayerRootNodes('blue');
                    if (redRoots.length === 0) {
                        alert('🔴 红方所有根节点被摧毁！🔵 蓝方胜利！');
                        game.isGameOver = true; updateUI(); renderGame();
                    } else if (blueRoots.length === 0) {
                        alert('🔵 蓝方所有根节点被摧毁！🔴 红方胜利！');
                        game.isGameOver = true; updateUI(); renderGame();
                    } else {
                        // 【规则修正】战斗结束后，当前攻击方完成一步，解除其冻结状态
                        const aliveOwnNodes = game.getAliveNodesByOwner(game.currentTurn);
                        for (const node of aliveOwnNodes) {
                            if (node.isFrozen) node.isFrozen = false;
                        }

                        // 【关键修复】必须调用 performTurnSwitch，否则 AI 触发逻辑会被永久跳过
                        performTurnSwitch(newNode.owner);
                    }
                }, 500); // 500ms 动画持续时长
                return; // 跳出事件监听
            }
        }

        // 如果没有发生战斗，正常渲染和切换回合
        renderGame();
        if (!game.isGameOver) {
            // 【规则修正】防守方完成了一步，回合结束前解除当前玩家所有冻结
            const aliveOwnNodes = game.getAliveNodesByOwner(game.currentTurn);
            for (const node of aliveOwnNodes) {
                if (node.isFrozen) node.isFrozen = false;
            }

            performTurnSwitch(game.currentTurn);
        }
    }
});

endTurnBtn.addEventListener('click', () => {
    if (game.isGameOver || gamePhase !== 'playing' || isAnimating) return;
    
    // 清空当前玩家所有节点的冻结状态
    const aliveOwnNodes = game.getAliveNodesByOwner(game.currentTurn);
    let unfrozenCount = 0;
    for (const node of aliveOwnNodes) {
        if (node.isFrozen) {
            node.isFrozen = false;
            unfrozenCount++;
        }
    }
    if (unfrozenCount > 0) {
        console.log(`【解冻】当前玩家 ${game.currentTurn} 跳过回合，${unfrozenCount} 个被冻结的节点已解除休整。`);
    }

    selectedNodeId = null;
    game.switchTurn();
    updateUI();
    renderGame();

    // ==========================================
    // 【核心修复】追加 AI 触发检测
    // ==========================================
    // 如果当前开启 AI 模式，且刚切换到的回合是 AI（蓝方），则直接触发 AI 思考
    if (isAIMode && game.currentTurn === 'blue' && !game.isGameOver && !isAIThinking) {
        triggerAITurn();
    }
});

function renderGame() {
    // 将 mapManager.shortEdges 传递给 CanvasDrawer
    drawer.renderMap(mapAreas, redBaseId, blueBaseId, mapManager.shortEdges || []);
    drawer.renderNodes(game.getAliveNodes(), selectedNodeId, dyingNodes);
}