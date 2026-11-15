import { MapManager } from '../core/MapManager.js';
import { CanvasDrawer } from '../renderer/CanvasDrawer.js';
import { GameState } from '../game/GameState.js';
import { RuleEngine } from '../game/RuleEngine.js';
import { TutorialSession } from './TutorialSession.js';
import { resolveCombat } from '../game/CombatResolver.js';

const WIDTH = 1800;
const HEIGHT = 1200;
const PROGRESS_KEY = 'treeGrow:tutorialProgress:v1';

const LESSONS = [
    { chapter: '第一章 · 认识棋盘', title: '先认识这张地图', body: '整张地图由许多区域组成。每个区域有自己的编号，区域之间以共享边界连接。你的目标不是随意铺满地图，而是沿着连接关系扩展自己的树。', instruction: '观察地图上的区域编号与红、蓝双方基地。', mode: 'info' },
    { chapter: '第一章 · 认识棋盘', title: '节点与连接', body: '圆点是节点，线段表示父子关系。每个新节点都必须从己方已有节点生长出来，因此你的结构始终是一棵树，而不是任意连线的网络。', instruction: '观察双方根节点。红色是你，蓝色是对手。', mode: 'info' },
    { chapter: '第二章 · 基本操作', title: '完成第一次生长', body: '一次行动分两步：先点击己方可行动节点，再点击地图上高亮的合法区域。普通生长只能进入与父节点区域直接相邻的空区域。', instruction: '先选中红色根节点，再点击任意绿色高亮区域。', mode: 'grow' },
    { chapter: '第二章 · 基本操作', title: '回合与行动顺序', body: '双方轮流行动。完成一次生长后，行动权交给另一方；冻结等状态也会随着回合推进而变化。下方示例当前轮到蓝方，红方不能连续行动。', instruction: '观察当前回合提示，再点击“继续”进入下一节。', mode: 'turn' },
    { chapter: '第二章 · 基本操作', title: '根节点的首次生长', body: '根节点只能生长第一根枝条，之后不能再次作为分叉点。首次生长有特殊距离规则：最多跨越 min(己方已占据区域数, 2) 条边。开局只有一个己方区域，因此首次生长实际上只能跨一条边。', instruction: '记住：根节点只负责伸出第一根枝条，后续扩展从新节点继续。', mode: 'info' },
    { chapter: '第三章 · 战斗规则', title: '攻击与战斗结算', body: '当你把新节点生长到对方占据的普通区域时，会触发战斗。战斗可能摧毁目标枝条；如果攻击叶节点或链节点，规则还会沿父链回溯，找到最近的分叉祖先，并可能使这个非根分叉节点冻结。', instruction: '选中红色根节点，再点击地图上高亮的蓝色节点区域，观察枝条被摧毁和分叉冻结。', mode: 'combat' },
    { chapter: '第三章 · 战斗规则', title: '进入敌方基地', body: '攻击不是点击敌方节点本身，而是选择己方节点，再把目标区域设为敌方占据的区域。成功突入敌方基地即可获胜。堡垒节点不能被攻击。', instruction: '选中红色根节点，再点击紧邻的蓝色基地，完成一次突入。', mode: 'attack' },
    { chapter: '第四章 · 结构与策略', title: '分叉、堡垒与冻结', body: '分叉节点至少有两个子节点；堡垒节点的度数大于 3，二者不是同一个概念。图中会同时展示普通分叉、堡垒和冻结节点。攻击叶节点或链节点时，战斗会沿祖先路径回溯；符合条件的非根分叉祖先可能被冻结。冻结节点暂时不能生长。', instruction: '观察地图中的节点结构，区分普通分叉、堡垒和冻结标记。', mode: 'structures' },
    { chapter: '第五章 · 毕业实战', title: '亲自完成一次决策', body: '现在把前面的知识串起来：观察己方节点、判断合法区域，再选择一个有战略价值的方向。不要只看眼前能不能生长，也要考虑对手下一步能否攻击你的结构。', instruction: '独立选择一个己方节点，并完成一次合法生长。', mode: 'practice' },
    { chapter: '教程完成', title: '你已经掌握基本操作', body: '你已经完成从认识棋盘、基本生长到攻击和结构规则的入门流程。正式对局中，胜利条件是突入敌方基地，或摧毁对方全部根节点。建议先进行一局双人或简单难度的人机对战。', instruction: '点击“完成教程”返回主菜单。', mode: 'finish' }
];

function createSeeds() {
    const seeds = [];
    for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 10; col++) {
            const jitterX = ((row * 17 + col * 13) % 19) - 9;
            const jitterY = ((row * 11 + col * 7) % 17) - 8;
            seeds.push([90 + col * 180 + jitterX, 120 + row * 240 + jitterY]);
        }
    }
    return seeds;
}

export function buildScenario(mode, id) {
    const mapManager = new MapManager(WIDTH, HEIGHT);
    const mapSeeds = createSeeds();
    const areas = mapManager.loadMapFromSeeds(mapSeeds);
    const game = new GameState();
    let redBaseId = 1;
    let blueBaseId = areas.length;

    if (mode === 'structures') {
        let layout = null;
        for (const fortressId of areas.map(area => area.id)) {
            const fortressNeighbors = mapManager.adjacency[fortressId] || [];
            if (fortressNeighbors.length < 4) continue;
            for (const branchId of fortressNeighbors) {
                const branchNeighbors = mapManager.adjacency[branchId] || [];
                const parentId = branchNeighbors.find(id => id !== fortressId);
                const siblingId = branchNeighbors.find(id => id !== fortressId && id !== parentId);
                const fortressChildren = fortressNeighbors.filter(id =>
                    id !== branchId && id !== parentId && id !== siblingId
                );
                if (parentId && siblingId && fortressChildren.length >= 3) {
                    layout = { parentId, branchId, fortressId, siblingId, children: fortressChildren.slice(0, 3) };
                    break;
                }
            }
            if (layout) break;
        }
        if (!layout) throw new Error('教程地图无法构造分叉与堡垒示例');
        const used = new Set([layout.parentId, layout.branchId, layout.fortressId, layout.siblingId, ...layout.children]);
        blueBaseId = areas.map(area => area.id).find(id => !used.has(id));
        if (!blueBaseId) throw new Error('教程地图缺少蓝方基地区域');
        redBaseId = layout.parentId;
        const add = (parentId, areaId, owner = 'red') =>
            game.addNode(parentId, ...areas[areaId - 1].center, areaId, owner);
        const root = add(null, layout.parentId);
        const branch = add(root.id, layout.branchId);
        const fortress = add(branch.id, layout.fortressId);
        const frozenExample = add(branch.id, layout.siblingId);
        for (const childAreaId of layout.children) add(fortress.id, childAreaId);
        frozenExample.isFrozen = true;
        add(null, blueBaseId, 'blue');
    } else if (mode === 'combat') {
        const redBase = 1;
        let layout = null;
        for (const attackAreaId of mapManager.adjacency[redBase] || []) {
            for (const branchId of mapManager.adjacency[attackAreaId] || []) {
                if (branchId === redBase) continue;
                const neighbors = mapManager.adjacency[branchId] || [];
                const rootAreaId = neighbors.find(id => id !== attackAreaId && id !== redBase);
                const siblingAreaId = neighbors.find(id => id !== attackAreaId && id !== redBase && id !== rootAreaId);
                if (rootAreaId && siblingAreaId) {
                    layout = { attackAreaId, branchId, rootAreaId, siblingAreaId };
                    break;
                }
            }
            if (layout) break;
        }
        if (!layout) throw new Error('教程地图无法构造战斗与冻结示例');
        redBaseId = redBase;
        blueBaseId = layout.rootAreaId;
        game.addNode(null, ...areas[redBaseId - 1].center, redBaseId, 'red');
        game.currentTurn = 'blue';
        const blueRoot = game.addNode(null, ...areas[blueBaseId - 1].center, blueBaseId, 'blue');
        const branch = game.addNode(blueRoot.id, ...areas[layout.branchId - 1].center, layout.branchId, 'blue');
        game.addNode(branch.id, ...areas[layout.attackAreaId - 1].center, layout.attackAreaId, 'blue');
        game.addNode(branch.id, ...areas[layout.siblingAreaId - 1].center, layout.siblingAreaId, 'blue');
        game.currentTurn = 'red';
    } else {
        const redBase = 1;
        const neighbor = mapManager.adjacency[redBase]?.[0];
        if (!neighbor) throw new Error('教程地图无法生成基地相邻区域');
        redBaseId = redBase;
        blueBaseId = mode === 'attack' ? neighbor : areas.length;
        game.addNode(null, ...areas[redBaseId - 1].center, redBaseId, 'red');
        game.addNode(null, ...areas[blueBaseId - 1].center, blueBaseId, 'blue');
        game.currentTurn = mode === 'turn' ? 'blue' : 'red';
    }
    return { id, mapSeeds, gameState: game.toJSON(), redBaseId, blueBaseId };
}

export class TutorialController {
    constructor({ onExit }) {
        this.onExit = onExit;
        this.screen = document.getElementById('tutorial-screen');
        this.container = document.getElementById('tutorial-canvas-container');
        this.canvas = document.getElementById('tutorialCanvas');
        this.drawer = new CanvasDrawer('tutorialCanvas');
        this.chapter = document.getElementById('tutorial-chapter');
        this.title = document.getElementById('tutorial-title');
        this.body = document.getElementById('tutorial-body');
        this.instruction = document.getElementById('tutorial-instruction');
        this.progress = document.getElementById('tutorial-progress');
        this.feedback = document.getElementById('tutorial-feedback');
        this.nextButton = document.getElementById('tutorial-next');
        this.resetButton = document.getElementById('tutorial-reset');
        this.exitButton = document.getElementById('tutorial-exit');
        this.index = this.loadProgress();
        this.session = null;
        this.selectedNodeId = null;
        this.legalAreaIds = new Set();
        this.completed = false;
        this.nextButton.addEventListener('click', () => this.advance());
        this.resetButton.addEventListener('click', () => this.reset());
        this.exitButton.addEventListener('click', () => this.exit());
        this.canvas.addEventListener('click', event => this.handleCanvasClick(event));
        window.addEventListener('resize', () => this.fit(), { passive: true });
    }

    loadProgress() {
        try {
            const value = Number(localStorage.getItem(PROGRESS_KEY));
            return Number.isInteger(value) ? Math.max(0, Math.min(LESSONS.length - 1, value)) : 0;
        } catch { return 0; }
    }

    saveProgress() {
        try { localStorage.setItem(PROGRESS_KEY, String(this.index)); } catch { /* Storage may be unavailable. */ }
    }

    open() {
        this.screen.hidden = false;
        this.startLesson();
        requestAnimationFrame(() => this.fit());
    }

    fit() {
        if (this.screen.hidden) return;
        this.drawer.fitToContainer(this.container);
        this.render();
    }

    startLesson() {
        const lesson = LESSONS[this.index];
        this.selectedNodeId = null;
        this.completed = ['info', 'turn', 'structures', 'finish'].includes(lesson.mode);
        this.session?.exit();
        const scenario = buildScenario(lesson.mode, 'lesson-' + this.index);
        this.session = new TutorialSession(scenario, { width: WIDTH, height: HEIGHT });
        this.chapter.textContent = lesson.chapter;
        this.title.textContent = lesson.title;
        this.body.textContent = lesson.body;
        this.instruction.textContent = lesson.instruction;
        this.feedback.textContent = lesson.mode === 'turn' ? '当前回合：蓝方。红方需要等待蓝方完成行动。' :
            lesson.mode === 'info' || lesson.mode === 'structures' ? '阅读本节内容后继续。' :
            lesson.mode === 'finish' ? '教程已完成。' : '等待你的操作。';
        this.nextButton.textContent = lesson.mode === 'finish' ? '完成教程' : '继续 →';
        this.nextButton.disabled = !this.completed;
        this.progress.textContent = '第 ' + (this.index + 1) + ' / ' + LESSONS.length + ' 节';
        this.render();
    }

    render() {
        if (!this.session?.runtime) return;
        const runtime = this.session.runtime;
        this.legalAreaIds = new Set();
        if (this.selectedNodeId !== null && !this.completed) {
            const parent = runtime.game.getNode(this.selectedNodeId);
            if (parent) {
                this.legalAreaIds = new Set(runtime.ruleEngine.getLegalGrowthAreas(
                    runtime.game, parent, runtime.mapAreas.map(area => area.id),
                    { ownBaseId: runtime.redBaseId, enemyBaseId: runtime.blueBaseId }
                ));
            }
        }
        this.drawer.renderMap(runtime.mapAreas, runtime.redBaseId, runtime.blueBaseId,
            runtime.mapManager.shortEdges || [], this.legalAreaIds, null,
            ['attack', 'combat'].includes(LESSONS[this.index].mode) ? (LESSONS[this.index].mode === 'attack' ? runtime.blueBaseId : runtime.mapManager.adjacency[runtime.redBaseId].find(id => runtime.game.getAliveNodes().some(node => node.owner === 'blue' && node.areaId === id))) : null);
        this.drawer.renderNodes(runtime.game.getAliveNodes(), this.selectedNodeId, [],
            runtime.mapManager.portals);
    }

    handleCanvasClick(event) {
        const lesson = LESSONS[this.index];
        if (this.completed || !['grow', 'combat', 'attack', 'practice'].includes(lesson.mode)) return;
        const point = this.drawer.getLogicalPoint(event.clientX, event.clientY);
        if (!point) return;
        const runtime = this.session.runtime;
        const areaId = runtime.mapManager.getAreaAtPoint(point.x, point.y);
        if (!areaId) return;
        const nodes = runtime.game.getAliveNodes();
        let clickedNode = [...nodes].reverse().find(node =>
            Math.hypot(node.x - point.x, node.y - point.y) <= 22
        );
        // An enemy-occupied legal destination is an attack target, not a selectable parent.
        if (clickedNode && clickedNode.owner !== 'red' && this.selectedNodeId !== null &&
            this.legalAreaIds.has(clickedNode.areaId)) clickedNode = null;
        if (clickedNode) {
            if (clickedNode.owner !== 'red') {
                this.feedback.textContent = '这是蓝方节点。请选择红色己方节点作为生长起点。';
                return;
            }
            this.selectedNodeId = clickedNode.id;
            this.feedback.textContent = '已选中红色节点。现在点击绿色高亮区域。';
            this.render();
            return;
        }
        if (this.selectedNodeId === null) {
            this.feedback.textContent = '请先点击红色根节点。';
            return;
        }
        const result = this.session.performGrowth({
            parentNodeId: this.selectedNodeId,
            targetAreaId: areaId,
            owner: 'red'
        });
        if (!result.ok) {
            this.feedback.textContent = '这一步不合法：' + result.reason + ' 请按提示重新选择。';
            return;
        }
        if (lesson.mode === 'attack' || lesson.mode === 'combat') {
            const defender = nodes.find(node => node.owner === 'blue' && node.areaId === areaId);
            if (defender) {
                const combat = resolveCombat(runtime.game, result.node, defender);
                runtime.game.deleteNodes(combat.nodesToDelete);
                if (combat.freezeTargetId !== null) {
                    const frozen = runtime.game.getNode(combat.freezeTargetId);
                    if (frozen) frozen.isFrozen = true;
                }
                this.feedback.textContent = lesson.mode === 'attack'
                    ? '突入成功！进入敌方基地即可直接获胜。'
                    : '战斗结算完成：目标枝条被摧毁，最近的非根分叉祖先被冻结。';
            }
        } else {
            runtime.game.switchTurn();
            this.feedback.textContent = '生长成功。行动权已切换给蓝方，双方按回合轮流行动。';
        }
        this.selectedNodeId = null;
        this.completed = true;
        this.nextButton.disabled = false;
        this.render();
    }

    advance() {
        if (!this.completed) return;
        if (LESSONS[this.index].mode === 'finish') {
            try { localStorage.removeItem(PROGRESS_KEY); } catch { /* Ignore storage errors. */ }
            this.exit();
            return;
        }
        this.index = Math.min(LESSONS.length - 1, this.index + 1);
        this.saveProgress();
        this.startLesson();
    }

    reset() {
        this.index = 0;
        this.saveProgress();
        this.startLesson();
    }

    exit() {
        this.session?.exit();
        this.session = null;
        this.screen.hidden = true;
        this.onExit?.();
    }
}
