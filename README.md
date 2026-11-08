<p align="center">
  <img src="https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white" alt="HTML5">
  <img src="https://img.shields.io/badge/JavaScript-ES6-F7DF1E?logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/Canvas-2D-000000" alt="Canvas 2D">
  <img src="https://img.shields.io/badge/Web%20Worker-AI-FF6B6B" alt="Web Worker">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License">
</p>

# 生长树：图论 (Growth Tree: Graph Theory)

基于图论拓扑与 Voronoi 地图的离线双人 / 人机策略战棋。

## 功能
- 每局生成 50 个 Voronoi 区域，使用共享边界构建地图邻接关系。
- 双人热座模式与三档启发式 AI 对战。
- 图论规则校验、战斗结算、堡垒防御、连锁摧毁与分支冻结。
- 本地 JSON 存档与恢复。
- 支持 GitHub Pages 在线访问，以及 Windows 本地离线发行包。

## 技术栈
HTML5、CSS3、Canvas 2D、原生 JavaScript ES Modules、Vite 6、d3-delaunay、Web Worker。

## 本地开发
需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

运行测试与生产构建：

```bash
npm test
npm run build
```

## GitHub Pages
仓库配置了 Pages 自动部署工作流。代码合并到 `main` 后，GitHub Actions 会先运行测试，再构建并发布 `dist/`。首次使用时，在仓库 Settings → Pages 中将 Build and deployment source 设置为 GitHub Actions。

## Windows 离线发行
推送形如 `v1.0.0` 的 tag 会触发离线发行工作流。工作流运行测试、构建生产文件，并创建 `tree-grow-game-windows-offline.zip` Release 资产。

用户解压后运行 `Start-Game.ps1`，脚本通过本机回环地址启动静态 HTTP 服务。游戏运行不需要网络、Node.js 或 Python。不要直接双击 `dist/index.html`，因为浏览器会限制 file:// 下的模块和 Worker 加载。

## 项目结构
```
tree-grow-game/
├── .github/workflows/   # CI、Pages 与离线发行
├── css/                 # 样式
├── js/                  # AI、地图、规则、状态与渲染
├── scripts/             # Windows 离线启动脚本
├── index.html
├── package.json
└── vite.config.js
```

## 许可证
MIT License，详见 [LICENSE](./LICENSE)。

## 致谢
感谢 B 站 UP 主“浩辰-_-”原创纸上游戏《生长树》提供核心玩法灵感，以及 d3-delaunay 等开源项目。
