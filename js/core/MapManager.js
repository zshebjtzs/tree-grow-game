// js/core/MapManager.js
import * as d3 from 'd3-delaunay';

const EPSILON = 1e-6;

function samePoint(a, b, epsilon = 1e-5) {
    return Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon;
}

function sharedBoundary(polyA, polyB) {
    const matches = [];
    for (const a of polyA) {
        if (polyB.some(b => samePoint(a, b))) {
            if (!matches.some(p => samePoint(p, a))) matches.push([a[0], a[1]]);
        }
    }
    if (matches.length < 2) return null;

    // Voronoi cells are convex. The farthest shared vertex pair is the actual
    // common boundary segment; do not infer adjacency from arbitrary pixel lengths.
    let best = null;
    let bestDistance = -1;
    for (let i = 0; i < matches.length; i++) {
        for (let j = i + 1; j < matches.length; j++) {
            const distance = Math.hypot(matches[i][0] - matches[j][0], matches[i][1] - matches[j][1]);
            if (distance > bestDistance) {
                bestDistance = distance;
                best = [matches[i], matches[j]];
            }
        }
    }
    if (!best || bestDistance <= EPSILON) return null;
    return { p1: best[0], p2: best[1], length: bestDistance };
}

function polygonCentroid(polygon) {
    // Polygon area centroid (shoelace), not the arithmetic mean of boundary vertices.
    let twiceArea = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < polygon.length - 1; i++) {
        const [x0, y0] = polygon[i];
        const [x1, y1] = polygon[i + 1];
        const cross = x0 * y1 - x1 * y0;
        twiceArea += cross;
        cx += (x0 + x1) * cross;
        cy += (y0 + y1) * cross;
    }
    if (Math.abs(twiceArea) <= EPSILON) {
        const points = polygon.slice(0, -1);
        return [
            points.reduce((sum, p) => sum + p[0], 0) / points.length,
            points.reduce((sum, p) => sum + p[1], 0) / points.length
        ];
    }
    return [cx / (3 * twiceArea), cy / (3 * twiceArea)];
}

export class MapManager {
    constructor(canvasWidth, canvasHeight) {
        this.width = canvasWidth;
        this.height = canvasHeight;
        this.areas = [];
        this.voronoi = null;
        this.delaunay = null;
        this.seeds = [];
        this.adjacency = {};
        this.portals = {};
        this.shortEdges = [];
    }

    generateMap(areaCount = 50, iterations = 6) {
        let seeds = [];
        const minDistance = Math.min(120, Math.min(this.width, this.height) / Math.sqrt(areaCount) * 0.8);
        let attempts = 0;
        while (seeds.length < areaCount && attempts < areaCount * 100) {
            attempts++;
            const x = 30 + Math.random() * Math.max(1, this.width - 60);
            const y = 30 + Math.random() * Math.max(1, this.height - 60);
            if (seeds.every(s => Math.hypot(s[0] - x, s[1] - y) >= minDistance)) seeds.push([x, y]);
        }
        // A pathological canvas/seed spacing must not produce fewer than requested cells.
        while (seeds.length < areaCount) {
            seeds.push([
                30 + Math.random() * Math.max(1, this.width - 60),
                30 + Math.random() * Math.max(1, this.height - 60)
            ]);
        }

        for (let iter = 0; iter < iterations; iter++) {
            const voronoi = d3.Delaunay.from(seeds).voronoi([0, 0, this.width, this.height]);
            const polygons = Array.from(voronoi.cellPolygons());
            seeds = seeds.map((seed, index) => {
                const polygon = polygons[index];
                return polygon && polygon.length >= 4 ? polygonCentroid(polygon) : seed;
            });
        }
        this.seeds = seeds.map(seed => [...seed]);
        return this.buildMapFromSeeds(this.seeds);
    }

    loadMapFromSeeds(seeds) {
        if (!Array.isArray(seeds) || seeds.length < 2 || !seeds.every(seed =>
            Array.isArray(seed) && seed.length === 2 &&
            Number.isFinite(seed[0]) && Number.isFinite(seed[1]) &&
            seed[0] >= 0 && seed[0] <= this.width &&
            seed[1] >= 0 && seed[1] <= this.height
        )) {
            throw new TypeError('地图种子必须是画布范围内的有限坐标');
        }
        for (let i = 0; i < seeds.length; i++) {
            for (let j = i + 1; j < seeds.length; j++) {
                if (Math.hypot(seeds[i][0] - seeds[j][0], seeds[i][1] - seeds[j][1]) <= EPSILON) {
                    throw new TypeError('地图种子不能重复');
                }
            }
        }
        this.seeds = seeds.map(seed => [...seed]);
        return this.buildMapFromSeeds(this.seeds);
    }

    buildMapFromSeeds(seeds) {
        this.delaunay = d3.Delaunay.from(seeds);
        this.voronoi = this.delaunay.voronoi([0, 0, this.width, this.height]);
        this.areas = Array.from(this.voronoi.cellPolygons(), (polygon, index) => ({
            id: index + 1,
            vertices: polygon,
            center: seeds[index]
        }));

        const adjacency = Object.fromEntries(this.areas.map(area => [area.id, []]));
        const portals = {};
        this.shortEdges = [];
        for (let i = 0; i < this.areas.length; i++) {
            for (const neighborIndex of this.delaunay.neighbors(i)) {
                if (neighborIndex <= i || !this.areas[neighborIndex]) continue;
                const a = this.areas[i];
                const b = this.areas[neighborIndex];
                const edge = sharedBoundary(a.vertices, b.vertices);
                // Delaunay neighbors can meet only at a degenerate point. Such
                // contact has no traversable portal and is intentionally omitted.
                if (!edge) continue;
                adjacency[a.id].push(b.id);
                adjacency[b.id].push(a.id);
                const key = this._portalKey(a.id, b.id);
                portals[key] = { ...edge, a1: a.id, a2: b.id };
            }
        }
        for (const neighbors of Object.values(adjacency)) neighbors.sort((a, b) => a - b);
        this.adjacency = adjacency;
        this.portals = portals;
        console.log(`[地图生成] ${this.areas.length} 个区域，${Object.keys(portals).length} 条共享边界门户`);
        return this.areas;
    }

    _portalKey(a, b) {
        return a < b ? `${a}:${b}` : `${b}:${a}`;
    }

    getPortal(a, b) {
        return this.portals[this._portalKey(a, b)] || null;
    }

    getAreaAtPoint(x, y) {
        if (!this.delaunay || !Number.isFinite(x) || !Number.isFinite(y)) return null;
        const index = this.delaunay.find(x, y);
        return this.areas[index] ? this.areas[index].id : null;
    }
}
