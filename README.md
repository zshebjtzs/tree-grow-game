# 生长树：图论

**生长树：图论（Growth Tree: Graph Theory）** 是一款以图论拓扑和树形扩张为核心的浏览器策略游戏。玩家在随机生成的区域地图上建立根节点，通过持续生长枝条扩张势力，并利用节点之间的树形结构进行进攻、防守与战斗。

游戏支持本地双人对战和人机对战。它将地图区域之间的连接关系抽象为图，将玩家的势力组织为树，并以此构成一套强调空间规划、分支管理和攻防取舍的策略玩法。

**在线游玩：** https://zshebjtzs.github.io/tree-grow-game/

> **详细规则：** 本文只介绍游戏概念与软件实现。开局流程、节点生长限制、战斗结算、冻结机制及胜负条件等完整规则，请阅读 **[《游戏规则说明》](./GAME-RULES.md)**。

## 核心玩法

每局游戏都会生成一张由多个区域组成的地图。区域之间是否能够直接通行，取决于它们是否共享有效边界；因此，地图不仅是视觉上的区域拼图，也是一张用于判断扩张路径的无向图。

双方分别以自己的基地为起点建立树形势力。每个节点代表一个据点，父子关系代表枝条连接。玩家需要在有限的行动节奏中规划扩张方向：既要寻找通往对方基地的路线，也要考虑己方分支的结构是否容易受到攻击。

当新节点进入对方占据的区域时，会触发基于树形结构的战斗结算。战斗结果可能影响一整段分支，而不只是单个据点。因此，扩张规模、分支形态、关键连接点的保护，以及进攻时机，都是策略决策的一部分。

游戏提供两种模式：

- **双人对战（PVP）**：两名玩家在同一设备上轮流操作。
- **人机对战（PVE）**：玩家与 AI 对手进行对局，可选择简单、普通或困难三档难度。

## 功能概览

- **程序化地图**：每局生成 50 个 Voronoi 区域，并根据区域共享边界建立地图邻接关系。
- **树形势力系统**：使用节点及父子关系表达双方的据点与枝条结构。
- **拓扑规则校验**：在执行生长前检查节点状态、区域连通性、占用情况及生长距离。
- **结构化战斗结算**：根据防守节点及其上游分支结构计算摧毁范围和冻结效果。
- **三档 AI 对手**：从启发式决策到有限深度的对抗搜索，提供不同强度的挑战。
- **本地存档**：将对局状态和地图生成数据保存为文件，并在读取时验证数据结构。
- **在线与离线运行**：支持 GitHub Pages 在线访问，并提供 Windows 本地离线发行包。

## 游戏实现

项目采用浏览器原生技术实现，没有引入前端框架或后端服务。游戏状态、规则判断、地图拓扑、AI 决策和画布渲染被拆分为独立模块，由主入口负责协调。

### 地图与拓扑

地图由 `d3-delaunay` 生成。程序先在画布范围内生成种子点，再通过 Voronoi 图划分区域，并迭代调整种子点以改善区域分布。

地图构建阶段会进一步检查区域多边形的共享边界，并据此生成邻接表和边界门户数据。规则引擎使用邻接表执行路径搜索和合法性判断；渲染器则使用门户数据绘制跨区域枝条。

### 游戏状态与规则

- `GameState` 管理当前回合、节点集合、节点编号及对局结束状态，并提供经过校验的 JSON 存档恢复能力。
- `Node` 表示一个据点，保存所属阵营、父节点、子节点以及冻结状态等信息。
- `RuleEngine` 负责路径搜索和生长合法性检查。
- `CombatResolver` 根据节点树结构计算战斗造成的节点移除范围和冻结目标。

规则计算与画面表现分离：战斗模块返回结算结果，主流程再负责执行状态变更、动画和回合切换。

### AI 与异步执行

AI 由独立的 `AIController` 实现，并运行在浏览器 Web Worker 中，避免搜索计算阻塞主线程。

- **简单**：根据启发式评分，从排名靠前的候选行动中随机选择。
- **普通**：根据候选行动评分进行加权选择。
- **困难**：在启发式筛选基础上进行有界的两层对抗搜索，评估 AI 行动及对手的最佳回应。

Worker 返回的行动不会直接修改游戏状态。主线程会检查请求编号、返回数据格式、节点和区域是否仍然有效，并再次调用规则引擎验证行动，验证通过后才会执行。

### 渲染与交互

游戏使用 HTML Canvas 2D 绘制地图区域、区域编号、枝条、节点及状态效果。HTML 负责模式选择、难度设置、回合提示和存读档等界面控件；原生 JavaScript 处理用户输入与游戏流程。

### 存档

存档采用 JSON 数据格式，保存地图种子、双方基地、当前回合、节点树、模式和 AI 难度等信息。读档时先在临时对象中重建地图并校验节点引用和父子关系，只有验证成功后才替换当前对局，避免损坏的存档污染正在进行的游戏。

## 技术栈

| 技术 | 用途 |
| --- | --- |
| HTML5 | 页面结构与交互控件 |
| CSS3 | 页面布局与视觉样式 |
| JavaScript ES Modules | 游戏逻辑与模块组织 |
| Canvas 2D | 地图、节点和枝条渲染 |
| `d3-delaunay` | Delaunay 三角剖分与 Voronoi 区域生成 |
| Web Worker | 在后台线程执行 AI 决策 |
| Vite 6 | 本地开发服务器与生产构建 |
| Node.js 20+ | 开发、测试和构建环境 |

## 本地开发

需要安装 **Node.js 20 或更高版本**。

```bash
git clone https://github.com/zshebjtzs/tree-grow-game.git
cd tree-grow-game
npm install
npm run dev
```

Vite 启动后会在终端显示本地访问地址。

### 测试与生产构建

```bash
npm test
npm run build
```

- `npm test`：运行基于 Node.js 内置测试运行器的自动化测试。
- `npm run build`：生成用于部署的生产文件，输出目录为 `dist/`。
- `npm run preview`：在本地预览生产构建结果。

## 部署与发行

### GitHub Pages

仓库通过 GitHub Actions 自动执行测试、生产构建和 Pages 部署。将变更合并到 `main` 后，部署工作流会构建项目并发布 `dist/`。

首次启用 Pages 时，需要在仓库 **Settings → Pages** 中将 **Build and deployment → Source** 设置为 **GitHub Actions**。

### Windows 离线发行

项目提供两种 Windows 离线运行方式，均可在下载并解压后使用：

**方式一：浏览器离线版**

1. 打开仓库的 [Releases 页面](https://github.com/zshebjtzs/tree-grow-game/releases/latest)。
2. 在最新版本的 Assets 中下载 `tree-grow-game-windows-offline.zip`。
3. 解压后运行 `Start-Game.ps1`。脚本会启动仅监听本机回环地址的静态 HTTP 服务，并打开浏览器。

该方式不需要安装 Node.js 或 Python，游戏运行时也不需要互联网连接。不要直接双击 `dist/index.html`：浏览器对 `file://` 页面中的 ES Modules 和 Web Worker 有加载限制，应通过启动脚本提供的本地 HTTP 地址访问。

**方式二：原生 Windows 桌面版**

1. 打开仓库的 [Actions 页面](https://github.com/zshebjtzs/tree-grow-game/actions/workflows/windows-desktop.yml)，进入最近一次成功的 **Windows Desktop Build** 工作流运行记录。
2. 在该运行记录页面底部的 **Artifacts** 区域，下载 `TreeGrow-Windows-x64`。
3. 解压后运行 `TreeGrow.exe`。必须保持 `www/` 文件夹与 `TreeGrow.exe` 位于同一目录。
4. 目标电脑需要预先安装 **Microsoft Edge WebView2 Evergreen Runtime**。该系统运行时不包含在 ZIP 中。

桌面版不需要 Node.js、Python 或本地 HTTP 服务；完成启动后，游戏可离线运行。工作流产物有保留期限，若无法下载，请查看更新的成功构建记录或等待对应版本的桌面版资产发布到 Releases。

版本发行在功能分支合并到 `main` 后进行。推送形如 `v1.1.0` 的版本标签会触发离线发行工作流，自动测试、构建并将浏览器离线版 ZIP 发布到 GitHub Release。桌面版 ZIP 由 Windows Desktop Build 工作流生成；在对应版本发行时，应将成功构建得到的 `TreeGrow-Windows-x64.zip` 一并附加到该 GitHub Release。

## 项目结构

```text
tree-grow-game/
├── .github/
│   └── workflows/          # CI、GitHub Pages 与离线发行工作流
├── css/
│   └── style.css           # 页面样式
├── js/
│   ├── ai/                 # AI 控制器与 Worker
│   ├── core/               # 地图生成及拓扑数据
│   ├── game/               # 游戏状态、节点、规则与战斗结算
│   ├── renderer/            # Canvas 2D 渲染
│   └── main.js              # 游戏入口与流程协调
├── scripts/
│   └── Start-Game.ps1      # Windows 离线启动脚本
├── tests/                   # 集成测试
├── GAME-RULES.md            # 完整游戏规则
├── README-OFFLINE.txt       # 离线发行包使用说明
├── index.html               # 页面入口
├── package.json             # 依赖与 npm 脚本
└── vite.config.js           # Vite 构建配置
```

## 许可证

本项目采用 [MIT License](./LICENSE)。

## 致谢

感谢 B 站 UP 主 **“浩辰-_-”** 的原创纸上游戏《生长树》提供核心玩法灵感；地图生成使用了开源项目 [d3-delaunay](https://github.com/d3/d3-delaunay)。
