import test from 'node:test';
import assert from 'node:assert/strict';
import { TutorialLessonEngine } from '../js/tutorial/TutorialLessonEngine.js';

const scenario = { blueBaseId: 20, lessonTargetAreaId: 7 };

test('grow lesson accepts a legal action from the red root', () => {
    const engine = new TutorialLessonEngine({ mode: 'grow' }, scenario);
    const result = engine.evaluateAction({
        parentNode: { owner: 'red', isRoot: true },
        targetAreaId: 3,
        ruleResult: { allowed: true }
    });
    assert.equal(result.accepted, true);
});

test('operational lessons reject non-root parents with retry feedback', () => {
    for (const mode of ['grow', 'combat', 'attack']) {
        const engine = new TutorialLessonEngine({ mode }, scenario);
        const result = engine.validateParent({ owner: 'red', isRoot: false });
        assert.equal(result.accepted, false, mode);
        assert.match(result.feedback, /根节点/);
    }
});

test('combat lesson rejects a legal but irrelevant target without mutating the game', () => {
    const engine = new TutorialLessonEngine({ mode: 'combat' }, scenario);
    const result = engine.evaluateAction({
        parentNode: { owner: 'red', isRoot: true },
        targetAreaId: 8,
        ruleResult: { allowed: true }
    });
    assert.equal(result.accepted, false);
    assert.match(result.feedback, /战斗回溯/);
});

test('attack lesson only accepts the enemy base as its teaching objective', () => {
    const engine = new TutorialLessonEngine({ mode: 'attack' }, scenario);
    assert.equal(engine.validateTarget(19).accepted, false);
    assert.equal(engine.validateTarget(20).accepted, true);
});

test('rule-invalid actions are rejected with the authoritative rule reason', () => {
    const engine = new TutorialLessonEngine({ mode: 'grow' }, scenario);
    const result = engine.evaluateAction({
        parentNode: { owner: 'red', isRoot: true },
        targetAreaId: 3,
        ruleResult: { allowed: false, reason: '该节点本回合被冻结' }
    });
    assert.equal(result.accepted, false);
    assert.match(result.feedback, /该节点本回合被冻结/);
});
