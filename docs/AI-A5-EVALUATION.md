# AI A5 棋力评测记录

## A5.1：六档基线锦标赛

评测提交：`64760d74ec55bbf355b78c2b258dd5f9f5f38894`

GitHub Actions：
- PR CI：`44999666139`（success）
- Windows Desktop Build：`44999666166`（success）
- 完整锦标赛产物：`ai-tournament-results`

### 配置

- 难度：beginner、easy、medium、advanced、hard、expert
- 全部 15 组两两对局
- 5 个地图种子
- 每个地图种子红蓝难度互换，各 2 局
- 每组 10 局，共 150 局
- 单局最多 80 plies
- 每组只有 5 个独立配对样本；颜色互换局不能当成独立地图样本

### 全部配对结果

表中胜/和/负均以左侧难度为统计对象。

| 对局 | 胜 | 和 | 负 | 配对得分率 |
|---|---:|---:|---:|---:|
| beginner vs easy | 4 | 0 | 6 | 40% |
| beginner vs medium | 1 | 0 | 9 | 10% |
| beginner vs advanced | 1 | 0 | 9 | 10% |
| beginner vs hard | 2 | 0 | 8 | 20% |
| beginner vs expert | 3 | 0 | 7 | 30% |
| easy vs medium | 3 | 1 | 6 | 35% |
| easy vs advanced | 5 | 1 | 4 | 55% |
| easy vs hard | 1 | 1 | 8 | 15% |
| easy vs expert | 3 | 0 | 7 | 30% |
| medium vs advanced | 4 | 2 | 4 | 50% |
| medium vs hard | 4 | 2 | 4 | 50% |
| medium vs expert | 0 | 5 | 5 | 25% |
| advanced vs hard | 3 | 3 | 4 | 45% |
| advanced vs expert | 0 | 8 | 2 | 40% |
| hard vs expert | 3 | 3 | 4 | 45% |

### 总体结果

- 150 局中，红方获胜 74 局，蓝方获胜 50 局，和棋 26 局。
- 和棋率 17.3%；26 局和棋均由 80-ply 上限结束。
- 平均对局长度 39.9 plies，中位数 30 plies。
- 结果原因：基地入侵 62 局、根节点清除 62 局、达到 ply 上限 26 局。

红方固定为先手，因此红方胜局较多提示先手/阵营因素值得控制，但本批数据不能单独区分先手优势与地图编号、阵营因素。

### 实际搜索工作量

以下是对局过程中每个难度的每次决策耗时均值、节点数均值；时间为共享 CI runner 的观测值，不是浏览器或目标设备延迟承诺。

| 难度 | 平均决策耗时 | 平均搜索节点 |
|---|---:|---:|
| beginner | 0.41 ms | 4 |
| easy | 1.65 ms | 23 |
| medium | 19.14 ms | 283 |
| advanced | 63.16 ms | 987 |
| hard | 337.03 ms | 5,035 |
| expert | 661.42 ms | 9,392 |

完成深度范围分别为 1、2、4、4–5、5–7、5–8。预算确实形成计算量梯度，但不能由此推断胜率也严格递增。

### A5.1 结论

1. beginner 明显弱于中高难度，低端梯度有初步证据。
2. easy、medium、advanced 的相对强度尚未稳定；easy 对 advanced 的得分率反而达到 55%。
3. hard 与 expert 的差异较小；advanced 对 expert 有 8/10 和棋，且这些和棋全部触及 80-ply 上限。
4. 每组仅 5 个独立配对样本，当前结果适合发现异常，不足以校准最终难度强度。
5. 不能直接通过提高高难度预算解决上述问题；需要先提高评测样本有效性，并审查评估函数、先手因素和搜索效果。

### 评测工具统计修正

A5.1 暴露出零方差样本会使 Student-t 区间退化为单点区间的问题。零方差并不意味着真实胜率没有不确定性，因此统计工具改为在零方差时保留均值、将置信区间置空，并明确标记 `zero-variance`；单样本标记为 `insufficient-samples`。

### 后续 A5.2

- 修正 aspiration fail-low / fail-high 后的重搜方式：只扩展失败方向的窗口边界，保留另一侧边界，减少不必要的全窗口重搜。
- 为 aspiration 重搜增加单侧扩窗 telemetry，并通过确定性树、随机树、随机 DAG 与 Alpha-Beta 对照测试验证结果一致性。
- 重新评估多种局面上的重搜率、节点数、耗时和完成深度。
- 之后再进行针对性棋力评测，优先增加相邻难度配对的独立地图样本，并延长 ply 上限；不在证据不足时直接调整六档预算。
