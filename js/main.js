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

// 3. 获取 UI 控件
const turnIndicator = document.getElementById('turnIndicator');
const endTurnBtn = document.getElementById('endTurn');
// 【新增】存档按钮
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

// ==========================================
// 【替换】存档与读档逻辑（支持保存为 .sav 单文件）
// ==========================================

// 数据打包生成 Blob
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

// 核心：保存游戏
async function saveGame() {
    const blob = getGameBlob();
    if (!blob) return;

    try {
        // 方案一：使用现代浏览器 API (File System Access API)，弹出系统原生“另存为”对话框
        // 这种操作可以让用户自由选择电脑上的任意文件夹保存
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
            // 方案二：如果不支持标准API，回退为“触发浏览器下载”
            // (注意：此方案会默认保存到浏览器的“下载”文件夹，无法直接选路径)
            fallbackDownload(blob);
        }
    } catch (err) {
        // 如果用户点了“取消”关闭弹窗，会触发 AbortError，我们不做报错处理即可
        if (err.name !== 'AbortError') {
            console.error('保存出错：', err);
            // 出错时尝试用兜底方案
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

// 核心：读档
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
            if (!file) return; // 用户取消选择
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
// ==========================================

document.getElementById('gameCanvas').addEventListener('click', (e) => {
    const rect = e.target.getBoundingClientRect();
    const scaleX = e.target.width / rect.width;
    const scaleY = e.target.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const clickedAreaId = mapManager.getAreaAtPoint(x, y);
    if (clickedAreaId === null) return;

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
                // ==========================================================
                // 【关键修改】将单纯的连锁摧毁改为“堡垒防御 + 连锁摧毁”分支
                // ==========================================================
                const degree = rivalNode.getDegree();
                
                if (degree > 3) {
                    // 堡垒 > 3 条的免疫节点：绝对防御
                    console.log(`-> 触发【免疫堡垒自动防御】ID ${rivalNode.id} (连接数 ${degree})，入侵被反噬。`);
                    nodesToDelete.push(newNode.id); // 仅抹除入侵者自身
                } else {
                    // 正常情况：触发【连锁摧毁】向上回溯
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
                let rootDestroyed = false;
                for (let id of nodesToDelete) {
                    let n = game.getNode(id);
                    if (n && n.isRoot) { rootDestroyed = true; break; }
                }
                game.deleteNodes(nodesToDelete);
                console.log(`【战斗结果】已摧毁 ${nodesToDelete.length} 个节点。包含根节点: ${rootDestroyed}`);
                renderGame();

                const redRoots = game.getPlayerRootNodes('red');
                const blueRoots = game.getPlayerRootNodes('blue');
                if (redRoots.length === 0) { alert('🔴 红方所有根节点被摧毁！🔵 蓝方胜利！'); game.isGameOver = true; updateUI(); }
                else if (blueRoots.length === 0) { alert('🔵 蓝方所有根节点被摧毁！🔴 红方胜利！'); game.isGameOver = true; updateUI(); }
            }
        }

        renderGame();
        if (!game.isGameOver) {
            game.switchTurn();
            updateUI();
            renderGame();
        }
    }
});

endTurnBtn.addEventListener('click', () => {
    if (game.isGameOver || gamePhase !== 'playing') return;
    selectedNodeId = null;
    game.switchTurn();
    updateUI();
    renderGame();
});

function renderGame() {
    drawer.renderMap(mapAreas, redBaseId, blueBaseId);
    drawer.renderNodes(game.getAliveNodes(), selectedNodeId);
}