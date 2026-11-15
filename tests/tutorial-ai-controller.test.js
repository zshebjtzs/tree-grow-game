import test from 'node:test';
import assert from 'node:assert/strict';
import { TutorialAIController } from '../js/tutorial/TutorialAIController.js';

class FakeWorker {
    constructor(url, options) { this.url = url; this.options = options; this.messages = []; this.terminated = false; }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    respond(data) { this.onmessage?.({ data }); }
}

function createRuntime() {
    return {
        game: { toJSON: () => ({ currentTurn: 'blue', nodes: [] }) },
        ruleEngine: { adjacency: { 1: [2] } },
        mapAreas: [{ center: [10, 20] }, { center: [30, 40] }],
        redBaseId: 1,
        blueBaseId: 2
    };
}

test('tutorial AI sends the production worker request schema and forwards decisions', () => {
    let decision = null;
    const controller = new TutorialAIController({ WorkerClass: FakeWorker, onDecision: value => { decision = value; } });
    const requestId = controller.request(createRuntime());
    const request = controller.worker.messages[0];
    assert.equal(request.requestId, requestId);
    assert.equal(request.playerSide, 'blue');
    assert.equal(request.difficulty, 'easy');
    assert.deepEqual(request.areaCenters, [[10, 20], [30, 40]]);
    controller.worker.respond({ requestId, type: 'progress', progress: { phase: 'evaluating' } });
    assert.equal(decision, null);
    controller.worker.respond({ requestId, type: 'decision', parentNodeId: 7, targetAreaId: 9 });
    assert.deepEqual(decision, { parentNodeId: 7, targetAreaId: 9, explanation: null });
    assert.equal(controller.pending, false);
});

test('tutorial AI ignores stale responses after cancellation', () => {
    let decisions = 0;
    const controller = new TutorialAIController({ WorkerClass: FakeWorker, onDecision: () => decisions++ });
    const oldRequestId = controller.request(createRuntime());
    controller.cancel();
    controller.worker.respond({ requestId: oldRequestId, type: 'decision', parentNodeId: 1, targetAreaId: 2 });
    assert.equal(decisions, 0);
    assert.equal(controller.pending, false);
});

test('tutorial AI disposal terminates its dedicated worker and rejects future requests', () => {
    const controller = new TutorialAIController({ WorkerClass: FakeWorker });
    const worker = controller.worker;
    controller.dispose();
    assert.equal(worker.terminated, true);
    assert.throws(() => controller.request(createRuntime()), /已经释放/);
});