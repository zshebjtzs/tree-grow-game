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

test('default browser Worker uses the statically analyzable production worker entry', () => {
    const originalWorker = globalThis.Worker;
    globalThis.Worker = FakeWorker;
    try {
        const controller = new TutorialAIController();
        assert.ok(controller.worker.url instanceof URL);
        assert.match(controller.worker.url.href, /js\/ai\/AIWorker\.js$/);
        assert.equal(controller.worker.options.type, 'module');
        controller.dispose();
    } finally {
        globalThis.Worker = originalWorker;
    }
});

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

test('tutorial AI reports worker failures with available location details and permits a later request', () => {
    const errors = [];
    const controller = new TutorialAIController({
        WorkerClass: FakeWorker,
        onError: error => errors.push(error)
    });
    const firstRequestId = controller.request(createRuntime());
    controller.worker.onerror({ message: 'worker crashed', filename: 'https://example.test/worker.js', lineno: 42 });
    assert.deepEqual(errors, ['worker crashed (https://example.test/worker.js:42)']);
    assert.equal(controller.pending, false);

    const secondRequestId = controller.request(createRuntime());
    assert.ok(secondRequestId > firstRequestId);
    controller.dispose();
});

test('production AI can make a legal blue response after a red practice move', async () => {
    const { AIController } = await import('../js/ai/AIController.js');
    const { TutorialSession } = await import('../js/tutorial/TutorialSession.js');
    const { buildScenario } = await import('../js/tutorial/TutorialController.js');
    const session = new TutorialSession(buildScenario('practice', 'tutorial-ai-practice'));
    const runtime = session.runtime;
    const redRoot = runtime.game.getPlayerRootNodes('red')[0];
    const legalAreas = runtime.ruleEngine.getLegalGrowthAreas(
        runtime.game,
        redRoot,
        runtime.mapAreas.map(area => area.id),
        { ownBaseId: runtime.redBaseId, enemyBaseId: runtime.blueBaseId }
    );
    const targetAreaId = legalAreas.find(areaId =>
        !runtime.game.getAliveNodes().some(node => node.areaId === areaId)
    );
    assert.ok(targetAreaId, 'red should have an empty legal growth area');

    const redAction = session.performGrowth({
        parentNodeId: redRoot.id,
        targetAreaId,
        owner: 'red'
    });
    assert.equal(redAction.ok, true);
    runtime.game.switchTurn();
    assert.equal(runtime.game.currentTurn, 'blue');

    const ai = new AIController(
        'easy',
        runtime.ruleEngine.adjacency,
        runtime.mapAreas.map(area => area.center)
    );
    const move = ai.getBestMove({
        ...runtime.game.toJSON(),
        redBaseId: runtime.redBaseId,
        blueBaseId: runtime.blueBaseId
    }, 'blue');

    assert.ok(move, 'blue AI should find a response');
    const parent = runtime.game.getNode(move.parentNodeId);
    assert.ok(parent);
    assert.equal(parent.owner, 'blue');
    const validation = runtime.ruleEngine.canGrow(runtime.game, parent, move.targetAreaId, {
        ownBaseId: runtime.blueBaseId,
        enemyBaseId: runtime.redBaseId
    });
    assert.equal(validation.allowed, true);
    session.exit();
});
