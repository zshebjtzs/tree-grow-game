const SIDE_LABELS = { red: '红方', blue: '蓝方' };

export function formatReplaySide(side, { mode = 'pvp', playerSide = 'red' } = {}) {
    const label = SIDE_LABELS[side] || '未知方';
    if (mode !== 'pve') return label;
    return label + (side === playerSide ? ' · 玩家' : ' · AI');
}

export function formatReplayAction(action, context = {}) {
    const side = formatReplaySide(action.side, context);
    const data = action.action;
    if (data.type === 'skip') {
        return { title: side + '跳过回合', detail: '本步没有产生地图变化', type: 'skip' };
    }
    return {
        title: side + (data.isAttack ? '发起攻击' : '生长节点'),
        detail: `区域 ${data.targetAreaId} · 父节点 #${data.parentNodeId} · 新节点 #${data.nodeId}`,
        type: 'growth'
    };
}

export function formatReplayEvent(event, context = {}) {
    const side = formatReplaySide(event.side, context);
    switch (event.type) {
        case 'GROWTH':
            return { title: side + (event.isAttack ? '发起区域攻击' : '完成生长'), detail: `进入区域 #${event.areaId}` };
        case 'COMBAT':
            return { title: side + `触发战斗 · 摧毁 ${event.destroyedNodes} 个节点`, detail: event.outcome || '战斗结算完成' };
        case 'FREEZE':
            return { title: side + '的节点被冻结', detail: `节点 #${event.nodeId}` };
        case 'ROOT_DESTROYED':
            return { title: side + '根节点被摧毁', detail: `损失 ${event.count} 个，剩余 ${event.remaining} 个` };
        case 'VICTORY':
            return { title: side + '获胜', detail: event.reason === 'enemy_base_reached' ? '成功突入敌方基地' : '摧毁对方全部根节点' };
        default:
            return { title: side + '发生事件', detail: event.type };
    }
}
