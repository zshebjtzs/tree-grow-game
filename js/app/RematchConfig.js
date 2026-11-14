const MODES = new Set(['pvp', 'pve']);
const DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'expert']);

/** Create a fresh immutable configuration without carrying match state forward. */
export function createRematchConfig(previous) {
    if (!previous || !MODES.has(previous.mode) || !DIFFICULTIES.has(previous.difficulty) || previous.playerSide !== 'red') {
        throw new TypeError('Cannot rematch from an invalid match configuration');
    }
    return Object.freeze({
        mode: previous.mode,
        difficulty: previous.difficulty,
        playerSide: previous.playerSide
    });
}
