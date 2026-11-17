// js/main.js
import { GameState } from './game/GameState.js';
import { AppState } from './app/AppState.js';
import { MapManager } from './core/MapManager.js';
import { CanvasDrawer } from './renderer/CanvasDrawer.js';
import { RuleEngine } from './game/RuleEngine.js';
import { executeGrowthAction } from './game/GrowthActionService.js';
import { resolveCombat } from './game/CombatResolver.js';
import { PresentationController } from './presentation/PresentationController.js';
import { createCombatEvent } from './presentation/CombatEvent.js';
import { AudioController } from './presentation/AudioController.js';
import { MatchTracker } from './game/MatchTracker.js';
import { MatchHistory } from './game/MatchHistory.js';
import { UndoManager } from './game/UndoManager.js';
import { createRematchConfig } from './app/RematchConfig.js';
import { getAISide } from './app/MatchSides.js';
import { getDifficultyLabel, DIFFICULTY_LEVELS } from './ai/DifficultyProfiles.js';
import { TutorialController } from './tutorial/TutorialController.js';
import { ReplaySession } from './replay/ReplaySession.js';
import { ReplayController } from './replay/ReplayController.js';
import { ReplaySaveValidator } from './replay/ReplaySaveValidator.js';
import { formatReplayAction, formatReplayEvent } from './replay/ReplayFormatter.js';

// 1. 初始化各模块
const appState = new AppState();
let activeMatchConfig = null;
let matchTracker = null;
let matchHistory = null;
let undoManager = null;
let lastMatchResult = null;
const LAST_MATCH_KEY = 'treeGrow:lastMatch:v1';
let game = new GameState();
const mapManager = new MapManager(1800, 1200);
let mapAreas = [];
const drawer = new CanvasDrawer('gameCanvas');
const replayDrawer = new CanvasDrawer('replayCanvas');
let replaySession = null;
let replayController = null;
let replayMapManager = null;
let replayMapAreas = [];
let replayMetadata = null;
let presentation;
let hoverAreaId = null;
let feedbackTimeoutId = null;
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
let aiProgress = null;
let aiTargetAreaId = null;
let aiWorker = null;
let aiRequestId = 0;         

// 3. 获取 UI 控件
const turnIndicator = document.getElementById('turnIndicator');
const gameHint = document.getElementById('game-hint');
const stageCaption = document.getElementById('stage-caption-text');
const endTurnBtn = document.getElementById('endTurn');
const undoRedBtn = document.getElementById('undo-red-btn');
const undoBlueBtn = document.getElementById('undo-blue-btn');
const undoPlayerBtn = document.getElementById('undo-player-btn');
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
const viewportModeBtn = document.getElementById('viewport-mode-btn');
const resetViewportBtn = document.getElementById('reset-viewport-btn');
const modeSelect = document.getElementById('mode-select');
const difficultySelect = document.getElementById('difficulty-select');
const difficultyGroup = document.getElementById('difficulty-group');
const playerSideSelect = document.getElementById('player-side-select');
const playerSideGroup = document.getElementById('player-side-group');
const startGameBtn = document.getElementById('start-game-btn');
const menuScreen = document.getElementById('menu-screen');
const setupScreen = document.getElementById('setup-screen');
const gameScreen = document.getElementById('game-screen');
const fullscreenTip = document.getElementById('fullscreen-tip');
function syncFullscreenTip() {
    if (!fullscreenTip) return;
    // F11 browser fullscreen usually resizes the page viewport without
    // triggering the Fullscreen API's fullscreenchange event.
    const viewportFillsScreen = window.screen
        && window.innerHeight >= window.screen.height - 80
        && window.innerWidth >= window.screen.width - 40;
    fullscreenTip.hidden = Boolean(document.fullscreenElement) || Boolean(viewportFillsScreen);
}
window.addEventListener('resize', syncFullscreenTip, { passive: true });
document.addEventListener('fullscreenchange', syncFullscreenTip);
syncFullscreenTip();
const resultScreen = document.getElementById('result-screen');
const replayScreen = document.getElementById('replay-screen');
const replayMenuBtn = document.getElementById('replay-menu-btn');
const replayMenuBtnTop = document.getElementById('replay-menu-btn-top');
const replayImportBtn = document.getElementById('replay-import-btn');
const replayEmptyImportBtn = document.getElementById('replay-empty-import-btn');
const replayFileInput = document.getElementById('replay-file-input');
const replayFileName = document.getElementById('replay-file-name');
const replayEmpty = document.getElementById('replay-empty');
const replayContent = document.getElementById('replay-content');
const replayError = document.getElementById('replay-error');
const replayWarning = document.getElementById('replay-warning');
const replayMetadataPanel = document.getElementById('replay-metadata');
const replayActionCount = document.getElementById('replay-action-count');
const replayActionList = document.getElementById('replay-action-list');
const replayPositionTitle = document.getElementById('replay-position-title');
const replayPositionMeta = document.getElementById('replay-position-meta');
const replayDetailStep = document.getElementById('replay-detail-step');
const replayActionDetail = document.getElementById('replay-action-detail');
const replayCurrentStep = document.getElementById('replay-current-step');
const replayTotalSteps = document.getElementById('replay-total-steps');
const replayProgress = document.getElementById('replay-progress');
const replayFirstBtn = document.getElementById('replay-first-btn');
const replayPrevBtn = document.getElementById('replay-prev-btn');
const replayPlayBtn = document.getElementById('replay-play-btn');
const replayNextBtn = document.getElementById('replay-next-btn');
const replayLastBtn = document.getElementById('replay-last-btn');
const replaySpeedSelect = document.getElementById('replay-speed-select');
const resultTitle = document.getElementById('result-title');
const resultSubtitle = document.getElementById('result-subtitle');
const resultMeta = document.getElementById('result-meta');
const resultOverview = document.getElementById('result-overview');
const resultStrategy = document.getElementById('result-strategy');
const resultCombat = document.getElementById('result-combat');
const resultEvents = document.getElementById('result-events');
const resultEventsEmpty = document.getElementById('result-events-empty');
const resultMenuBtn = document.getElementById('result-menu-btn');
const resultSaveBtn = document.getElementById('result-save-btn');
const resultUndoRedBtn = document.getElementById('result-undo-red-btn');
const resultUndoBlueBtn = document.getElementById('result-undo-blue-btn');
const resultUndoPlayerBtn = document.getElementById('result-undo-player-btn');
const resultRematchBtn = document.getElementById('result-rematch-btn');
const newGameBtn = document.getElementById('new-game-btn');
const continueGameBtn = document.getElementById('continue-game-btn');
const loadMenuBtn = document.getElementById('load-menu-btn');
const backToMenuBtn = document.getElementById('back-to-menu-btn');
const rulesMenuBtn = document.getElementById('rules-menu-btn');
const rulesPanel = document.getElementById('rules-panel');
const closeRulesBtn = document.getElementById('close-rules-btn');
const actionFeedback = document.getElementById('action-feedback');
const combatExplanation = document.getElementById('combat-explanation');
const combatExplanationTitle = document.getElementById('combat-explanation-title');
const combatExplanationDetail = document.getElementById('combat-explanation-detail');
const combatExplanationMeta = document.getElementById('combat-explanation-meta');
const aiExplanation = document.getElementById('ai-explanation');
const aiExplanationSummary = document.getElementById('ai-explanation-summary');
const aiExplanationDetails = document.getElementById('ai-explanation-details');
const aiExplanationStats = document.getElementById('ai-explanation-stats');

presentation = new PresentationController({ render: () => renderGame() });
const audio = new AudioController();
const audioMuteBtn = document.getElementById('audio-mute-btn');
const audioVolume = document.getElementById('audio-volume');
function syncAudioControls() {
    if (audioMuteBtn) {
        audioMuteBtn.textContent = audio.muted ? '音效：关' : '音效：开';
        audioMuteBtn.setAttribute('aria-pressed', String(audio.muted));
    }
    if (audioVolume) audioVolume.value = String(audio.volume);
}
document.addEventListener('pointerdown', () => { audio.unlock(); }, { capture: true, passive: true });
document.addEventListener('keydown', event => {
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) audio.unlock();
}, { capture: true });
syncAudioControls();
function showFeedback(message, type = 'info', duration = 1900) {
    if (!actionFeedback) return;
    actionFeedback.textContent = message;
    actionFeedback.dataset.type = type;
    actionFeedback.hidden = false;
    if (feedbackTimeoutId !== null) window.clearTimeout(feedbackTimeoutId);
    feedbackTimeoutId = window.setTimeout(() => { actionFeedback.hidden = true; feedbackTimeoutId = null; }, duration);
}
function showCombatExplanation(event) {
    if (!combatExplanation) return;
    combatExplanationTitle.textContent = event.title;
    combatExplanationDetail.textContent = event.description;
    combatExplanationMeta.textContent = event.meta;
    combatExplanation.hidden = false;
}
function clearCombatExplanation() { if (combatExplanation) combatExplanation.hidden = true; }
function showAIExplanation(explanation) {
    if (!aiExplanation || !explanation) return;
    aiExplanationSummary.textContent = explanation.summary || '';
    aiExplanationDetails.replaceChildren();
    for (const detail of (Array.isArray(explanation.details) ? explanation.details : [])) {
        const item = document.createElement('li');
        item.textContent = String(detail);
        aiExplanationDetails.appendChild(item);
    }
    const stats = explanation.search;
    aiExplanationStats.textContent = stats
        ? `搜索完成：深度 ${stats.completedDepth} · ${stats.nodes} 个节点 · ${Number(stats.elapsedMs).toFixed(1)} ms · 置换命中 ${stats.transpositionHits}`
        : '行动由当前难度的候选评估与战术规则选出。';
    aiExplanation.hidden = false;
}
function clearAIExplanation() {
    if (aiExplanation) aiExplanation.hidden = true;
    if (aiExplanationDetails) aiExplanationDetails.replaceChildren();
}
function formatAIProgress(progress) {
    if (!progress) return '正在启动计算…';
    if (progress.phase === 'generating') return '正在生成合法候选行动…';
    if (progress.phase === 'evaluating') return `候选评估 ${progress.completedCandidates}/${progress.totalCandidates}`;
    if (progress.phase === 'tactics') return '正在检查战术威胁与防守回应…';
    if (progress.phase === 'search') {
        return `搜索深度 ${progress.completedDepth}/${progress.maxDepth} · ${progress.nodes} 节点 · ${Number(progress.elapsedMs).toFixed(0)} ms`;
    }
    if (progress.phase === 'complete') return '计算完成，准备执行行动…';
    return '正在分析当前局面…';
}
function captureHistorySnapshot() {
    return MatchHistory.capture({ gameState: game.toJSON(), matchTracker: matchTracker?.toJSON() || null, lastMatchResult });
}

function recordCompletedGrowth(owner, action, beforeSnapshot) {
    if (!matchHistory || !undoManager || !beforeSnapshot) return;
    matchHistory.recordAction({ side: owner, action, beforeSnapshot, afterSnapshot: captureHistorySnapshot() });
    undoManager.onActionCompleted(owner);
    updateUndoControls();
    persistLastMatch();
}

function undoMatchAction(side) {
    if (!undoManager?.canUndo(side, { history: matchHistory, gamePhase, isAnimating, isAIThinking, isPaused })) return false;
    const result = matchHistory.undoLatestAction(side);
    if (!result) return false;
    undoManager.consumeUndo(side);
    invalidateAIRequest();
    presentation.cancel();
    if (combatTimeoutId !== null) { clearTimeout(combatTimeoutId); combatTimeoutId = null; }
    isAnimating = false; isPaused = false; dyingNodes = []; selectedNodeId = null;
    hoverAreaId = null; aiTargetAreaId = null; legalAreaIds = new Set();
    clearCombatExplanation(); clearAIExplanation();
    game = GameState.fromJSON(result.snapshot.gameState);
    matchTracker = result.snapshot.matchTracker ? MatchTracker.fromJSON(result.snapshot.matchTracker) : null;
    lastMatchResult = result.snapshot.lastMatchResult || null;
    if (game.isGameOver || appState.screen === 'result') showAppScreen('game');
    updateUI(); renderGame();
    if (isAIMode && gamePhase === 'playing' && !game.isGameOver &&
        game.currentTurn === getAISide('pve', activeMatchConfig?.playerSide || 'red')) triggerAITurn();
    return true;
}

function finishMatch(winner, reason) {
    if (game.isGameOver) return;
    game.isGameOver = true;
    lastMatchResult = matchTracker?.finish(winner, reason, game) || null;
    try { localStorage.removeItem(LAST_MATCH_KEY); } catch (error) { console.warn('清理已结束对局恢复记录失败：', error); }
    if (lastMatchResult) { renderMatchResult(lastMatchResult); showAppScreen('result'); }
}
function formatMatchDuration(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60), remainder = seconds % 60;
    return hours ? hours + '小时 ' + minutes + '分' : minutes ? minutes + '分 ' + remainder + '秒' : remainder + '秒';
}
function formatRate(value) { return value === null || !Number.isFinite(value) ? '—' : (value * 100).toFixed(1) + '%'; }
function resultSideLabel(side, result) {
    if (result.mode === 'pve') return side === (activeMatchConfig?.playerSide || 'red')
        ? (side === 'red' ? '红方 · 玩家' : '蓝方 · 玩家')
        : (side === 'red' ? '红方 · AI' : '蓝方 · AI');
    return side === 'red' ? '红方' : '蓝方';
}
function appendResultText(parent, tag, className, value) { const el = document.createElement(tag); if (className) el.className = className; el.textContent = String(value); parent.appendChild(el); return el; }
function renderResultComparison(container, result, rows) {
    container.replaceChildren(); const head = document.createElement('div'); head.className = 'result-compare-head';
    appendResultText(head, 'span', '', '统计指标'); appendResultText(head, 'span', '', resultSideLabel('red', result)); appendResultText(head, 'span', '', resultSideLabel('blue', result)); container.appendChild(head);
    for (const [label, getter] of rows) { const row = document.createElement('div'); row.className = 'result-compare-row'; appendResultText(row, 'span', '', label); appendResultText(row, 'strong', '', getter(result.players.red, 'red', result)); appendResultText(row, 'strong', '', getter(result.players.blue, 'blue', result)); container.appendChild(row); }
}
function describeMatchEvent(event, result) {
    const side = resultSideLabel(event.side, result);
    switch (event.type) {
        case 'GROWTH': return { title: side + (event.isAttack ? ' 发起区域攻击' : ' 完成生长'), detail: '进入区域 #' + event.areaId };
        case 'COMBAT': return { title: side + ' 触发战斗 · ' + event.destroyedNodes + ' 个节点被摧毁', detail: event.outcome === 'branch-cut' ? '切断目标枝条' : event.outcome === 'branch-destroyed' ? '摧毁分叉节点及其后代' : event.outcome === 'tree-destroyed' ? '摧毁整棵防守树' : '完成战斗结算' };
        case 'FREEZE': return { title: side + ' 的节点被冻结', detail: '节点 #' + event.nodeId + ' · 由' + resultSideLabel(event.causedBy, result) + '的攻击造成' };
        case 'ROOT_DESTROYED': return { title: side + ' 根节点被摧毁', detail: '本次损失 ' + event.count + ' 个，剩余 ' + event.remaining + ' 个' };
        case 'VICTORY': return { title: side + ' 获胜', detail: event.reason === 'enemy_base_reached' ? '成功突入敌方基地' : '摧毁对方全部根节点' };
        default: return null;
    }
}
function renderMatchResult(result) {
    const winnerLabel = resultSideLabel(result.winner, result);
    resultTitle.textContent = result.mode === 'pve'
        ? (result.winner === (activeMatchConfig?.playerSide || 'red') ? '胜利' : '本局失败')
        : winnerLabel + '获胜';
    resultSubtitle.textContent = result.winReason === 'enemy_base_reached' ? '胜利条件：成功突入敌方基地' : '胜利条件：摧毁对方全部根节点';
    resultMeta.replaceChildren(); const meta = [result.mode === 'pve' ? '人机对战 · AI ' + getDifficultyLabel(result.difficulty) : '双人对战', '获胜方：' + winnerLabel];
    if (result.historyIncomplete) meta.push('部分历史数据不可用'); meta.forEach(value => appendResultText(resultMeta, 'span', '', value));
    const overview = [['对局时长', formatMatchDuration(result.durationMs)], ['总回合数', result.totalTurns], ['红方最终存活', result.players.red.survivingNodes + ' 节点 / ' + result.players.red.survivingRoots + ' 根'], ['蓝方最终存活', result.players.blue.survivingNodes + ' 节点 / ' + result.players.blue.survivingRoots + ' 根']];
    resultOverview.replaceChildren(); for (const [label, value] of overview) { const card = document.createElement('div'); card.className = 'result-overview-card'; appendResultText(card, 'small', '', label); appendResultText(card, 'strong', '', value); resultOverview.appendChild(card); }
    renderResultComparison(resultStrategy, result, [['历史最大存活节点数', p => p.maxTreeSize], ['最大分支数', p => p.maxBranching], ['最大生长深度', p => p.maxDepth], ['历史覆盖区域数', p => p.uniqueAreas.length]]);
    renderResultComparison(resultCombat, result, [['攻击次数', p => p.attackCount], ['造成摧毁的攻击次数', p => p.successfulAttackCount], ['攻击摧毁转化率', p => formatRate(p.attackConversionRate)], ['摧毁节点总数', p => p.destroyedNodes], ['单次最大摧毁规模', (p, side, r) => r.maxDestructionPerAttack[side]], ['冻结次数', p => p.freezeCount], ['根节点损失数', p => p.rootDestroyedCount]]);
    resultEvents.replaceChildren(); const important = result.events.filter(e => e.type !== 'GROWTH' || e.isAttack).slice(-5).reverse(); resultEventsEmpty.hidden = important.length > 0;
    important.forEach((event, index) => { const d = describeMatchEvent(event, result); if (!d) return; const item = document.createElement('li'); item.className = 'result-event'; appendResultText(item, 'span', 'result-event-index', String(index + 1).padStart(2, '0')); const content = document.createElement('div'); appendResultText(content, 'strong', '', d.title); appendResultText(content, 'small', '', '第 ' + event.turn + ' 回合 · ' + d.detail); item.appendChild(content); resultEvents.appendChild(item); });
}
function flashTurnIndicator() {
    if (!turnIndicator) return;
    turnIndicator.classList.remove('turn-flash');
    void turnIndicator.offsetWidth;
    turnIndicator.classList.add('turn-flash');
}
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
        if (e.data.type === 'progress') {
            if (isAIThinking) {
                aiProgress = e.data.progress || null;
                updateUI();
            }
            return;
        }
        if (e.data.type && e.data.type !== 'decision') {
            console.warn('忽略未知 AI Worker 消息类型:', e.data.type);
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
        aiProgress = null;
        updateUI();

        // Null/Null is the only valid representation of "no legal move".
        if (parentNodeId === null && targetAreaId === null) {
            showAIExplanation(e.data.explanation);
            console.log('【AI 判定】当前无合法落子点，自动跳过回合。');
            performSkipTurn();
            return;
        }
        if (!Number.isSafeInteger(parentNodeId) || parentNodeId < 1 ||
            !Number.isSafeInteger(targetAreaId) || targetAreaId < 1) {
            failAITurn('AI 返回了格式无效的落子结果');
            return;
        }

        const beforeActionSnapshot = captureHistorySnapshot();
        const growthResult = executeGrowthAction({
            gameState: game,
            ruleEngine,
            mapAreas,
            parentNodeId,
            targetAreaId,
            owner: getAISide('pve', activeMatchConfig?.playerSide || 'red'),
            ownBaseId: getAISide('pve', activeMatchConfig?.playerSide || 'red') === 'red' ? redBaseId : blueBaseId,
            enemyBaseId: getAISide('pve', activeMatchConfig?.playerSide || 'red') === 'red' ? blueBaseId : redBaseId
        });
        if (!growthResult.ok) {
            failAITurn(`AI 行动未通过统一规则验证：${growthResult.reason}`);
            return;
        }
        const newNode = growthResult.node;

        console.log(`【AI执行】父节点 ${parentNodeId} -> 新节点 ${newNode.id} (区域 ${targetAreaId})`);
        showAIExplanation(e.data.explanation);
        aiTargetAreaId = targetAreaId;
        selectedNodeId = null;
        renderGame();
        processSuccessfulGrowth(newNode, getAISide('pve', activeMatchConfig?.playerSide || 'red'), beforeActionSnapshot, growthResult.action);
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
function processSuccessfulGrowth(newNode, owner, beforeActionSnapshot, action) {
    const enemyBaseId = owner === 'red' ? blueBaseId : redBaseId;
    const isAttack = newNode.areaId !== enemyBaseId && game.getAliveNodes().some(node => node.id !== newNode.id && node.owner !== owner && node.areaId === newNode.areaId);
    matchTracker?.recordGrowth(game, newNode, { isAttack });
    audio.play('growth');
    selectedNodeId = null;
    const parentNode = newNode.parentId === null ? null : game.getNode(newNode.parentId);
    isAnimating = true;
    updateUI();

    const finishGrowth = () => {
        isAnimating = false;
        if (isAIMode && owner === getAISide('pve', activeMatchConfig?.playerSide || 'red')) {
            aiTargetAreaId = null;
            renderGame();
        }
        const enemyBaseId = owner === 'red' ? blueBaseId : redBaseId;
        if (newNode.areaId === enemyBaseId) {
            finishMatch(owner, 'enemy_base_reached');
            showFeedback(`${owner === 'red' ? '红方' : '蓝方'}成功突入敌方基地，获得胜利。`, 'success', 3600);
            audio.play('victory');
            updateUI(); renderGame();
            recordCompletedGrowth(owner, action, beforeActionSnapshot);
            return;
        }
        const rivalNode = game.getAliveNodes().find(node =>
            node.id !== newNode.id && node.owner !== owner && node.areaId === newNode.areaId
        );
        if (!rivalNode) {
            showFeedback(`生长成功：进入区域 ${newNode.areaId}。`, 'success');
            performTurnSwitch();
            recordCompletedGrowth(owner, action, beforeActionSnapshot);
            return;
        }
        const combat = resolveCombat(game, newNode, rivalNode);
        const nodesToDelete = [...new Set(combat.nodesToDelete)];
        const freezeTargetId = combat.freezeTargetId;
        const combatEvent = createCombatEvent(game, newNode, rivalNode, combat);
        matchTracker?.recordCombat(combatEvent, combat);
        showCombatExplanation(combatEvent);
        showFeedback(combatEvent.title, 'warning', 2600);
        audio.play('combat');

        const finishCombat = () => {
            game.deleteNodes(nodesToDelete);
            matchTracker?.syncAfterMutation(game);
            dyingNodes = [];
            if (nodesToDelete.length > 0) audio.play('destroy');
            if (freezeTargetId) {
                const targetNode = game.getNode(freezeTargetId);
                if (targetNode) { targetNode.isFrozen = true; audio.play('freeze'); }
            }
            isAnimating = false;
            const redRoots = game.getPlayerRootNodes('red');
            const blueRoots = game.getPlayerRootNodes('blue');
            if (redRoots.length === 0) {
                finishMatch('blue', 'all_roots_destroyed');
                showFeedback('红方全部根节点被摧毁，蓝方获胜。', 'success', 3600);
                audio.play('victory');
            } else if (blueRoots.length === 0) {
                finishMatch('red', 'all_roots_destroyed');
                showFeedback('蓝方全部根节点被摧毁，红方获胜。', 'success', 3600);
                audio.play('victory');
            } else performTurnSwitch();
            recordCompletedGrowth(owner, action, beforeActionSnapshot);
            updateUI();
            renderGame();
        };

        if (nodesToDelete.length === 0) {
            if (freezeTargetId) {
                const targetNode = game.getNode(freezeTargetId);
                if (targetNode) { targetNode.isFrozen = true; audio.play('freeze'); }
            }
            matchTracker?.syncAfterMutation(game);
            isAnimating = false;
            performTurnSwitch();
            recordCompletedGrowth(owner, action, beforeActionSnapshot);
            updateUI();
            renderGame();
            return;
        }

        isAnimating = true;
        dyingNodes = [];
        updateUI();
        presentation.playCombat({
            event: combatEvent,
            duration: Math.min(1050, 620 + nodesToDelete.length * 70),
            onComplete: finishCombat
        });
    };

    if (!parentNode) { finishGrowth(); return; }
    presentation.playGrowth({
        node: { id: newNode.id, x: newNode.x, y: newNode.y, owner: newNode.owner },
        parent: { id: parentNode.id, x: parentNode.x, y: parentNode.y },
        duration: 280,
        onComplete: finishGrowth
    });
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
    audio.play('turn');
    selectedNodeId = null;
    flashTurnIndicator();
    updateUI();
    renderGame();

    if (isAIMode && game.currentTurn === getAISide('pve', activeMatchConfig?.playerSide || 'red') && !game.isGameOver && !isAIThinking) {
        triggerAITurn();
    }
}

// --- 主动跳过回合（针对玩家或 AI 无棋可走） ---
function performSkipTurn() {
    const skippingSide = game.currentTurn;
    const beforeSkipSnapshot = matchHistory ? captureHistorySnapshot() : null;
    matchTracker?.recordSkip(skippingSide);
    // Skipping is a turn completion, not a separate state transition.
    // Reuse the authoritative cleanup/switch/AI path so frozen nodes and
    // AI scheduling cannot diverge from a normal completed action.
    performTurnSwitch();
    if (matchHistory && beforeSkipSnapshot) {
        matchHistory.recordAction({
            side: skippingSide,
            action: { type: 'skip', owner: skippingSide },
            beforeSnapshot: beforeSkipSnapshot,
            afterSnapshot: captureHistorySnapshot()
        });
        persistLastMatch();
    }
}

function invalidateAIRequest() {
    aiRequestId++;
    isAIThinking = false;
    aiProgress = null;
}

// --- 触发 AI 运算 ---
function triggerAITurn() {
    console.log('【AI 追踪 1】检测到 AI 回合，准备发送消息给 Worker');
    const aiSide = getAISide('pve', activeMatchConfig?.playerSide || 'red');
    if (isPaused || !isAIMode || game.currentTurn !== aiSide || isAIThinking || game.isGameOver) return;
    if (!aiWorker) {
        failAITurn('当前环境不支持 AI Worker');
        return;
    }
    isAIThinking = true;
    aiProgress = { phase: 'starting' };
    clearAIExplanation();
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
            playerSide: aiSide,
            redBaseId: redBaseId,
            blueBaseId: blueBaseId
        });
    } catch (error) {
        failAITurn(error?.message || '无法向 AI Worker 发送请求');
    }
}

// 界面更新函数
function updateUndoControls() {
    const controls = [
        { button: undoRedBtn, side: 'red', visible: !isAIMode },
        { button: undoBlueBtn, side: 'blue', visible: !isAIMode },
        { button: undoPlayerBtn, side: activeMatchConfig?.playerSide || 'red', visible: isAIMode },
        { button: resultUndoRedBtn, side: 'red', visible: !isAIMode && game.isGameOver },
        { button: resultUndoBlueBtn, side: 'blue', visible: !isAIMode && game.isGameOver },
        { button: resultUndoPlayerBtn, side: activeMatchConfig?.playerSide || 'red', visible: isAIMode && game.isGameOver }
    ];
    for (const { button, side, visible } of controls) {
        if (!button) continue;
        button.hidden = !visible;
        if (!visible || !undoManager) { button.disabled = true; continue; }
        const state = undoManager.getState(side);
        button.textContent = (isAIMode ? '悔棋' : `${side === 'red' ? '红方' : '蓝方'}悔棋`) + ` · 剩余 ${state.remaining}`;
        button.disabled = !undoManager.canUndo(side, { history: matchHistory, gamePhase, isAnimating, isAIThinking, isPaused });
        button.title = state.coolingDown ? '完成一次新的有效生长后才能再次悔棋' :
            state.remaining === 0 ? '本方悔棋次数已用完' : '撤销本方最近一次行动及其后的所有行动';
    }
}

function updateUI() {
    if (pauseBtn) { pauseBtn.textContent = isPaused ? '继续' : '暂停'; pauseBtn.disabled = gamePhase !== 'playing' || game.isGameOver || isAnimating || isAIThinking; }
    if (restartBtn) restartBtn.disabled = isAnimating || isAIThinking;
    if (menuBtn) menuBtn.disabled = isAnimating || isAIThinking;
    if (redNodeCount) redNodeCount.textContent = String(game.getAliveNodesByOwner('red').length);
    if (blueNodeCount) blueNodeCount.textContent = String(game.getAliveNodesByOwner('blue').length);
    if (modeIndicator) modeIndicator.textContent = isAIMode ? `人机 · ${getDifficultyLabel(difficultySelect.value)}` : '双人对战';
    if (isPaused) { turnIndicator.textContent = '对局已暂停'; endTurnBtn.disabled = true; }
    else if (gamePhase === 'selectRed') {
        turnIndicator.innerHTML = '🔴 <strong>请为红方选择基地</strong>，点击地图上的区域。';
        endTurnBtn.disabled = true;
    } else if (gamePhase === 'selectBlue') {
        turnIndicator.innerHTML = '🔵 <strong>请为蓝方选择基地</strong>，点击地图上的区域。';
        endTurnBtn.disabled = true;
    } else if (isAIThinking) {
        turnIndicator.innerHTML = `🤖 <strong>AI 对手</strong> 正在思考…<small class="ai-progress-detail">${formatAIProgress(aiProgress)}</small>`;
        endTurnBtn.disabled = true;
    } else {
        const aiSide = isAIMode ? getAISide('pve', activeMatchConfig?.playerSide || 'red') : null;
        const currentLabel = game.currentTurn === 'red' ? '🔴 红方' : '🔵 蓝方';
        const playerLabel = isAIMode
            ? (game.currentTurn === aiSide
                ? `🤖 AI ${game.currentTurn === 'red' ? '红方' : '蓝方'}`
                : `玩家 ${currentLabel}`)
            : currentLabel;
        turnIndicator.innerHTML = `当前回合：${playerLabel}`;
        endTurnBtn.textContent = '⏭️ 跳过回合';
        endTurnBtn.disabled = game.isGameOver;
    }

    updateUndoControls();

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
            gameHint.textContent = '点击地图区域，为蓝方选择基地。';
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
        schemaVersion: 2,
        gameState: game.toJSON(),
        mapSeeds: mapManager.seeds,
        redBaseId: redBaseId,
        blueBaseId: blueBaseId,
        gamePhase: gamePhase,
        isAIMode: isAIMode,
        playerSide: activeMatchConfig?.playerSide || 'red',
        difficulty: activeMatchConfig?.difficulty || difficultySelect.value,
        matchTracker: matchTracker?.toJSON() || null,
        matchHistory: matchHistory?.toJSON() || null,
        undoManager: undoManager?.toJSON() || null,
        lastMatchResult
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
        lastMatchResult = null;
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

        // Validate all persisted match metadata against the detached game before
        // mutating the currently active match.
        const restoredIsAIMode = typeof data.isAIMode === 'boolean' ? data.isAIMode : isAIMode;
        const restoredPlayerSideForConfig = data.playerSide === 'blue' ? 'blue' : 'red';
        const restoredDifficulty = DIFFICULTY_LEVELS.includes(data.difficulty) ? data.difficulty : difficultySelect.value;
        const restoredConfig = Object.freeze({
            mode: restoredIsAIMode ? 'pve' : 'pvp',
            difficulty: restoredDifficulty,
            playerSide: restoredIsAIMode ? restoredPlayerSideForConfig : 'red'
        });
        const restoredTracker = MatchTracker.fromJSON(data.matchTracker) ||
            MatchTracker.start(restoredGame, restoredConfig, { historyIncomplete: true });
        const restoredResult = data.lastMatchResult || null;
        const restoredSnapshot = {
            gameState: restoredGame.toJSON(),
            matchTracker: restoredTracker?.toJSON() || null,
            lastMatchResult: restoredResult
        };
        const restoredHistory = data.matchHistory
            ? MatchHistory.fromJSON(data.matchHistory)
            : MatchHistory.start(restoredSnapshot, { historyIncomplete: true });
        const historyTip = restoredHistory.actions.length
            ? restoredHistory.actions[restoredHistory.actions.length - 1].after
            : restoredHistory.initialSnapshot;
        if (JSON.stringify(historyTip) !== JSON.stringify(restoredSnapshot)) {
            throw new TypeError('存档棋谱末端与当前对局状态不一致');
        }
        const restoredUndo = data.undoManager
            ? UndoManager.fromJSON(data.undoManager)
            : new UndoManager({ mode: restoredConfig.mode, playerSide: restoredConfig.playerSide });
        if (restoredUndo.mode !== restoredConfig.mode || restoredUndo.playerSide !== restoredConfig.playerSide) {
            throw new TypeError('存档悔棋配置与对局模式不一致');
        }

        invalidateAIRequest();
        presentation.cancel();
        if (combatTimeoutId !== null) {
            clearTimeout(combatTimeoutId);
            combatTimeoutId = null;
        }
        isAnimating = false;
        isPaused = false;
        dyingNodes = [];
        clearCombatExplanation();
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
        const restoredPlayerSide = data.playerSide === 'blue' ? 'blue' : 'red';
        playerSideSelect.value = restoredPlayerSide;
        if (DIFFICULTY_LEVELS.includes(data.difficulty)) {
            difficultySelect.value = data.difficulty;
        }
        difficultyGroup.hidden = !isAIMode;
        playerSideGroup.hidden = !isAIMode;

        // 恢复变量
        redBaseId = data.redBaseId;
        blueBaseId = data.blueBaseId;
        gamePhase = data.gamePhase;
        selectedNodeId = null;
        legalAreaIds = new Set();

        // 重建规则引擎
        ruleEngine = new RuleEngine(mapManager);

        activeMatchConfig = restoredConfig;
        matchTracker = restoredTracker;
        lastMatchResult = restoredResult;
        matchHistory = restoredHistory;
        undoManager = restoredUndo;
        appState.startMatch(activeMatchConfig);
        renderGame();
        updateUI();
        if (game.isGameOver && lastMatchResult) {
            renderMatchResult(lastMatchResult);
            showAppScreen('result');
        } else {
            showAppScreen('game');
        }
        if (isAIMode && gamePhase === 'playing' && game.currentTurn === getAISide('pve', activeMatchConfig.playerSide) && !game.isGameOver) {
            triggerAITurn();
        }
        console.log('【读档成功】已恢复之前进度！');
        if (sourceName !== '最近一次对局') alert(`✅ 读档成功！读取到文件：${sourceName}`);
}

saveBtn.addEventListener('click', saveGame);
resultSaveBtn?.addEventListener('click', saveGame);
loadBtn.addEventListener('click', loadGame);
function syncPveSetupFields() {
    const isPve = modeSelect.value === 'pve';
    difficultyGroup.hidden = !isPve;
    playerSideGroup.hidden = !isPve;
}
modeSelect.addEventListener('change', syncPveSetupFields);

function showAppScreen(screen) {
    if (screen !== 'replay' && replayController?.isPlaying) replayController.pause();
    appState.navigate(screen);
    menuScreen.hidden = screen !== 'menu';
    setupScreen.hidden = screen !== 'setup';
    gameScreen.hidden = screen !== 'game';
    resultScreen.hidden = screen !== 'result';
    replayScreen.hidden = screen !== 'replay';
    document.body.dataset.screen = screen;
    if (screen === 'game') requestAnimationFrame(() => fitGameCanvas());
    if (screen === 'replay' && replaySession) requestAnimationFrame(() => fitReplayCanvas());
    if (screen === 'menu') updateMenuUI();
}

function fitReplayCanvas() {
    if (!replaySession || replayScreen.hidden) return;
    replayDrawer.fitToContainer(document.getElementById('replay-canvas-container'));
    renderReplayPosition(replaySession.getCurrentSnapshot(), replaySession.currentStep);
}

function appendReplayMeta(label, value) {
    const item = document.createElement('div');
    item.className = 'replay-meta-item';
    const caption = document.createElement('small');
    caption.textContent = label;
    const content = document.createElement('strong');
    content.textContent = String(value);
    item.append(caption, content);
    replayMetadataPanel.appendChild(item);
}

function renderReplayMetadata(fileName, warnings) {
    replayFileName.textContent = fileName || '已导入存档';
    replayMetadataPanel.replaceChildren();
    appendReplayMeta('对战模式', replayMetadata.mode === 'pve' ? '人机对战' : '双人对战');
    if (replayMetadata.mode === 'pve') {
        appendReplayMeta('玩家阵营', replayMetadata.playerSide === 'red' ? '红方' : '蓝方');
        appendReplayMeta('AI 难度', getDifficultyLabel(replayMetadata.difficulty));
    }
    appendReplayMeta('红方基地', '区域 ' + replayMetadata.redBaseId);
    appendReplayMeta('蓝方基地', '区域 ' + replayMetadata.blueBaseId);
    appendReplayMeta('历史记录', replaySession.historyIncomplete ? '不完整' : '完整');
    replayWarning.textContent = warnings.join(' ') || '';
    replayWarning.hidden = warnings.length === 0;
    replayActionCount.textContent = replaySession.totalSteps + ' 步';
}

function summarizeReplayEvents(record) {
    const previousIds = new Set((record.before.matchTracker?.events || []).map(event => event.id));
    const events = (record.after.matchTracker?.events || []).filter(event => !previousIds.has(event.id));
    const summaries = [];
    for (const event of events) {
        if (event.type === 'COMBAT' && event.destroyedNodes > 0) summaries.push(`摧毁 ${event.destroyedNodes} 个节点`);
        else if (event.type === 'FREEZE') summaries.push(`冻结节点 #${event.nodeId}`);
        else if (event.type === 'ROOT_DESTROYED') summaries.push(`根节点损失 ${event.count} 个`);
        else if (event.type === 'VICTORY') summaries.push(`${event.side === 'red' ? '红方' : '蓝方'}获胜`);
    }
    return summaries.join(' · ');
}

function renderReplayTimeline() {
    replayActionList.replaceChildren();
    const addItem = (step, title, detail) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'replay-action-item';
        button.dataset.step = String(step);
        const index = document.createElement('span');
        index.className = 'replay-action-index';
        index.textContent = step === 0 ? 'START' : String(step).padStart(3, '0');
        const copy = document.createElement('span');
        copy.className = 'replay-action-copy';
        const heading = document.createElement('strong');
        heading.textContent = title;
        const sub = document.createElement('small');
        sub.textContent = detail;
        copy.append(heading, sub);
        button.append(index, copy);
        button.addEventListener('click', () => replayController?.goTo(step));
        li.appendChild(button);
        replayActionList.appendChild(li);
    };
    addItem(0,
        replaySession.historyIncomplete ? '可恢复历史起点' : '开局初始局面',
        replaySession.historyIncomplete ? '此存档仅保留该历史段及之后的行动' : '双方基地与根节点部署完成');
    for (let step = 1; step <= replaySession.totalSteps; step++) {
        const record = replaySession.getActionAt(step);
        const formatted = formatReplayAction(record, replayMetadata);
        const eventSummary = summarizeReplayEvents(record);
        addItem(step, formatted.title, [formatted.detail, eventSummary].filter(Boolean).join(' · '));
    }
}

function renderReplayStats(gameState, snapshot) {
    const redNodes = gameState.getAliveNodesByOwner('red');
    const blueNodes = gameState.getAliveNodesByOwner('blue');
    const aliveNodes = [...redNodes, ...blueNodes];
    const occupiedAreas = new Set(aliveNodes.map(node => node.areaId)).size;
    const frozenNodes = aliveNodes.filter(node => node.isFrozen).length;
    const winner = snapshot?.lastMatchResult?.winner;
    const stats = document.createElement('div');
    stats.className = 'replay-stats';
    const values = [
        ['红方节点', redNodes.length],
        ['蓝方节点', blueNodes.length],
        ['红方根节点', gameState.getPlayerRootNodes('red').length],
        ['蓝方根节点', gameState.getPlayerRootNodes('blue').length],
        ['占据区域', occupiedAreas],
        ['冻结节点', frozenNodes],
        ['当前行动方', gameState.currentTurn === 'red' ? '红方' : '蓝方'],
        ['对局状态', winner ? (winner === 'red' ? '红方获胜' : '蓝方获胜') : gameState.isGameOver ? '已结束' : '进行中']
    ];
    for (const [label, value] of values) {
        const item = document.createElement('div');
        item.className = 'replay-stat';
        const caption = document.createElement('small');
        caption.textContent = label;
        const content = document.createElement('strong');
        content.textContent = String(value);
        item.append(caption, content);
        stats.appendChild(item);
    }
    return stats;
}

function renderReplayPosition(snapshot, step) {
    if (!replaySession || !replayMapManager || !replayMetadata) return;
    const replayGame = GameState.fromJSON(snapshot.gameState);
    replayDrawer.renderMap(replayMapAreas, replayMetadata.redBaseId, replayMetadata.blueBaseId);
    replayDrawer.renderNodes(replayGame.getAliveNodes(), null, [], replayMapManager.portals);

    const record = step > 0 ? replaySession.getActionAt(step) : null;
    replayPositionTitle.textContent = record
        ? formatReplayAction(record, replayMetadata).title
        : (replaySession.historyIncomplete ? '历史起点（不完整）' : '开局初始局面');
    replayPositionMeta.textContent = `第 ${step} / ${replaySession.totalSteps} 步 · ${replayGame.currentTurn === 'red' ? '红方' : '蓝方'}行动`;
    replayDetailStep.textContent = step === 0
        ? (replaySession.historyIncomplete ? '历史起点' : '开局')
        : '第 ' + step + ' 步';
    replayCurrentStep.textContent = String(step);
    replayTotalSteps.textContent = String(replaySession.totalSteps);
    replayProgress.max = String(replaySession.totalSteps);
    replayProgress.value = String(step);
    replayFirstBtn.disabled = step === 0;
    replayPrevBtn.disabled = step === 0;
    replayNextBtn.disabled = step >= replaySession.totalSteps;
    replayLastBtn.disabled = step >= replaySession.totalSteps;
    replayPlayBtn.disabled = step >= replaySession.totalSteps && !replayController?.isPlaying;
    replayPlayBtn.textContent = replayController?.isPlaying ? '暂停' : '播放';

    for (const button of replayActionList.querySelectorAll('.replay-action-item')) {
        button.classList.toggle('active', Number(button.dataset.step) === step);
    }

    replayActionDetail.replaceChildren();
    const title = document.createElement('p');
    title.className = 'replay-detail-title';
    const subtitle = document.createElement('p');
    subtitle.className = 'replay-detail-subtitle';
    if (record) {
        const formatted = formatReplayAction(record, replayMetadata);
        title.textContent = formatted.title;
        subtitle.textContent = formatted.detail;
    } else {
        title.textContent = replaySession.historyIncomplete ? '可恢复历史起点' : '双方根节点部署完成';
        subtitle.textContent = replaySession.historyIncomplete
            ? '该存档没有完整的开局记录，无法还原此历史段之前的行动。'
            : '这是棋谱记录的第一个可恢复局面。';
    }
    replayActionDetail.append(title, subtitle, renderReplayStats(replayGame, snapshot));

    if (record) {
        const previousEvents = record.before.matchTracker?.events || [];
        const previousIds = new Set(previousEvents.map(event => event.id));
        const events = (record.after.matchTracker?.events || [])
            .filter(event => !previousIds.has(event.id));
        const eventList = document.createElement('ul');
        eventList.className = 'replay-event-list';
        if (events.length === 0) {
            const item = document.createElement('li');
            const text = document.createElement('small');
            text.textContent = record.action.type === 'skip'
                ? '跳过回合：棋盘没有发生变化。'
                : '本步没有额外记录战斗或特殊事件。';
            item.appendChild(text);
            eventList.appendChild(item);
        } else {
            for (const event of events) {
                const formatted = formatReplayEvent(event, replayMetadata);
                const item = document.createElement('li');
                const heading = document.createElement('strong');
                heading.textContent = formatted.title;
                const detail = document.createElement('small');
                detail.textContent = formatted.detail;
                item.append(heading, detail);
                eventList.appendChild(item);
            }
        }
        replayActionDetail.appendChild(eventList);
    }
}

function openReplayFromSave(rawData, fileName = '存档') {
    const validated = ReplaySaveValidator.validate(rawData);
    replayController?.dispose();
    replaySession = new ReplaySession(validated.data);
    replayMapManager = validated.mapManager;
    replayMapAreas = validated.mapAreas;
    replayMetadata = validated.metadata;
    replayDrawer.setMode('locked');
    replayDrawer.resetViewport();
    replaySpeedSelect.value = '1';
    replayContent.hidden = false;
    replayEmpty.hidden = true;
    replayError.hidden = true;
    renderReplayMetadata(fileName, validated.warnings);
    renderReplayTimeline();
    replayController = new ReplayController(replaySession, {
        onChange: event => renderReplayPosition(event.snapshot, event.currentStep)
    });
    replayController.goTo(0);
    requestAnimationFrame(() => fitReplayCanvas());
}

async function importReplayFile(file) {
    if (!file) return;
    replayController?.pause();
    if (file.size > 20 * 1024 * 1024) {
        replayError.textContent = '存档文件超过 20 MB，已拒绝导入。';
        replayError.hidden = false;
        return;
    }
    try {
        const data = JSON.parse(await file.text());
        openReplayFromSave(data, file.name);
    } catch (error) {
        console.error('导入回放存档失败：', error);
        replayError.textContent = '导入失败：' + (error?.message || '存档格式无效');
        replayError.hidden = false;
    }
}

replayMenuBtn?.addEventListener('click', () => showAppScreen('replay'));
replayMenuBtnTop?.addEventListener('click', () => showAppScreen('menu'));
replayImportBtn?.addEventListener('click', () => replayFileInput?.click());
replayEmptyImportBtn?.addEventListener('click', () => replayFileInput?.click());
replayFileInput?.addEventListener('change', event => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    importReplayFile(file);
});
replayFirstBtn?.addEventListener('click', () => replayController?.first());
replayPrevBtn?.addEventListener('click', () => replayController?.previous());
replayNextBtn?.addEventListener('click', () => replayController?.next());
replayLastBtn?.addEventListener('click', () => replayController?.last());
replayPlayBtn?.addEventListener('click', () => {
    if (!replayController) return;
    if (replayController.isPlaying) replayController.pause();
    else replayController.play();
    renderReplayPosition(replaySession.getCurrentSnapshot(), replaySession.currentStep);
});
replayProgress?.addEventListener('input', event => {
    if (replayController) replayController.goTo(Number(event.target.value));
});
replaySpeedSelect?.addEventListener('change', event => {
    replayController?.setSpeed(Number(event.target.value));
});
window.addEventListener('resize', () => {
    if (appState.screen === 'replay') fitReplayCanvas();
}, { passive: true });

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
    if (isAnimating || isAIThinking) return;
    try {
        localStorage.setItem(LAST_MATCH_KEY, JSON.stringify({
            schemaVersion: 2, gameState: game.toJSON(), mapSeeds: mapManager.seeds,
            redBaseId, blueBaseId, gamePhase, isAIMode,
            playerSide: activeMatchConfig?.playerSide || 'red',
            difficulty: activeMatchConfig?.difficulty || difficultySelect.value,
            matchTracker: matchTracker?.toJSON() || null,
            matchHistory: matchHistory?.toJSON() || null,
            undoManager: undoManager?.toJSON() || null,
            lastMatchResult
        }));
    } catch (error) { console.warn('最近对局自动保存失败：', error); }
}

function beginNewMatch(configOverride = null) {
    lastMatchResult = null;
    const config = createRematchConfig(configOverride || {
        mode: modeSelect.value === 'pve' ? 'pve' : 'pvp',
        difficulty: difficultySelect.value,
        playerSide: modeSelect.value === 'pve' ? playerSideSelect.value : 'red'
    });
    modeSelect.value = config.mode;
    difficultySelect.value = config.difficulty;
    playerSideSelect.value = config.playerSide;
    syncPveSetupFields();
    try { localStorage.removeItem(LAST_MATCH_KEY); } catch (error) { console.warn('清理上一局自动恢复记录失败：', error); }
    if (feedbackTimeoutId !== null) { clearTimeout(feedbackTimeoutId); feedbackTimeoutId = null; }
    if (actionFeedback) actionFeedback.hidden = true;
    audio.stopAll();
    activeMatchConfig = config;
    appState.startMatch(config);
    isAIMode = config.mode === 'pve';
    invalidateAIRequest();
    presentation.cancel();
    clearCombatExplanation();
    if (combatTimeoutId !== null) {
        clearTimeout(combatTimeoutId);
        combatTimeoutId = null;
    }

    // 重置整个游戏到开局状态
    game = new GameState();
    matchTracker = null;
    matchHistory = null;
    undoManager = null;
    mapAreas = mapManager.generateMap(50);
    ruleEngine = new RuleEngine(mapManager);
    
    gamePhase = 'selectRed';
    redBaseId = null;
    blueBaseId = null;
    selectedNodeId = null;
    legalAreaIds = new Set();
    hoverAreaId = null;
    presentation.cancel();
    audio.stopAll();
    dyingNodes = [];
    isAnimating = false;
    isAIThinking = false;
    isPaused = false;
    
    // 重置地图视口与交互模式，避免上一局的缩放/拖动状态泄漏。
    drawer.setMode('locked');
    drawer.resetViewport();
    updateViewportModeUI();
    updateZoomUI();

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
    playerSideGroup.hidden = true;
    playerSideSelect.value = 'red';
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
startGameBtn.addEventListener('click', () => beginNewMatch());

const tutorialController = new TutorialController({
    onExit: () => showAppScreen('menu')
});
document.getElementById('tutorial-menu-btn').addEventListener('click', () => {
    rulesPanel.hidden = true;
    showAppScreen('menu');
    menuScreen.hidden = true;
    tutorialController.open();
});

resultMenuBtn.addEventListener('click', () => { isPaused = false; showAppScreen('menu'); });
resultRematchBtn.addEventListener('click', () => {
    if (!activeMatchConfig) return;
    beginNewMatch(activeMatchConfig);
});

// ==========================================
// 画布点击事件
// ==========================================
document.getElementById('gameCanvas').addEventListener('click', (e) => {
    if (!drawer.isLocked) return;
    if (isPaused || isAnimating || isAIThinking) return; 
    const point = drawer.getLogicalPoint(e.clientX, e.clientY);
    if (!point) return;
    const { x, y } = point;

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

        // 所有模式统一由玩家先选红方基地，再选蓝方基地；AI 不参与基地选址。
        return;
    }
    if (gamePhase === 'selectBlue') {
        // 双人模式走原有的逻辑
        if (clickedAreaId === redBaseId) { showFeedback('该区域已经被红方占领，请选择其他区域。', 'warning'); return; }
        blueBaseId = clickedAreaId;
        gamePhase = 'playing';
        generateRootNodesInArea(redBaseId, 'red', 3);
        generateRootNodesInArea(blueBaseId, 'blue', 3);
        matchTracker = MatchTracker.start(game, activeMatchConfig || { mode: isAIMode ? 'pve' : 'pvp', difficulty: difficultySelect.value });
        matchHistory = MatchHistory.start(captureHistorySnapshot());
        undoManager = new UndoManager({ mode: isAIMode ? 'pve' : 'pvp', playerSide: activeMatchConfig?.playerSide || 'red' });
        selectedNodeId = null;
        drawer.renderMap(mapAreas, redBaseId, blueBaseId);
        drawer.renderNodes(game.getAliveNodes(), selectedNodeId);
        updateUI();
        persistLastMatch();
        if (isAIMode && game.currentTurn === getAISide('pve', activeMatchConfig?.playerSide || 'red')) {
            triggerAITurn();
        }
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
            showFeedback('这是对手的节点，不能作为生长起点。', 'warning');
            selectedNodeId = null;
            renderGame();
            return;
        }

        // 1.2 如果是处于冻结状态的节点，直接拦截
        if (clickedNode.isFrozen) {
            showFeedback('该节点本回合处于冻结状态，无法作为生长起点。', 'warning');
            selectedNodeId = null;
            renderGame();
            return;
        }

        // 1.3 如果是已有子节点的根节点，直接拦截
        if (clickedNode.isRoot && clickedNode.childrenIds.length > 0) {
            showFeedback('根节点不能作为分叉点再次生长。', 'warning');
            selectedNodeId = null;
            renderGame();
            return;
        }

        // 2. 核心选中逻辑：通过所有拦截后，执行选中
        selectedNodeId = clickedNode.id;
        showFeedback(`已选中节点 #${clickedNode.id}，请选择高亮区域。`, 'info', 1500);
        console.log(`已选中父节点 ID: ${selectedNodeId}`);
        renderGame();
        return;
    }

    if (selectedNodeId === null) {
        showFeedback('请先选择一个可生长的己方节点。', 'warning');
        return;
    }

    const owner = game.currentTurn;
    const ownBaseId = owner === 'red' ? redBaseId : blueBaseId;
    const enemyBaseId = owner === 'red' ? blueBaseId : redBaseId;
    const beforeActionSnapshot = captureHistorySnapshot();
    const growthResult = executeGrowthAction({
        gameState: game,
        ruleEngine,
        mapAreas,
        parentNodeId: selectedNodeId,
        targetAreaId: clickedAreaId,
        owner,
        ownBaseId,
        enemyBaseId
    });
    if (!growthResult.ok) {
        showFeedback(`无法生长：${growthResult.reason}`, 'warning');
        return;
    }

    const newNode = growthResult.node;
    console.log(`【生长成功】父节点 ID: ${growthResult.action.parentNodeId}，新节点 ID: ${newNode.id}，位于区域 ${clickedAreaId}`);
    processSuccessfulGrowth(newNode, owner, beforeActionSnapshot, growthResult.action);
});

pauseBtn.addEventListener('click', () => {
    if (gamePhase !== 'playing' || game.isGameOver || isAnimating || isAIThinking) return;
    isPaused = !isPaused;
    audio.play(isPaused ? 'pause' : 'resume');
    selectedNodeId = null; updateUI(); renderGame();
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

audioMuteBtn?.addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    syncAudioControls();
    if (!audio.muted) { audio.unlock().then(() => audio.play('resume')); }
});
audioVolume?.addEventListener('input', event => {
    audio.setVolume(Number(event.target.value));
});

for (const [button, side] of [[undoRedBtn, 'red'], [undoBlueBtn, 'blue'], [undoPlayerBtn, null], [resultUndoRedBtn, 'red'], [resultUndoBlueBtn, 'blue'], [resultUndoPlayerBtn, null]]) {
    button?.addEventListener('click', () => {
        if (!undoMatchAction(side || activeMatchConfig?.playerSide || 'red')) {
            showFeedback('当前无法悔棋：请检查行动记录、冷却状态或对局状态。', 'warning');
        }
    });
}

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
        (isAIMode && game.currentTurn === getAISide('pve', activeMatchConfig?.playerSide || 'red')) || selectedNodeId === null) {
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
        legalAreaIds,
        hoverAreaId,
        aiTargetAreaId
    );
    drawer.renderNodes(game.getAliveNodes(), selectedNodeId, dyingNodes, mapManager.portals, presentation?.animationState || null, presentation?.combatState || null);
    persistLastMatch();
}
// Expose a lightweight startup diagnostic after the game module and UI event
// handlers have initialized. The desktop smoke test uses this without touching
// gameplay state or requiring a test-only code path.
const canvasContainer = document.getElementById('canvas-container');
const gameCanvas = document.getElementById('gameCanvas');
const viewportModeHint = document.getElementById('viewport-mode-hint');
let zoomAnchorX = 0;
let zoomAnchorY = 0;
let panGesture = null;
let suppressNextCanvasClick = false;

function updateZoomUI() {
    if (zoomLevel) zoomLevel.textContent = `${Math.round(drawer.zoom * 100)}%`;
    if (zoomOutBtn) zoomOutBtn.disabled = drawer.zoom <= 0.5;
    if (zoomInBtn) zoomInBtn.disabled = drawer.zoom >= 2;
}
function updateViewportModeUI() {
    if (!viewportModeBtn) return;
    viewportModeBtn.textContent = drawer.isLocked ? '解锁地图' : '锁定地图';
    viewportModeBtn.setAttribute('aria-pressed', String(!drawer.isLocked));
    viewportModeBtn.setAttribute('aria-label', drawer.isLocked ? '解锁地图并启用拖动浏览' : '锁定地图并恢复游戏操作');
    if (canvasContainer) {
        canvasContainer.dataset.viewportMode = drawer.mode;
        canvasContainer.setAttribute('aria-describedby', 'viewport-mode-hint');
    }
    if (gameScreen) gameScreen.dataset.viewportMode = drawer.mode;
    if (viewportModeHint) viewportModeHint.textContent = drawer.isLocked
        ? '锁定状态：点击地图进行游戏操作'
        : '解锁状态：按住鼠标左键拖动地图；游戏操作暂时禁用';
}
function fitGameCanvas() {
    if (!canvasContainer || gameScreen.hidden) return;
    drawer.fitToContainer(canvasContainer);
    updateZoomUI();
}
function resetMapViewport(recalculateFit = false) {
    if (recalculateFit) fitGameCanvas();
    drawer.resetViewport();
    updateZoomUI();
}
function setViewportMode(mode) {
    drawer.setMode(mode);
    panGesture = null;
    updateViewportModeUI();
    gameCanvas.classList.remove('is-panning');
}
zoomOutBtn.addEventListener('click', () => { drawer.setZoom(drawer.zoom - 0.1, zoomAnchorX, zoomAnchorY); updateZoomUI(); });
zoomInBtn.addEventListener('click', () => { drawer.setZoom(drawer.zoom + 0.1, zoomAnchorX, zoomAnchorY); updateZoomUI(); });
fitMapBtn.addEventListener('click', () => resetMapViewport(true));
resetViewportBtn.addEventListener('click', () => resetMapViewport(false));
viewportModeBtn.addEventListener('click', () => setViewportMode(drawer.isLocked ? 'unlocked' : 'locked'));

for (const control of [pauseBtn, saveBtn, loadBtn, restartBtn, menuBtn, endTurnBtn]) {
    control?.addEventListener('click', event => {
        if (!drawer.isLocked) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);
}

gameCanvas.addEventListener('mousemove', event => {
    if (!drawer.isLocked || isPaused || isAnimating || isAIThinking || gamePhase !== 'playing' || selectedNodeId === null) {
        if (hoverAreaId !== null) { hoverAreaId = null; renderGame(); }
        return;
    }
    const point = drawer.getLogicalPoint(event.clientX, event.clientY);
    const areaId = point ? mapManager.getAreaAtPoint(point.x, point.y) : null;
    const nextHover = areaId !== null && legalAreaIds.has(areaId) ? areaId : null;
    if (nextHover !== hoverAreaId) { hoverAreaId = nextHover; renderGame(); }
});
gameCanvas.addEventListener('mouseleave', () => {
    if (hoverAreaId !== null) { hoverAreaId = null; renderGame(); }
});

gameCanvas.addEventListener('pointerdown', event => {
    if (drawer.isLocked || event.button !== 0 || !canvasContainer) return;
    event.preventDefault();
    panGesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: drawer.offsetX,
        originY: drawer.offsetY,
        moved: false
    };
    gameCanvas.setPointerCapture?.(event.pointerId);
    gameCanvas.classList.add('is-panning');
});
gameCanvas.addEventListener('pointermove', event => {
    if (canvasContainer) {
        const rect = canvasContainer.getBoundingClientRect();
        zoomAnchorX = event.clientX - (rect.left + rect.width / 2);
        zoomAnchorY = event.clientY - (rect.top + rect.height / 2);
    }
    if (!panGesture || panGesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - panGesture.startX;
    const dy = event.clientY - panGesture.startY;
    if (Math.hypot(dx, dy) > 3) panGesture.moved = true;
    if (panGesture.moved) {
        event.preventDefault();
        drawer.setPan(panGesture.originX + dx, panGesture.originY + dy);
    }
});
function finishPanGesture(event) {
    if (!panGesture || (event && panGesture.pointerId !== event.pointerId)) return;
    const moved = panGesture.moved;
    panGesture = null;
    gameCanvas.classList.remove('is-panning');
    if (moved) {
        suppressNextCanvasClick = true;
        window.setTimeout(() => { suppressNextCanvasClick = false; }, 0);
    }
}
gameCanvas.addEventListener('pointerup', finishPanGesture);
gameCanvas.addEventListener('pointercancel', finishPanGesture);
gameCanvas.addEventListener('lostpointercapture', finishPanGesture);
gameCanvas.addEventListener('click', event => {
    if (!drawer.isLocked || suppressNextCanvasClick) {
        event.stopImmediatePropagation();
        event.preventDefault();
    }
}, true);

if ('ResizeObserver' in window && canvasContainer) {
    const canvasResizeObserver = new ResizeObserver(() => {
        fitGameCanvas();
        if (!gameScreen.hidden && mapAreas.length) renderGame();
    });
    canvasResizeObserver.observe(canvasContainer);
} else {
    window.addEventListener('resize', () => { fitGameCanvas(); if (!gameScreen.hidden && mapAreas.length) renderGame(); });
}
updateViewportModeUI();
updateZoomUI();
document.documentElement.dataset.treeGrowAppReady = 'true';
document.documentElement.dataset.treeGrowAiWorkerAvailable = String(!!aiWorker);
