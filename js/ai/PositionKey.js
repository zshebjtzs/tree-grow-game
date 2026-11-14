// js/ai/PositionKey.js
/**
 * Build a compact search key without allocating a JSON snapshot.
 *
 * Coordinates are intentionally omitted: AI legality and evaluation depend on
 * area ownership/topology, not rendered node positions. Node IDs, parent/child
 * links, frozen state, turn and the ID counter are retained because they can
 * affect future legal actions or tree structure.
 */
export function getPositionKey(state) {
    let key = `${state.currentTurn}|${state.nodeIdCounter}|${state.isGameOver ? 1 : 0}|`;
    for (const node of state.nodes) {
        key += node.id + ','
            + (node.owner === 'red' ? 'r' : 'b') + ','
            + (node.parentId ?? 0) + ','
            + node.areaId + ','
            + (node.isRoot ? 1 : 0)
            + (node.isDestroyed ? 1 : 0)
            + (node.isFrozen ? 1 : 0) + ',';
        for (const childId of node.childrenIds) key += childId + '.';
        key += ';';
    }
    return key;
}
