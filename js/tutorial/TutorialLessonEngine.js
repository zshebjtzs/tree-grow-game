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
        if (!parentNode || parentNode.owner !== 'red') {
            return { accepted: false, feedback: '请选择红方自己的节点作为生长起点。' };
        }
        if (!parentNode.isRoot) {
            return {
                accepted: false,
                feedback: '本节要求从红方根节点开始操作。请重新选择红色根节点。'
            };
        }
        return { accepted: true };
    }

    validateTarget(targetAreaId) {
        if (this.lesson.mode === 'combat' &&
            targetAreaId !== this.scenario.lessonTargetAreaId) {
            return {
                accepted: false,
                feedback: '这个目标无法展示本节要学习的战斗回溯效果。请攻击地图上高亮的蓝方枝条。'
            };
        }
        if (this.lesson.mode === 'attack' &&
            targetAreaId !== this.scenario.blueBaseId) {
            return {
                accepted: false,
                feedback: '本节目标是突入蓝方基地。普通区域或蓝方枝条都不能完成这个目标，请选择蓝色基地。'
            };
        }
        return { accepted: true };
    }

    evaluateAction({ parentNode, targetAreaId, ruleResult }) {
        const parent = this.validateParent(parentNode);
        if (!parent.accepted) return parent;

        const target = this.validateTarget(targetAreaId);
        if (!target.accepted) return target;

        if (ruleResult && !ruleResult.allowed) {
            return {
                accepted: false,
                feedback: '这一步不符合游戏规则：' + ruleResult.reason + ' 请根据提示重新选择。'
            };
        }
        return { accepted: true, feedback: null };
    }
}
