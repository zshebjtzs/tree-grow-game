// js/renderer/CanvasDrawer.js
export class CanvasDrawer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
    }

    renderMap(areas, redBaseId = null, blueBaseId = null, shortEdges = []) {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // 画背景网格
        ctx.strokeStyle = '#eee';
        ctx.lineWidth = 1;
        for (let i = 0; i < this.canvas.width; i += 50) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, this.canvas.height); ctx.stroke();
        }
        for (let i = 0; i < this.canvas.height; i += 50) {
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(this.canvas.width, i); ctx.stroke();
        }

        areas.forEach(area => {
            const pts = area.vertices;
            if (pts.length < 3) return;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();

            if (area.id === redBaseId) ctx.fillStyle = 'rgba(255, 0, 0, 0.25)';
            else if (area.id === blueBaseId) ctx.fillStyle = 'rgba(0, 0, 255, 0.25)';
            else ctx.fillStyle = '#f8f9fa';
            ctx.fill();

            ctx.strokeStyle = '#333';
            ctx.lineWidth = 2;
            ctx.stroke();
        });

        ctx.save();
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 4;
        for (const edge of shortEdges) {
            ctx.beginPath();
            ctx.moveTo(edge.p1[0], edge.p1[1]);
            ctx.lineTo(edge.p2[0], edge.p2[1]);
            ctx.stroke();
        }
        ctx.restore();

        areas.forEach(area => {
            const pts = area.vertices;
            if (pts.length < 3) return;
            let maxDist = 0;
            const cx = area.center[0];
            const cy = area.center[1];
            for (const p of pts) {
                const dist = Math.hypot(p[0] - cx, p[1] - cy);
                if (dist > maxDist) maxDist = dist;
            }
            const fontSize = Math.min(16, Math.max(10, maxDist * 0.6));
            ctx.fillStyle = '#333';
            ctx.font = `${fontSize}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`区域 ${area.id}`, area.center[0], area.center[1]);
        });
    }

    _getPortalRoute(startAreaId, endAreaId, portals) {
        if (startAreaId === endAreaId) return [];
        const adjacency = {};
        for (const portal of Object.values(portals || {})) {
            if (!portal || !Number.isInteger(portal.a1) || !Number.isInteger(portal.a2)) continue;
            (adjacency[portal.a1] ||= []).push({ areaId: portal.a2, portal });
            (adjacency[portal.a2] ||= []).push({ areaId: portal.a1, portal });
        }
        const queue = [startAreaId];
        const previous = new Map([[startAreaId, null]]);
        for (let head = 0; head < queue.length; head++) {
            const current = queue[head];
            for (const next of adjacency[current] || []) {
                if (previous.has(next.areaId)) continue;
                previous.set(next.areaId, { areaId: current, portal: next.portal });
                if (next.areaId === endAreaId) {
                    const route = [];
                    let cursor = endAreaId;
                    while (cursor !== startAreaId) {
                        const step = previous.get(cursor);
                        route.push(step.portal);
                        cursor = step.areaId;
                    }
                    return route.reverse();
                }
                queue.push(next.areaId);
            }
        }
        return null;
    }

    _drawFrozenEffect(node) {
        const ctx = this.ctx;
        ctx.save();

        // Frost halo: translucent fill keeps the original red/blue owner color visible.
        ctx.beginPath();
        ctx.arc(node.x, node.y, 18, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(128, 223, 255, 0.22)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(128, 223, 255, 0.98)';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#80dfff';
        ctx.shadowBlur = 10;
        ctx.stroke();

        // Small vector snowflake badge, independent of platform emoji fonts.
        const bx = node.x + 14;
        const by = node.y - 14;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(bx, by, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#eafaff';
        ctx.fill();
        ctx.strokeStyle = '#299ac5';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.strokeStyle = '#168bb8';
        ctx.lineWidth = 1.25;
        ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
            const angle = i * Math.PI / 3;
            const dx = Math.cos(angle) * 4.2;
            const dy = Math.sin(angle) * 4.2;
            ctx.beginPath();
            ctx.moveTo(bx - dx, by - dy);
            ctx.lineTo(bx + dx, by + dy);
            ctx.stroke();
            for (const direction of [-1, 1]) {
                const ex = bx + dx * direction;
                const ey = by + dy * direction;
                const branchAngle = angle * 2 + Math.PI / 2;
                ctx.beginPath();
                ctx.moveTo(ex, ey);
                ctx.lineTo(ex - Math.cos(branchAngle) * 1.8 * direction, ey - Math.sin(branchAngle) * 1.8 * direction);
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    // 第三个参数：dyingNodes（即将被摧毁的节点列表）
    renderNodes(nodes, selectedNodeId = null, dyingNodes = [], portals = {}) {
        const ctx = this.ctx;
        const alive = nodes.filter(n => !n.isDestroyed);

        if (dyingNodes && dyingNodes.length > 0) {
            ctx.save();
            ctx.shadowColor = '#ff0000';
            ctx.shadowBlur = 25;
            dyingNodes.forEach(node => {
                if (node.parentId !== null) {
                    const parent = alive.find(n => n.id === node.parentId);
                    if (parent) {
                        ctx.beginPath();
                        ctx.moveTo(parent.x, parent.y);
                        ctx.lineTo(node.x, node.y);
                        ctx.strokeStyle = '#ff3333';
                        ctx.lineWidth = 5;
                        ctx.stroke();
                    }
                }
            });
            const pulse = 1 + 0.3 * Math.sin(Date.now() / 150);
            dyingNodes.forEach(node => {
                ctx.beginPath();
                ctx.arc(node.x, node.y, 16 * pulse, 0, Math.PI * 2);
                ctx.fillStyle = '#ff0000';
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 3;
                ctx.stroke();
            });
            ctx.restore();
        }

        alive.forEach(node => {
            if (node.parentId !== null) {
                const parent = alive.find(n => n.id === node.parentId);
                if (parent) {
                    const route = this._getPortalRoute(parent.areaId, node.areaId, portals);
                    ctx.beginPath();
                    ctx.moveTo(parent.x, parent.y);
                    if (route && route.length) {
                        const first = route[0];
                        ctx.lineTo((first.p1[0] + first.p2[0]) / 2, (first.p1[1] + first.p2[1]) / 2);
                        for (let i = 1; i < route.length; i++) {
                            const edge = route[i];
                            ctx.lineTo((edge.p1[0] + edge.p2[0]) / 2, (edge.p1[1] + edge.p2[1]) / 2);
                        }
                    }
                    ctx.lineTo(node.x, node.y);
                    ctx.strokeStyle = node.owner === 'red' ? '#ff9999' : '#99bbff';
                    ctx.lineWidth = 3;
                    ctx.stroke();
                }
            }
        });

        alive.forEach(node => {
            if (selectedNodeId === node.id) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, 20, 0, Math.PI * 2);
                ctx.strokeStyle = node.owner === 'red' ? '#ff0000' : '#0000ff';
                ctx.lineWidth = 3;
                ctx.stroke();
            }

            ctx.beginPath();
            ctx.arc(node.x, node.y, 12, 0, Math.PI * 2);
            ctx.fillStyle = node.owner === 'red' ? '#ff4d4d' : '#4d79ff';
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            if (node.isFrozen) this._drawFrozenEffect(node);
        });
    }
}
