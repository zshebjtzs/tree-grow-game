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

test('only the basic growth lesson requires the root as its first parent', () => {
    const node = { owner: 'red', isRoot: false, isDestroyed: false };
    assert.equal(new TutorialLessonEngine({ mode: 'grow' }, scenario).validateParent(node).accepted, false);
    for (const mode of ['combat', 'attack', 'practice']) {
        assert.equal(new TutorialLessonEngine({ mode }, scenario).validateParent(node).accepted, true, mode);
    }
});

test('combat lesson allows a legal strategic deviation and explains the missed objective', () => {
    const engine = new TutorialLessonEngine({ mode: 'combat' }, scenario);
    const result = engine.evaluateAction({
        parentNode: { owner: 'red', isRoot: true },
        targetAreaId: 8,
        ruleResult: { allowed: true }
    });
    assert.equal(result.accepted, true);
    assert.equal(result.strategyDeviation, true);
    assert.match(result.feedback, /蓝方如何回应/);
});

test('attack lesson allows a legal non-base move so the opponent can respond', () => {
    const engine = new TutorialLessonEngine({ mode: 'attack' }, scenario);
    const result = engine.evaluateAction({
        parentNode: { owner: 'red', isRoot: true },
        targetAreaId: 19,
        ruleResult: { allowed: true }
    });
    assert.equal(result.accepted, true);
    assert.equal(result.strategyDeviation, true);
    assert.match(result.feedback, /蓝方将正常回应/);
});

test('combat objective action is not classified as a strategic deviation', () => {
    const engine = new TutorialLessonEngine({ mode: 'combat' }, scenario);
    const result = engine.evaluateAction({
        parentNode: { owner: 'red', isRoot: true },
        targetAreaId: 7,
        ruleResult: { allowed: true }
    });
    assert.equal(result.accepted, true);
    assert.equal(result.strategyDeviation, false);
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
