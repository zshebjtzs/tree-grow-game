// js/renderer/CanvasDrawer.js
import { calculateCanvasFit, clampPanOffset, calculateZoomOffset } from './Viewport.js';

export class CanvasDrawer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.logicalWidth = this.canvas.width;
        this.logicalHeight = this.canvas.height;
        this.zoom = 1;
        this.fitSize = null;
        this.container = null;
        this.offsetX = 0;
        this.offsetY = 0;
        this.mode = 'locked';
    }

    get isLocked() { return this.mode === 'locked'; }

    setMode(mode) {
        if (mode !== 'locked' && mode !== 'unlocked') throw new TypeError('Viewport mode must be locked or unlocked');
        this.mode = mode;
        this.canvas?.classList?.toggle('is-pan-mode', !this.isLocked);
        return this.mode;
    }

    _displayDimensions() {
        if (!this.fitSize) return { width: 0, height: 0 };
        return { width: this.fitSize.width * this.zoom, height: this.fitSize.height * this.zoom };
    }

    _clampPan() {
        this.offsetX = Number.isFinite(this.offsetX) ? this.offsetX : 0;
        this.offsetY = Number.isFinite(this.offsetY) ? this.offsetY : 0;
        if (!this.container) return;
        const { width, height } = this._displayDimensions();
        this.offsetX = clampPanOffset(this.offsetX, width, this.container.clientWidth);
        this.offsetY = clampPanOffset(this.offsetY, height, this.container.clientHeight);
    }

    _applyDisplaySize() {
        if (!this.fitSize || !this.fitSize.width || !this.fitSize.height) return;
        const { width, height } = this._displayDimensions();
        this.canvas.style.width = `${Math.round(width)}px`;
        this.canvas.style.height = `${Math.round(height)}px`;
        this.canvas.style.maxWidth = 'none';
        this.canvas.style.maxHeight = 'none';
        this._clampPan();
        this.canvas.style.transform = `translate3d(${this.offsetX}px, ${this.offsetY}px, 0)`;
    }

    setZoom(value, anchorX = 0, anchorY = 0) {
        if (!Number.isFinite(value)) throw new TypeError('Zoom must be finite');
        this.offsetX = Number.isFinite(this.offsetX) ? this.offsetX : 0;
        this.offsetY = Number.isFinite(this.offsetY) ? this.offsetY : 0;
        const nextZoom = Math.max(0.5, Math.min(2, value));
        this.offsetX = calculateZoomOffset(this.offsetX, anchorX, this.zoom, nextZoom);
        this.offsetY = calculateZoomOffset(this.offsetY, anchorY, this.zoom, nextZoom);
        this.zoom = nextZoom;
        this._applyDisplaySize();
        return this.zoom;
    }

    setPan(offsetX, offsetY) {
        if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) throw new TypeError('Pan offsets must be finite');
        this.offsetX = offsetX;
        this.offsetY = offsetY;
        this._applyDisplaySize();
        return { x: this.offsetX, y: this.offsetY };
    }

    resetViewport() {
        this.zoom = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this._applyDisplaySize();
    }

    fitToContainer(container) {
        if (!container || !this.canvas) return null;
        this.container = container;
        const fit = calculateCanvasFit(container.clientWidth, container.clientHeight, this.logicalWidth, this.logicalHeight);
        if (fit.width && fit.height) {
            this.fitSize = fit;
            this._applyDisplaySize();
        }
        return fit;
    }

    getLogicalPoint(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return {
            x: (clientX - rect.left) * this.logicalWidth / rect.width,
            y: (clientY - rect.top) * this.logicalHeight / rect.height
        };
    }

    renderMap(areas, redBaseId = null, blueBaseId = null, shortEdges = [], legalAreaIds = new Set(), hoverAreaId = null) {
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

            // Legal destinations receive a translucent teal overlay. Because it is
            // composited over the base fill, red/blue base identity remains visible.
            if (legalAreaIds?.has(area.id)) {
                ctx.fillStyle = 'rgba(25, 178, 145, 0.30)';
                ctx.fill();
            }

            ctx.strokeStyle = area.id === hoverAreaId ? '#087f70' : '#333';
            ctx.lineWidth = area.id === hoverAreaId ? 5 : 2;
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
    renderNodes(nodes, selectedNodeId = null, dyingNodes = [], portals = {}, animationState = null, combatState = null) {
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
                    const growing = animationState?.type === 'growth' && animationState.nodeId === node.id;
                    const progress = growing ? Math.max(0, Math.min(1, animationState.progress)) : 1;
                    ctx.lineTo(parent.x + (node.x - parent.x) * progress, parent.y + (node.y - parent.y) * progress);
                    ctx.strokeStyle = node.owner === 'red' ? '#ff9999' : '#99bbff';
                    ctx.lineWidth = growing ? 4 : 3;
                    if (growing) { ctx.shadowColor = node.owner === 'red' ? '#ff7777' : '#7da4ff'; ctx.shadowBlur = 14; }
                    ctx.stroke();
                    if (growing) ctx.shadowBlur = 0;
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

            const growing = animationState?.type === 'growth' && animationState.nodeId === node.id;
            const progress = growing ? Math.max(0, Math.min(1, animationState.progress)) : 1;
            const eased = 1 - Math.pow(1 - progress, 3);
            ctx.save();
            if (growing) { ctx.globalAlpha = Math.max(0.15, progress); ctx.shadowColor = node.owner === 'red' ? '#ff7777' : '#7da4ff'; ctx.shadowBlur = 16; }
            ctx.beginPath();
            ctx.arc(node.x, node.y, growing ? 12 * eased : 12, 0, Math.PI * 2);
            ctx.fillStyle = node.owner === 'red' ? '#ff4d4d' : '#4d79ff';
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();

            const childCount = node.childrenIds?.length || 0;
            if (!node.isRoot && childCount >= 2) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, childCount >= 3 ? 18 : 16, 0, Math.PI * 2);
                ctx.strokeStyle = childCount >= 3 ? '#d7a744' : '#f0d28a';
                ctx.lineWidth = childCount >= 3 ? 3 : 2;
                ctx.stroke();
                if (childCount >= 3) {
                    ctx.save(); ctx.fillStyle = '#5b4215'; ctx.font = 'bold 9px Arial';
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('堡', node.x, node.y); ctx.restore();
                }
            }
            if (node.isFrozen) this._drawFrozenEffect(node);
        });
        if (combatState?.type === 'combat' && combatState.event) this._drawCombatEffect(combatState);
    }

    _drawCombatEffect(combatState) {
        const ctx = this.ctx;
        const event = combatState.event;
        const progress = Math.max(0, Math.min(1, combatState.progress));
        const pulse = 0.5 + 0.5 * Math.sin(progress * Math.PI * 5);
        const byId = new Map(event.allNodes.map(node => [node.id, node]));
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 0.92 - progress * 0.42;
        ctx.shadowColor = '#ff624f';
        ctx.shadowBlur = 12 + pulse * 10;
        ctx.strokeStyle = '#e84c45';
        ctx.lineWidth = 7 - progress * 2;
        for (const node of event.affectedNodes) {
            if (node.parentId === null) continue;
            const parent = byId.get(node.parentId);
            if (!parent) continue;
            ctx.beginPath(); ctx.moveTo(parent.x, parent.y); ctx.lineTo(node.x, node.y); ctx.stroke();
        }
        for (const node of event.affectedNodes) {
            const radius = Math.max(5, 15 - progress * 5) + pulse * 2;
            ctx.beginPath(); ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(220,65,55,.72)'; ctx.fill();
            ctx.strokeStyle = '#fff0e8'; ctx.lineWidth = 2; ctx.stroke();
        }
        const drawTarget = (node, color, baseRadius) => {
            if (!node) return;
            ctx.globalAlpha = 0.45 + pulse * 0.5;
            ctx.shadowColor = color; ctx.shadowBlur = 18;
            ctx.beginPath(); ctx.arc(node.x, node.y, baseRadius + pulse * 5, 0, Math.PI * 2);
            ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
        };
        drawTarget(event.attacker, '#ffb45d', 19);
        drawTarget(event.defender, '#ff655b', 24);
        if (event.freezeTarget) drawTarget(event.freezeTarget, '#63d9f5', 21);
        ctx.restore();
    }
}
