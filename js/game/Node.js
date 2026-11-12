// js/game/Node.js
export class Node {
    constructor(id, x, y, owner, parentId = null) {
        this.id = id;           // 唯一ID
        this.x = x;             // 画布横坐标
        this.y = y;             // 画布纵坐标
        this.owner = owner;     // 所属玩家：'red' 或 'blue'
        this.parentId = parentId; // 父节点ID (根节点为null)
        this.childrenIds = [];  // 子节点ID数组
        this.isRoot = false;    // 是否为根节点
        this.isDestroyed = false; // 是否被摧毁
        this.isFrozen = false; // 是否被冻结
    }

    // 添加子节点
    addChild(childId) {
        if (!this.childrenIds.includes(childId)) {
            this.childrenIds.push(childId);
        }
    }

    // 获取该节点的连接树枝数量（用于后续判断是否 ≥3）
    getDegree() {
        // 连接数 = 子节点数 + (如果有父节点则 +1)
        let degree = this.childrenIds.length;
        if (this.parentId !== null) degree += 1;
        return degree;
    }
}