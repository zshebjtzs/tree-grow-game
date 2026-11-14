const ownerLabel = owner => owner === 'red' ? '红方' : '蓝方';
const snapshot = node => ({ id:node.id,x:node.x,y:node.y,owner:node.owner,parentId:node.parentId,areaId:node.areaId,isRoot:node.isRoot,childrenIds:[...node.childrenIds] });

/** Presentation-only snapshot. Rule outcomes remain exclusively owned by CombatResolver. */
export function createCombatEvent(gameState, attacker, defender, result) {
    if (!gameState || !attacker || !defender || !result || !Array.isArray(result.nodesToDelete)) {
        throw new TypeError('战斗事件需要完整的规则结算结果');
    }
    let outcome, title, description;
    const degree = defender.getDegree();
    if (degree > 3) {
        outcome='fortress-repel'; title='堡垒防御成功';
        description=`${ownerLabel(defender.owner)}的堡垒节点连接度为 ${degree}，成功抵御入侵；进攻节点被摧毁，防守结构保留。`;
    } else if (defender.childrenIds.length >= 2) {
        outcome='branch-destroyed'; title='分叉节点被摧毁';
        description=`${ownerLabel(defender.owner)}的非堡垒分叉节点遭到攻击，该节点及其全部后代被一并摧毁。`;
    } else {
        let cursor=defender.parentId===null?null:gameState.getNode(defender.parentId), nearestBranch=null;
        while(cursor){if(cursor.childrenIds.length>=2){nearestBranch=cursor;break;}cursor=cursor.parentId===null?null:gameState.getNode(cursor.parentId);}
        if(nearestBranch){
            outcome='branch-cut'; title='目标枝被切断';
            description=`攻击沿父链追溯至最近分叉点 #${nearestBranch.id}，目标子枝及其后代被切断；分叉点保留${result.freezeTargetId?'并进入冻结状态':''}。`;
        }else{
            outcome='tree-destroyed'; title='整棵防守树被摧毁';
            description='目标节点向上找不到可保留的分叉点，防守方这棵树的全部节点被摧毁。';
        }
    }
    const allNodes=gameState.getAliveNodes().map(snapshot), byId=new Map(allNodes.map(n=>[n.id,n]));
    const affectedNodes=result.nodesToDelete.map(id=>byId.get(id)).filter(Boolean);
    const freezeTarget=result.freezeTargetId?byId.get(result.freezeTargetId)||null:null;
    const meta=`摧毁节点：${affectedNodes.length} 个${freezeTarget?` · 冻结节点：#${freezeTarget.id}`:''}`;
    return Object.freeze({
        type:'combat',outcome,title,description,meta,
        attacker:Object.freeze(byId.get(attacker.id)||snapshot(attacker)),
        defender:Object.freeze(byId.get(defender.id)||snapshot(defender)),
        freezeTarget:freezeTarget?Object.freeze(freezeTarget):null,
        affectedNodes:Object.freeze(affectedNodes.map(n=>Object.freeze(n))),
        allNodes:Object.freeze(allNodes.map(n=>Object.freeze(n)))
    });
}
