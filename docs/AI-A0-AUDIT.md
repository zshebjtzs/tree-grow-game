# AI A0：现状审计与棋力基线

状态：A0 基线、A1 统一架构和 A2 六档扩展均已完成当前轮 CI 验证；真实棋力梯度仍待大样本锦标赛校准。

审计基准：`main`，提交 `fb49e70d844a1c2687c23a68ec902603e4c3a387`（2026-11-22）。

## 1. A0 范围

本阶段只建立现状认知和评测能力，不调整正式 AI 的选招行为、评估权重或难度参数。

审计文件：

- `js/ai/DifficultyProfiles.js`
- `js/ai/AIController.js`
- `js/ai/AIWorker.js`
- `js/ai/SearchEngine.js`
- `js/ai/PositionEvaluator.js`
- `js/ai/TacticalAnalyzer.js`
- `js/ai/PositionKey.js`
- `js/game/GameState.js`
- `js/game/RuleEngine.js`
- `js/game/CombatResolver.js`
- `js/ai/AIController.test.js`
- `js/ai/SearchEngine.test.js`
- `scripts/benchmark-ai.js`
- `.github/workflows/ci.yml`

## 2. 当前四档决策架构

| 难度 | 决策方式 | 主要配置 |
|---|---|---|
| easy / 简单 | 静态评分后从前 4 个候选中随机选择 | 不进行多回合搜索 |
| medium / 普通 | 静态评分后对前 8 个候选加权随机选择 | 不进行多回合搜索 |
| hard / 困难 | 迭代加深 Alpha-Beta / PVS | width 7、depth 7、700ms、30,000 nodes |
| expert / 专家 | 迭代加深 Alpha-Beta / PVS | width 10、depth 8、1,200ms、60,000 nodes |

所有难度都会执行立即获胜检测和紧急防守筛选。因此，低难度不是完全没有战术意识；其主要差别是候选选择策略和是否进入多回合搜索。

当前搜索运行于 Web Worker。搜索是同步执行，但有时间和节点预算；Worker 消息事件不能在同步搜索过程中插入执行，因此不能把“发送取消消息”当作中断机制。

## 3. 搜索引擎审计

### 已有能力

- 迭代加深：只提交完整完成的深度结果。
- Alpha-Beta 剪枝。
- PVS 窄窗口试探与必要时重搜。
- 置换表：记录深度、上下界类型、估值和最佳着法。
- 置换表最佳着法优先排序。
- 搜索时间预算和节点预算。
- 无合法行动时通过 Pass 处理回合切换。
- 搜索进度回调异常不会改变搜索结果。

### 发现的问题

#### A0-F01：根节点候选行动在深搜前被静态截断

位置：`AIController._searchHard()`

当前流程先将所有候选行动按 `scoreMove` 排序，再执行：

```js
const rootMoves = rankedMoves.slice(0, this.profile.searchWidth);
```

因此，困难只搜索静态排名前 7 个根行动，专家只搜索前 10 个。其余合法行动完全不会进入多回合搜索。

影响：静态评估一旦低估某个需要多步铺垫的行动，搜索无法纠正该误判。这是搜索覆盖率问题，不是简单增加深度或预算就能解决的问题。

建议：A1/A4 设计根层完整候选搜索及其性能控制策略。不要在 A0 直接扩大范围，以免改变当前基线。

#### A0-F02：置换表局面键遗漏根节点首次生长历史

位置：`js/ai/PositionKey.js`

`GameState` 中的 `hasUsedRootGrowth` 是持久化规则状态。根节点首次生长后，即使其后代被摧毁，该标记仍保持为 true；它直接决定该根能否再次生长。

当前局面键包含行动方、节点计数器、游戏结束状态、节点 ID、归属、父子关系、区域、根标记、摧毁状态和冻结状态，但没有编码 `hasUsedRootGrowth`。

影响：对于节点计数器和当前存活结构相同、但根首次生长历史不同的两个局面，理论上可能生成相同 key，而其合法行动集合不同。置换表可能复用不适用于当前局面的搜索结果。

建议：A1 修复局面键并添加回归测试。不能仅依赖当前节点是否还有子节点推导该标记，因为后代可能已经被摧毁。

#### A0-F03：PVS 正确性测试覆盖面仍有限

当前 `SearchEngine.test.js` 有确定性树上的 PVS 与全窗口 Alpha-Beta 对照；`benchmark-ai.js` 也会在三个固定局面上比较 hard/expert 的 PVS 与 Alpha-Beta 结果。

这能发现一部分回归，但不能证明所有复杂局面下 PVS 都与全窗口搜索一致。A4 应增加随机生成的小型博弈树穷举对照，以及真实 TreeGrow 局面差分测试。

#### A0-F04：置换表键和搜索模拟必须共同维护状态完备性

`GameState.clone()` 会复制根首次生长标记；搜索模拟也使用真实 `RuleEngine`、`resolveCombat` 和回合冻结处理。这一方向正确，但状态键必须与模拟状态字段同步演进。未来每增加影响合法行动或评估的持久状态，都必须审查 `PositionKey`。

## 4. 规则与战术边界审计

当前正式 AI 的行动生成和模拟使用正式规则模块，而不是独立复制一套战斗规则：

- `RuleEngine.canGrow()` 校验根节点首次生长、冻结、路径、区域占用和堡垒限制。
- `CombatResolver` 负责父链回溯、分支保护与级联删除。
- `AIController._simulateMove()` 先处理进入敌方基地的胜利，再处理战斗；随后检查双方根节点是否归零，并执行行动方冻结清理和回合切换。
- `TacticalAnalyzer` 检查立即获胜行动，并通过临时切换行动方统计对手立即获胜威胁；使用 `finally` 恢复原行动方。

现有固定测试已覆盖：立即获胜、紧急基地威胁防守、堡垒不可攻击、冻结节点无行动、根节点首次生长、根枝被摧毁后不能重新生长、战斗后防守方冻结状态保留，以及搜索 Pass。

仍缺少系统性的战术局面集，尤其是复杂级联摧毁、多个根同时受威胁、结构保护与基地竞速冲突、以及不同搜索深度下的选择稳定性。

## 5. 现有性能基准

`scripts/benchmark-ai.js` 是性能基准，不是棋力锦标赛。

固定局面：

- sparse
- branching
- combat

采样方式：

- 每个局面预热 5 次。
- 每个局面/难度执行 40 次。
- 记录均值、P50、P95、最大耗时、节点数和完成深度。
- hard/expert 对照 PVS 与关闭 PVS 的 Alpha-Beta，并检查选招、估值和完成深度一致。

CI 当前顺序为：

1. `npm test`
2. `npm run benchmark:replay`
3. `npm run benchmark:ai`
4. `npm run build`
5. `npm run verify:pages`

注意：CI 的 Node.js 基准不等于浏览器 Worker 端到端延迟，也不等于用户目标设备性能。不能把单次共享 CI 机器的毫秒值设为硬性门槛。

## 6. 新增对局评测工具

新增 `scripts/tournament-ai.js`，并增加命令：

```bash
npm run tournament:ai
```

工具特性：

- 对 easy、medium、hard、expert 进行两两对战。
- 使用可复现的伪随机地图拓扑和随机选择种子。
- 支持指定地图种子、配对局数、最大 ply 和指定难度配对。
- 配对局按红蓝双方交换难度位置。
- 统计胜、负、和、得分率及 95% 区间估计。
- 同时记录各方决策耗时、P50/P95、节点数和完成深度。
- 输出完整 JSON，便于后续保存、比较和分析。

示例：

```bash
# 小规模冒烟测试
npm run tournament:ai -- --seed-count 1 --pair-games 1 --max-plies 40 --only easy:medium,hard:expert

# 扩大样本
npm run tournament:ai -- --seed-count 10 --pair-games 2 --max-plies 120
```

注意：小规模冒烟测试只验证对局流程和报告生成，不足以得出可靠棋力结论。正式比较应扩大种子数，并结合先手交换、置信区间和真人测试。得分率区间是样本统计摘要，不应被解释为对所有地图的保证。

## 7. A0 结论与后续优先级

当前主要问题不是缺少搜索算法，而是搜索覆盖、状态键完备性和棋力评测体系仍不充分。

建议优先级：

1. A1：修复 `PositionKey` 对 `hasUsedRootGrowth` 的遗漏，并增加回归测试。
2. A1：重新设计根层候选覆盖，避免静态评分在搜索前永久排除关键行动。
3. A1：统一四档决策框架，明确低难度行为差异与战术硬约束的边界。
4. A2：在统一搜索框架后增加 beginner / advanced。
5. A3：逐项实验结构性评估指标。
6. A4：利用 tournament 结果校准预算，并继续验证 PVS、置换表和搜索优化。

## 8. 基线数据状态

### CI 验证结果

基于提交 `bd41ef505822749cf2899c3326bbf736dfcac86e` 的 GitHub Actions：

- `npm test`：211 项通过，0 失败。
- `benchmark:replay`：通过。
- `benchmark:ai`：通过。
- `npm run build`：通过。
- `verify:pages`：通过，验证 4 个构建资源且 AI Worker 存在。
- Windows Desktop Build：工作流完成，结论 success。

### AI 性能基准

环境：GitHub Actions Ubuntu，Node.js v20.20.2，x64；每个固定局面预热 5 次、采样 40 次。以下为 sparse 局面的代表性结果：

| 难度 / 搜索方式 | 平均耗时 | P95 耗时 | 平均节点数 | 完成深度 |
|---|---:|---:|---:|---:|
| hard / Alpha-Beta | 84.311 ms | 95.660 ms | 4,916 | 7 |
| hard / PVS | 68.412 ms | 83.190 ms | 3,993 | 7 |
| expert / Alpha-Beta | 432.436 ms | 469.322 ms | 13,987 | 8 |
| expert / PVS | 346.745 ms | 386.056 ms | 11,264 | 8 |

在该局面中，PVS 相比 Alpha-Beta：hard 平均耗时下降约 18.9%，节点数下降约 18.8%；expert 平均耗时下降约 19.8%，节点数下降约 19.5%，完成深度保持一致。

这只是固定局面、固定 CI 机器上的性能对照，不代表真实对局棋力提升，也不能作为目标设备延迟承诺。branching 和 combat 局面的数据仍保存在对应 CI 日志中。

### 棋力基线状态

`tournament:ai` 已在 CI 执行小规模冒烟：easy/medium 与 hard/expert 各 2 局，共 4 局，单局上限 20 ply。该测试确认对局推进、红蓝交换和 JSON 报告流程正常；样本局均在 4 ply 内结束，结果受地图先后手结构影响，样本量也不足以比较棋力。当前仍没有可引用的正式四档 AI 棋力基线。不得将冒烟结果或性能基准误写为棋力结论。

后续应在 A1/A2 的架构改动前后使用相同地图种子、配对局数、红蓝交换和 ply 上限进行对照，并保留完整 JSON。


## 9. A1 首轮架构改造（进行中）

基于 A0 审计发现，A1 已完成以下代码调整，尚待当前提交的 CI 验证：

1. **修复局面键状态遗漏**：`PositionKey` 现在编码每个根节点的 `hasUsedRootGrowth`。即使根枝已被摧毁、子节点列表为空，历史状态不同的局面也不会错误共享置换表条目。新增 `PositionKey.test.js` 覆盖该回归场景及 clone 稳定性。
2. **取消静态根候选硬截断**：搜索入口接收全部已通过规则验证的根候选，不再用静态评分前 N 名直接排除其他合法行动。候选仍按启发式评分排序，搜索预算由迭代加深、时间和节点上限控制。
3. **统一现有四档决策流程**：easy、medium、hard、expert 均经过同一战术筛选、位置评估和 `SearchEngine` 搜索流程；移除 easy 的前四项随机选择和 medium 的加权随机选择。
4. **统一评估权重**：四档共享相同的评估权重，差异仅由搜索深度、时间预算和节点预算体现。当前预算为 easy（2 ply / 50 ms / 1,500 nodes）、medium（4 / 150 ms / 6,000）、hard（7 / 700 ms / 30,000）、expert（8 / 1,200 ms / 60,000）。
5. 将原仅供 hard/expert 使用的内部入口重命名为通用 `_search`。
6. 新增 `TreeGrowAIAdapter`，将状态创建、基地校验、合法行动生成、模拟生长/战斗/Pass、位置键、距离缓存、评估器、战术分析、决策解释和对外行动映射收口到 TreeGrow 适配器。控制器负责通用决策流程；`SearchEngine` 通过 `isTerminal` 与 `getSideToMove` 回调读取状态，不再假定状态必须具有 TreeGrow 的字段结构。
7. Worker 的难度校验改为读取 `DIFFICULTY_LEVELS`，避免与难度配置维护两份列表。
8. 新增 `AIAdapterRegistry`，Worker 请求支持可选 `mode` 字段，缺省为 `tree-grow`；当前只注册 TreeGrow 适配器，未来模式只需增加适配器实现并注册工厂，不在共享控制器/搜索器中添加模式分支。

A1 当前仍需重点验证：低预算档在较高分支数局面是否能稳定完成至少一层搜索；全根候选搜索对 hard/expert 的耗时和完成深度影响；不同预算是否形成可观测、稳定的棋力梯度；适配器接口是否覆盖未来模式所需的全部状态操作。不能仅凭预算大小推断难度排序成立。

CI 已执行 4 局冒烟测试，但尚未执行完整锦标赛，也没有改造前后的真实胜率对照。

## 10. A2 六档难度扩展（进行中）

在 A1 统一决策流程的基础上，新增 `beginner`（入门）与 `advanced`（进阶），现有 easy、medium、hard、expert ID 保持不变，以兼容已有存档与回放。

| 难度 | 标签 | 最大深度 | 时间预算 | 节点预算 |
|---|---|---:|---:|---:|
| beginner | 入门 | 1 | 25 ms | 500 |
| easy | 简单 | 2 | 50 ms | 1,500 |
| medium | 普通 | 4 | 150 ms | 6,000 |
| advanced | 进阶 | 5 | 300 ms | 12,000 |
| hard | 困难 | 7 | 700 ms | 30,000 |
| expert | 专家 | 8 | 1,200 ms | 60,000 |

六档共享相同评估权重、战术约束和搜索算法，仅预算不同。难度排序仍是待锦标赛验证的假设，而不是由配置值自动保证的事实。UI 难度选择器、Worker 校验、AI 性能基准和锦标赛配对列表均改为支持六档；难度列表由 `DIFFICULTY_LEVELS` 统一提供，旧难度 ID 不变。

### A2 CI 验证

最新 CI 提交 `6a809c6e4cc85286c2103f34cd3d7e47514380c4`：220 项测试通过，0 失败；AI 性能基准、六档锦标赛冒烟、构建、Pages 验证均通过；Windows Desktop Build 通过。

### 六档性能样本（sparse 局面）

环境仍为 GitHub Actions Ubuntu / Node.js v20.20.2 / x64；每档预热 5 次、采样 40 次。下表使用 PVS：

| 难度 | 平均耗时 | 平均节点数 | 完成深度 |
|---|---:|---:|---:|
| beginner | 0.317 ms | 9 | 1 |
| easy | 1.178 ms | 31 | 2 |
| medium | 7.740 ms | 436 | 4 |
| advanced | 12.232 ms | 871 | 5 |
| hard | 66.975 ms | 4,366 | 7 |
| expert | 262.754 ms | 9,601 | 8 |

hard/expert 的 Alpha-Beta 与 PVS 选招、估值、完成深度差分校验通过。上述数据说明预算梯度在该固定局面上确实形成了不同搜索深度，但不等于棋力梯度已经得到证明。
