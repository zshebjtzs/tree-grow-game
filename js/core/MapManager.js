// js/core/MapManager.js
import * as d3 from 'd3-delaunay';

export class MapManager {
    constructor(canvasWidth, canvasHeight) {
        this.width = canvasWidth;
        this.height = canvasHeight;
        this.areas = [];
        this.voronoi = null;
        this.delaunay = null;
        this.seeds = [];
        this.adjacency = {};
        this.shortEdges = [];
    }

    generateMap(areaCount = 50, iterations = 6) { // 保持 6 次 Lloyd 松弛
        let seeds = [];
        const minDistance = 120;
        let attempts = 0;
        
        while (seeds.length < areaCount && attempts < 1000) {
            attempts++;
            const x = 30 + Math.random() * (this.width - 60);
            const y = 30 + Math.random() * (this.height - 60);
            let tooClose = false;
            for (let s of seeds) {
                const dx = s[0] - x;
                const dy = s[1] - y;
                if (Math.hypot(dx, dy) < minDistance) {
                    tooClose = true;
                    break;
                }
            }
            if (!tooClose) seeds.push([x, y]);
        }

        for (let iter = 0; iter < iterations; iter++) {
            const tempDelaunay = d3.Delaunay.from(seeds);
            const tempVoronoi = tempDelaunay.voronoi([0, 0, this.width, this.height]);
            const polys = tempVoronoi.cellPolygons();
            let newSeeds = [];
            let i = 0;
            for (const polygon of polys) {
                if (polygon.length === 0) { newSeeds.push(seeds[i]); i++; continue; }
                let cx = 0, cy = 0;
                for (let p of polygon) { cx += p[0]; cy += p[1]; }
                newSeeds.push([cx / polygon.length, cy / polygon.length]);
                i++;
            }
            seeds = newSeeds;
        }

        this.seeds = seeds;
        return this.buildMapFromSeeds(seeds);
    }

    loadMapFromSeeds(seeds) {
        this.seeds = seeds;
        return this.buildMapFromSeeds(seeds);
    }

    buildMapFromSeeds(seeds) {
        this.delaunay = d3.Delaunay.from(seeds);
        this.voronoi = this.delaunay.voronoi([0, 0, this.width, this.height]);

        this.areas = [];
        const polys = this.voronoi.cellPolygons();
        let i = 0;
        for (const polygon of polys) {
            this.areas.push({
                id: i + 1,
                vertices: polygon,
                center: seeds[i]
            });
            i++;
        }

        const adj = {};
        this.shortEdges = [];
        
        // 【核心拦截】极短边（隐性接触）和极长边（视觉飞线）双拦截
        const MIN_THRESHOLD = 25; // 低于 10px 的点接触阻断
        const MAX_THRESHOLD = 300; // 高于 300px 的长线飞线阻断（杀死 29->28 这样的情况）

        for (let i = 0; i < this.areas.length; i++) {
            const area = this.areas[i];
            adj[area.id] = [];
            const neighborIndices = this.delaunay.neighbors(i);
            for (const nIdx of neighborIndices) {
                if (!this.areas[nIdx]) continue;
                const neighbor = this.areas[nIdx];
                
                let sharedPoints = [];
                for (let p1 of area.vertices) {
                    for (let p2 of neighbor.vertices) {
                        if (Math.hypot(p1[0]-p2[0], p1[1]-p2[1]) < 1) {
                            sharedPoints.push(p1);
                        }
                    }
                }
                if (sharedPoints.length >= 2) {
                    const p1 = sharedPoints[0];
                    const p2 = sharedPoints[1];
                    const edgeLen = Math.hypot(p1[0]-p2[0], p1[1]-p2[1]);

                    // 阻断 极短边（点接触）
                    if (edgeLen < MIN_THRESHOLD) {
                        this.shortEdges.push({ p1, p2, a1: area.id, a2: neighbor.id });
                        continue; 
                    }
                    // 【新增】阻断 极长边（横跨地图的视觉飞线）
                    if (edgeLen > MAX_THRESHOLD) {
                        this.shortEdges.push({ p1, p2, a1: area.id, a2: neighbor.id });
                        continue;
                    }
                }
                adj[area.id].push(neighbor.id);
            }
        }
        this.adjacency = adj;
        console.log(`【地图生成】已生成 ${this.areas.length} 个区域，已阻断 ${this.shortEdges.length} 条不合理边缘`);
        return this.areas;
    }

    getAreaAtPoint(x, y) {
        const nearestSeedIndex = this.delaunay.find(x, y);
        if (nearestSeedIndex !== undefined && this.areas[nearestSeedIndex]) {
            return this.areas[nearestSeedIndex].id;
        }
        return null;
    }
}