// js/game/GameState.js
import { Node } from './Node.js';

export class GameState {
    constructor() {
        this.nodes = [];
        this.currentTurn = 'red';
        this.nodeIdCounter = 0;
        this.isGameOver = false;
    }

    generateId() { return ++this.nodeIdCounter; }

    addNode(parentId, x, y, areaId, owner) {
        if (this.isGameOver) return null;
        if (parentId !== null && owner !== this.currentTurn) {
            console.warn(`现在是 ${this.currentTurn} 的回合，不能由 ${owner} 操作！`);
            return null;
        }
        const newNode = new Node(this.generateId(), x, y, owner, parentId);
        newNode.areaId = areaId;
        this.nodes.push(newNode);
        if (parentId !== null) {
            const parentNode = this.nodes.find(n => n.id === parentId);
            if (parentNode) parentNode.addChild(newNode.id);
        } else {
            newNode.isRoot = true;
        }
        return newNode;
    }

    getPlayerRootNodes(owner) {
        return this.nodes.filter(n => n.owner === owner && n.isRoot && !n.isDestroyed);
    }

    getAliveNodes() { return this.nodes.filter(n => !n.isDestroyed); }
    getAliveNodesByOwner(owner) { return this.nodes.filter(n => n.owner === owner && !n.isDestroyed); }
    getNode(id) { return this.nodes.find(n => n.id === id); }
    switchTurn() { if (this.isGameOver) return; this.currentTurn = this.currentTurn === 'red' ? 'blue' : 'red'; return this.currentTurn; }

    deleteNodes(nodeIds) {
        const idSet = new Set(nodeIds);
        for (let n of this.nodes) {
            if (!idSet.has(n.id)) {
                n.childrenIds = n.childrenIds.filter(childId => !idSet.has(childId));
            }
        }
        this.nodes = this.nodes.filter(n => !idSet.has(n.id));
    }

    // 【新增】保存当前状态的数据快照
    toJSON() {
        return {
            nodes: this.nodes,
            currentTurn: this.currentTurn,
            nodeIdCounter: this.nodeIdCounter,
            isGameOver: this.isGameOver
        };
    }

    // 【新增】从快照恢复游戏状态
    static fromJSON(data) {
        const state = new GameState();
        // 恢复节点数组，且保留 Node 实例的属性
        state.nodes = data.nodes.map(n => {
            const node = new Node(n.id, n.x, n.y, n.owner, n.parentId);
            Object.assign(node, n); // 把 isRoot, areaId, childrenIds 等全部拷过来
            return node;
        });
        state.currentTurn = data.currentTurn;
        state.nodeIdCounter = data.nodeIdCounter;
        state.isGameOver = data.isGameOver || false;
        return state;
    }
}