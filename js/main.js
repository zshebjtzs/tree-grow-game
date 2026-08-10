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
let gamePhase = 'selectRed'; // 'selectRed' | 'selectBlue' | 'playing'
let redBaseId = null;
let blueBaseId = null;
let selectedNodeId = null;

// 【新增】战斗动画状态变量
let dyingNodes = [];
let isAnimating = false;

const turnIndicator = document.getElementById('turnIndicator');
const endTurnBtn = document.getElementById('endTurn');
const saveBtn = document.getElementById('saveBtn');
const loadBtn = document.getElementById('loadBtn');

function updateUI() {
    if (gamePhase === 'selectRed') {
        turnIndicator.innerHTML = '🔴 <strong>红方玩家</strong>，请点击地图上的任意一个区域作为你的基地！';
        endTurnBtn.disabled = true;
    } else if (gamePhase === 'selectBlue') {
        turnIndicator.innerHTML = '🔵 <strong>蓝方玩家</strong>，请点击地图上的一个<strong>不同</strong>区域作为你的基地！';
        endTurnBtn.disabled = true;
    } else {
        turnIndicator.innerHTML = `当前回合：${game.currentTurn === 'red' ? '🔴 红方' : '🔵 蓝方'}`;
        endTurnBtn.textContent = '⏭️ 跳过回合';
        endTurnBtn.disabled = game.isGameOver || isAnimating;
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

// 存读档逻辑略去，保持与之前一致（因篇幅省略）
function getGameBlob() { /* 保持原代码 */ }
async function saveGame() { /* 保持原代码 */ }
async function loadGame() { /* 保持原代码 */ }

saveBtn.addEventListener('click', saveGame);
loadBtn.addEventListener('click', loadGame);

// ==========================================
// 画布点击事件
// ==========================================
document.getElementById('gameCanvas').addEventListener('click', (e) => {
    // 【新增】如果在播放战斗动画，禁止点击操作
    if (isAnimating) return;

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
        return;
    }
    if (gamePhase === 'selectBlue') {
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
        if (clickedNode.owner === game.currentTurn) {
            if (clickedNode.isRoot && clickedNode.childrenIds.length > 0) {
                alert('规则限制：根节点不能作为分叉点再次生长。');
                selectedNodeId = null;
            } else {
                selectedNodeId = clickedNode.id;
                console.log(`已选中父节点 ID: ${selectedNodeId}`);
            }
        } else {
            alert('这是对手的节点！');
            selectedNodeId = null;
        }
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
        const hasNodeInArea = game.getAliveNodes().some(n => n.areaId === clickedAreaId);
        if (hasNodeInArea) {
            alert('规则限制：除基地外，每个区域最多只能容纳一个节点！');
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
            console.log(`【战斗触发】玩家 ${newNode.owner} 进入了 ${rivalNode.owner} 的区域`);

            if (rivalNode.childrenIds.length >= 2 && rivalNode.getDegree() <= 3) {
                console.log(`-> 触发【直接摧毁分支点】ID ${rivalNode.id}`);
                let queue = [rivalNode.id];
                while (queue.length > 0) {
                    let cId = queue.shift();
                    nodesToDelete.push(cId);
                    let cNode = game.getNode(cId);
                    if (cNode) { for (let childId of cNode.childrenIds) queue.push(childId); }
                }
            } else {
                const degree = rivalNode.getDegree();
                if (degree > 3) {
                    console.log(`-> 触发【免疫堡垒自动防御】ID ${rivalNode.id} (连接数 ${degree}) 绝对安全。`);
                    nodesToDelete.push(newNode.id);
                } else {
                    console.log(`-> 触发【连锁摧毁】向上回溯`);
                    let cursor = rivalNode;
                    let stopNode = null;
                    while (cursor) {
                        if (cursor.childrenIds.length >= 2) { stopNode = cursor; break; }
                        if (!cursor.parentId) break;
                        cursor = game.getNode(cursor.parentId);
                    }
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
                }
            }

            if (nodesToDelete.length > 0) {
                nodesToDelete = [...new Set(nodesToDelete)];
                
                // 【核心改动】开启战斗动画，延迟执行删除
                isAnimating = true;
                dyingNodes = nodesToDelete.map(id => game.getNode(id)).filter(Boolean);
                renderGame(); // 立刻将节点变成闪烁红色

                setTimeout(() => {
                    // 执行最终的内存清理
                    game.deleteNodes(nodesToDelete);
                    dyingNodes = [];
                    isAnimating = false;
                    
                    // 重新渲染去除死亡残留
                    renderGame();

                    // 判定胜利条件
                    const redRoots = game.getPlayerRootNodes('red');
                    const blueRoots = game.getPlayerRootNodes('blue');
                    if (redRoots.length === 0) {
                        alert('🔴 红方所有根节点被摧毁！🔵 蓝方胜利！');
                        game.isGameOver = true;
                        updateUI();
                        renderGame();
                    } else if (blueRoots.length === 0) {
                        alert('🔵 蓝方所有根节点被摧毁！🔴 红方胜利！');
                        game.isGameOver = true;
                        updateUI();
                        renderGame();
                    } else {
                        // 若未结束，切换给对手
                        game.switchTurn();
                        updateUI();
                        renderGame();
                    }
                }, 500); // 500ms 动画持续时长

                // 由于开启了动画，跳出当前事件监听，防止立即切换回合
                return; 
            }
        }

        // 如果没有发生战斗，正常渲染和切换回合
        renderGame();
        if (!game.isGameOver) {
            game.switchTurn();
            updateUI();
            renderGame();
        }
    }
});

endTurnBtn.addEventListener('click', () => {
    if (game.isGameOver || gamePhase !== 'playing' || isAnimating) return;
    selectedNodeId = null;
    game.switchTurn();
    updateUI();
    renderGame();
});

function renderGame() {
    // 【修改点】将 dyingNodes 传递给渲染器
    drawer.renderMap(mapAreas, redBaseId, blueBaseId);
    drawer.renderNodes(game.getAliveNodes(), selectedNodeId, dyingNodes);
}