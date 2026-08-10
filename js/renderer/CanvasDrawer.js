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
            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i][0], pts[i][1]);
            }
            ctx.closePath();
            
            // 基地高亮填充色
            if (area.id === redBaseId) ctx.fillStyle = 'rgba(255, 0, 0, 0.25)'; // 红基地淡红
            else if (area.id === blueBaseId) ctx.fillStyle = 'rgba(0, 0, 255, 0.25)'; // 蓝基地淡蓝
            else ctx.fillStyle = '#f8f9fa'; // 普通区域底色
            ctx.fill();
            
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 2;
            ctx.stroke();
        });

        // ==========================================
        // 【新增】在填充完所有区域后，绘制极短边阻断红线
        // ==========================================
        ctx.save();
        ctx.strokeStyle = '#ff0000'; // 醒目的警告红
        ctx.lineWidth = 4;           // 加粗线条，形成视觉上的阻断感
        for (let edge of shortEdges) {
            ctx.beginPath();
            ctx.moveTo(edge.p1[0], edge.p1[1]);
            ctx.lineTo(edge.p2[0], edge.p2[1]);
            ctx.stroke();
        }
        ctx.restore();
        // ==========================================

        // 根据区域大小动态调整字号并标记区域ID
        areas.forEach(area => {
            const pts = area.vertices;
            if (pts.length < 3) return;
            
            let maxDist = 0;
            const cx = area.center[0];
            const cy = area.center[1];
            for (let p of pts) {
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
    
    // 第三个参数：dyingNodes（即将被摧毁的节点列表）
    renderNodes(nodes, selectedNodeId = null, dyingNodes = []) {
        const ctx = this.ctx;
        const alive = nodes.filter(n => !n.isDestroyed);

        // ==========================================
        // 1. 优先绘制【死亡特效】
        // ==========================================
        if (dyingNodes && dyingNodes.length > 0) {
            ctx.save();
            ctx.shadowColor = '#ff0000';
            ctx.shadowBlur = 25;

            // 绘制红色的死亡连线
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

            // 绘制闪烁发光的死亡节点
            const pulse = 1 + 0.3 * Math.sin(Date.now() / 150); // 脉动效果
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

        // ==========================================
        // 2. 绘制正常存活的节点和连线
        // ==========================================
        alive.forEach(node => {
            if (node.parentId !== null) {
                const parent = alive.find(n => n.id === node.parentId);
                if (parent) {
                    ctx.beginPath();
                    ctx.moveTo(parent.x, parent.y);
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
        });
    }
}