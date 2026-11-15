import { createTutorialScenario } from './TutorialScenarioFactory.js';
import { executeGrowthAction } from '../game/GrowthActionService.js';

function cloneJsonData(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        throw new TypeError('教学场景必须是可序列化的 JSON 数据');
    }
}

/**
 * Owns one isolated tutorial run. Reset rebuilds the map and game state from
 * the original scenario definition; exit detaches the runtime completely.
 */
export class TutorialSession {
    constructor(scenario, options = {}) {
        this.scenarioDefinition = cloneJsonData(scenario);
        this.options = { ...options };
        this.status = 'idle';
        this.runtime = null;
        this.actions = [];
        this.reset();
    }

    reset() {
        this.runtime = createTutorialScenario(this.scenarioDefinition, this.options);
        this.actions = [];
        this.status = 'active';
        return this.runtime;
    }

    performGrowth({ parentNodeId, targetAreaId, owner }) {
        if (this.status !== 'active' || !this.runtime) {
            return { ok: false, reason: '教学会话当前未处于活动状态' };
        }

        const result = executeGrowthAction({
            gameState: this.runtime.game,
            ruleEngine: this.runtime.ruleEngine,
            mapAreas: this.runtime.mapAreas,
            parentNodeId,
            targetAreaId,
            owner,
            ownBaseId: owner === 'red' ? this.runtime.redBaseId : this.runtime.blueBaseId,
            enemyBaseId: owner === 'red' ? this.runtime.blueBaseId : this.runtime.redBaseId
        });

        if (result.ok) this.actions.push({ ...result.action, path: [...result.action.path] });
        return result;
    }

    exit() {
        this.status = 'ended';
        this.runtime = null;
        this.actions = [];
    }
}
