import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplayNavigationState } from '../js/replay/ReplayNavigationState.js';

test('rapid next requests advance from the latest requested step, not the committed session step', () => {
    const navigation = new ReplayNavigationState();
    const first = navigation.request(navigation.getBaseStep(28) + 1, 28, 100);
    const second = navigation.request(navigation.getBaseStep(28) + 1, 28, 100);
    const third = navigation.request(navigation.getBaseStep(28) + 1, 28, 100);

    assert.deepEqual(first, { fromStep: 28, target: 29, changed: true });
    assert.deepEqual(second, { fromStep: 29, target: 30, changed: true });
    assert.deepEqual(third, { fromStep: 30, target: 31, changed: true });
    assert.equal(navigation.getBaseStep(28), 31);
});

test('a reverse request replaces a pending forward target', () => {
    const navigation = new ReplayNavigationState();
    navigation.request(29, 28, 100);

    const reverse = navigation.request(navigation.getBaseStep(28) - 1, 28, 100);
    assert.deepEqual(reverse, { fromStep: 29, target: 28, changed: true });
    assert.equal(navigation.getBaseStep(28), 28);
});

test('duplicate requests do not replace or restart the active target', () => {
    const navigation = new ReplayNavigationState();
    navigation.request(29, 28, 100);

    const duplicate = navigation.request(29, 28, 100);
    assert.deepEqual(duplicate, { fromStep: 29, target: 29, changed: false });
    assert.equal(navigation.getBaseStep(28), 29);
});

test('navigation clamps at both ends and can be reset after a completed seek', () => {
    const navigation = new ReplayNavigationState();
    assert.deepEqual(navigation.request(-1, 0, 10), { fromStep: 0, target: 0, changed: false });
    assert.deepEqual(navigation.request(99, 9, 10), { fromStep: 9, target: 10, changed: true });
    navigation.clear();
    assert.equal(navigation.getBaseStep(9), 9);
    assert.deepEqual(navigation.request(10, 9, 10), { fromStep: 9, target: 10, changed: true });
});
