# 交互式教程

交互式教程是 TreeGrow 的独立学习模式。它使用独立的地图、GameState、RuleEngine 和 TutorialSession，不接管正式对局运行时，也不会写入正式对局的自动恢复记录、MatchTracker 或结算统计。

## 教学流程

教程由十节组成，按五个主题组织：

1. **认识棋盘**：区域、基地、节点和父子连接。
2. **基本操作**：选择己方节点、查看合法区域、完成生长、理解回合切换与根节点首次生长规则。
3. **战斗规则**：通过实际突入敌方基地体验攻击入口和胜利条件。
4. **结构与策略**：在预设局面中识别普通分叉、堡垒和冻结节点，并解释攻击回溯规则。
5. **毕业实战**：进行完整的人机对局。玩家执红方，蓝方使用现有简单难度 AI；双方持续轮流行动，直到触发正式胜利条件。胜负结果均可直接继续教程，不强制重开。

每节都提供明确的操作指令。需要操作的章节允许重复尝试；不合法行动由正式 RuleEngine 拒绝，并向玩家解释原因。进度保存在浏览器本地，用户可以从上次章节继续，也可以从头重来。

## 实现约束

- TutorialController 负责教学界面、步骤推进、输入解释、教程回合编排和进度保存；AI Worker 生命周期由 TutorialAIController 独立管理。
- TutorialSession 独立持有教程运行时；重置时从场景定义重新构建状态。
- TutorialScenarioFactory 使用固定种子重建地图，并校验基地、节点区域和坐标引用。
- 所有教学生长行动都通过 TutorialSession.performGrowth()，最终调用共享 executeGrowthAction() 与 RuleEngine。
- 教程战斗演示调用正式 resolveCombat()，不复制战斗判定。
- 教程按需启动独立的 TutorialAIController 和 AI Worker，复用正式 AIWorker.js / AIController，不与正式对局共享 Worker 或全局回合状态。
- 教程 AI 行动通过 TutorialSession.performGrowth() 和共享规则引擎验证；战斗、冻结、回合切换与胜负判定由教程运行时独立处理。
- 教程对局不触发正式对局保存、MatchTracker、自动恢复和结算。退出或切换章节时会取消旧请求；退出教程时终止专用 Worker。
- 教程画布使用独立 Canvas 和 CanvasDrawer，避免改变正常对局地图尺寸或底部面板布局。

## 维护说明

新增教学关卡时，必须同时考虑：可重复重建的场景数据、清晰的玩家目标、错误操作反馈、正式规则验证，以及对应的自动化测试。预设节点必须符合 GameState 的父子关系约束；不要通过直接伪造不一致的节点关系绕过规则。
