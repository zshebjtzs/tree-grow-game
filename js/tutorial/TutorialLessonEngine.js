/**
 * Declarative lesson objectives and retry policies.
 * This layer evaluates teaching intent before a legal action mutates the game.
 */
export class TutorialLessonEngine {
    constructor(lesson, scenario) {
        this.lesson = lesson;
        this.scenario = scenario;
    }

    validateParent(parentNode) {
        if (!parentNode || parentNode.owner !== 'red' || parentNode.isDestroyed) {
            return { accepted: false, feedback: '请选择仍然存活的红方节点作为生长起点。' };
        }
        if (this.lesson.mode === 'grow' && !parentNode.isRoot) {
            return {
                accepted: false,
                feedback: '本节先练习从红方根节点开始生长。请重新选择红色根节点。'
            };
        }
        return { accepted: true };
    }

    evaluateAction({ parentNode, targetAreaId, ruleResult }) {
        const parent = this.validateParent(parentNode);
        if (!parent.accepted) return parent;

        // Authoritative game rules take precedence over teaching-objective checks.
        if (ruleResult && !ruleResult.allowed) {
            return {
                accepted: false,
                feedback: '这一步不符合游戏规则：' + ruleResult.reason + ' 请根据提示重新选择。'
            };
        }

        if (this.lesson.mode === 'combat' &&
            targetAreaId !== this.scenario.lessonTargetAreaId) {
            return {
                accepted: true,
                strategyDeviation: true,
                feedback: '这一步在规则上合法，但没有攻击本节指定的蓝方枝条。先观察蓝方如何回应，再寻找完成战斗教学目标的机会。'
            };
        }
        if (this.lesson.mode === 'attack' &&
            targetAreaId !== this.scenario.blueBaseId) {
            return {
                accepted: true,
                strategyDeviation: true,
                feedback: '这一步在规则上合法，但还没有突入蓝方基地。蓝方将正常回应；请根据局面继续寻找突入机会。'
            };
        }
        return { accepted: true, strategyDeviation: false, feedback: null };
    }
}
