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
        if (!['red', 'blue'].includes(owner) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(areaId) || areaId < 1) {
            console.warn('拒绝创建参数无效的节点。');
            return null;
        }
        if (parentId !== null && owner !== this.currentTurn) {
            console.warn(`现在是 ${this.currentTurn} 的回合，不能由 ${owner} 操作！`);
            return null;
        }
        const parentNode = parentId === null ? null : this.nodes.find(n => n.id === parentId && !n.isDestroyed);
        if (parentId !== null && (!parentNode || parentNode.owner !== owner)) {
            console.warn('拒绝创建节点：父节点不存在、已摧毁或属于另一方。');
            return null;
        }
        const newNode = new Node(this.generateId(), x, y, owner, parentId);
        newNode.areaId = areaId;
        this.nodes.push(newNode);
        if (parentId !== null) {
            parentNode.addChild(newNode.id);
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
    switchTurn() {
        if (this.isGameOver) return;
        // Frozen nodes remain unavailable until their owner completes a full turn.
        this.currentTurn = this.currentTurn === 'red' ? 'blue' : 'red';
        return this.currentTurn;
    }

    deleteNodes(nodeIds) {
        // Deleting a node must also delete every descendant.
        const byId = new Map(this.nodes.map(node => [node.id, node]));
        const idSet = new Set();
        const stack = [...nodeIds];

        while (stack.length > 0) {
            const id = stack.pop();
            if (idSet.has(id)) continue;
            const node = byId.get(id);
            if (!node) continue;
            idSet.add(id);
            for (const childId of node.childrenIds) stack.push(childId);
        }

        for (const node of this.nodes) {
            if (!idSet.has(node.id)) {
                node.childrenIds = node.childrenIds.filter(childId => !idSet.has(childId));
            }
        }
        this.nodes = this.nodes.filter(node => !idSet.has(node.id));
        return [...idSet];
    }

    // Return a detached, JSON-safe snapshot. Callers may validate or modify it
    // without gaining a mutable reference to the live game state.
    toJSON() {
        return {
            nodes: this.nodes.map(node => ({
                id: node.id,
                x: node.x,
                y: node.y,
                owner: node.owner,
                parentId: node.parentId,
                childrenIds: [...node.childrenIds],
                isRoot: node.isRoot,
                isDestroyed: node.isDestroyed,
                isFrozen: node.isFrozen,
                areaId: node.areaId
            })),
            currentTurn: this.currentTurn,
            nodeIdCounter: this.nodeIdCounter,
            isGameOver: this.isGameOver
        };
    }

    static fromJSON(data) {
        if (!data || !Array.isArray(data.nodes) ||
            !['red', 'blue'].includes(data.currentTurn) ||
            !Number.isInteger(data.nodeIdCounter) || data.nodeIdCounter < 0 ||
            typeof data.isGameOver !== 'boolean') {
            throw new TypeError('存档游戏状态字段无效');
        }

        const ids = new Set();
        for (const raw of data.nodes) {
            if (!raw || !Number.isInteger(raw.id) || raw.id < 1 || ids.has(raw.id) ||
                !Number.isFinite(raw.x) || !Number.isFinite(raw.y) ||
                !Number.isInteger(raw.areaId) || raw.areaId < 1 ||
                !['red', 'blue'].includes(raw.owner) ||
                !(raw.parentId === null || (Number.isInteger(raw.parentId) && raw.parentId > 0)) ||
                !Array.isArray(raw.childrenIds) ||
                typeof raw.isRoot !== 'boolean' || typeof raw.isDestroyed !== 'boolean' ||
                typeof raw.isFrozen !== 'boolean') {
                throw new TypeError('存档包含无效节点');
            }
            ids.add(raw.id);
        }

        if (data.nodes.some(node => node.id > data.nodeIdCounter)) {
            throw new TypeError('存档节点编号超过计数器');
        }

        const byId = new Map(data.nodes.map(node => [node.id, node]));
        for (const raw of data.nodes) {
            const visited = new Set([raw.id]);
            let parentId = raw.parentId;
            while (parentId !== null) {
                if (visited.has(parentId)) throw new TypeError('存档节点存在循环父链');
                visited.add(parentId);
                const parent = byId.get(parentId);
                if (!parent) break;
                parentId = parent.parentId;
            }
        }
        for (const raw of data.nodes) {
            if (raw.isRoot !== (raw.parentId === null)) {
                throw new TypeError('存档根节点与父节点关系不一致');
            }
            if (raw.parentId !== null) {
                const parent = byId.get(raw.parentId);
                if (!parent || parent.owner !== raw.owner || parent.isDestroyed ||
                    !parent.childrenIds.includes(raw.id)) {
                    throw new TypeError('存档父子节点关系无效');
                }
            }
            const childSet = new Set();
            for (const childId of raw.childrenIds) {
                if (!Number.isInteger(childId) || childId < 1 || childId === raw.id || childSet.has(childId)) {
                    throw new TypeError('存档子节点列表无效');
                }
                childSet.add(childId);
                const child = byId.get(childId);
                if (!child || child.parentId !== raw.id || child.owner !== raw.owner) {
                    throw new TypeError('存档子节点引用无效');
                }
            }
            if (raw.isFrozen && raw.isDestroyed) {
                throw new TypeError('已摧毁节点不能处于冻结状态');
            }
        }

        const state = new GameState();
        state.nodes = data.nodes.map(raw => {
            const node = new Node(raw.id, raw.x, raw.y, raw.owner, raw.parentId);
            Object.assign(node, raw, { childrenIds: [...raw.childrenIds] });
            return node;
        });
        state.currentTurn = data.currentTurn;
        state.nodeIdCounter = data.nodeIdCounter;
        state.isGameOver = data.isGameOver;
        return state;
    }
}
