import test from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../js/app/AppState.js';

test('application starts at the main menu', () => {
    const app = new AppState();
    assert.equal(app.screen, 'menu');
    assert.equal(app.matchConfig, null);
});

test('setup navigation does not create a match', () => {
    const app = new AppState();
    assert.equal(app.openSetup(), 'setup');
    assert.equal(app.matchConfig, null);
});

test('starting a match stores an immutable configuration snapshot', () => {
    const app = new AppState();
    const config = { mode: 'pve', difficulty: 'hard', playerSide: 'red' };
    const saved = app.startMatch(config);
    config.difficulty = 'easy';
    assert.equal(app.screen, 'game');
    assert.equal(saved.difficulty, 'hard');
    assert.equal(Object.isFrozen(saved), true);
});

test('invalid match configurations are rejected', () => {
    const app = new AppState();
    assert.throws(() => app.startMatch({ mode: 'coop', difficulty: 'hard', playerSide: 'red' }), TypeError);
    assert.throws(() => app.startMatch({ mode: 'pvp', difficulty: 'expert', playerSide: 'red' }), TypeError);
});

test('returning to the menu does not mutate the match configuration', () => {
    const app = new AppState();
    app.startMatch({ mode: 'pvp', difficulty: 'medium', playerSide: 'red' });
    app.returnToMenu();
    assert.equal(app.screen, 'menu');
    assert.equal(app.matchConfig.mode, 'pvp');
});

test('result screen is a valid application navigation state', () => {
    const app = new AppState();
    app.startMatch({ mode: 'pvp', difficulty: 'medium', playerSide: 'red' });
    assert.equal(app.navigate('result'), 'result');
    assert.equal(app.screen, 'result');
    assert.throws(() => app.navigate('unknown'), TypeError);
});