// js/core/MapManager.js
export class MapManager {
    constructor(canvasWidth, canvasHeight) {
        this.width = canvasWidth;
        this.height = canvasHeight;
        this.areas = [];
        this.voronoi = null;
        this.delaunay = null;
        this.seeds = []; // 【新增】记录种子点，用于读档恢复
    }

    // 随机生成地图
    generateMap(areaCount = 16) {
        const seeds = [];
        const minDistance = 150;
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
            if (!tooClose) {
                seeds.push([x, y]);
            }
        }
        this.seeds = seeds; // 【新增】保存种子
        return this.buildMapFromSeeds(seeds);
    }

    // 【新增】根据种子点重新构建地图（用于读档）
    loadMapFromSeeds(seeds) {
        this.seeds = seeds;
        return this.buildMapFromSeeds(seeds);
    }

    // 提取地图构建逻辑
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
        console.log(`【地图重建】已还原 ${this.areas.length} 个区域`);
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