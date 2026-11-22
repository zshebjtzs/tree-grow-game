import { DIFFICULTY_LEVELS } from '../ai/DifficultyProfiles.js';

const MODES = new Set(['pvp', 'pve']);
const DIFFICULTIES = new Set(DIFFICULTY_LEVELS);

/** Create a fresh immutable configuration without carrying match state forward. */
export function createRematchConfig(previous) {
    if (!previous || !MODES.has(previous.mode) || !DIFFICULTIES.has(previous.difficulty) ||
        !['red', 'blue'].includes(previous.playerSide) ||
        (previous.mode === 'pvp' && previous.playerSide !== 'red')) {
        throw new TypeError('Cannot rematch from an invalid match configuration');
    }
    return Object.freeze({
        mode: previous.mode,
        difficulty: previous.difficulty,
        playerSide: previous.playerSide
    });
}
