// js/ai/AIController.js
import { GameState } from '../game/GameState.js';
import { RuleEngine } from '../game/RuleEngine.js';
import { resolveCombat } from '../game/CombatResolver.js';

const SEARCH_WIDTH = 7;
const WIN_SCORE = 100000;

export class AIController {
    constructor(difficulty = 'medium', adjacency, areaCenters) {
        if (!['easy', 'medium', 'hard'].includes(difficulty)) {
            throw new TypeError('AI 难度无效');
        }
        this.difficulty = difficulty;
        this.adjacency = adjacency || {};
        this.areaCenters = areaCenters || [];
        this.ruleEngine = new RuleEngine({ adjacency: this.adjacency });
    }

    getBestMove(gameStateData, playerSide) {
        if (!['red', 'blue'].includes(playerSide)) {
            throw new TypeError('AI 玩家阵营无效');
        }
        const game = GameState.fromJSON(gameStateData);
        game.currentTurn = playerSide;
        const bases = {
            red: gameStateData.redBaseId,
            blue: gameStateData.blueBaseId
        };
        if (!Number.isInteger(bases.red) || !Number.isInteger(bases.blue) || bases.red === bases.blue) {
            throw new TypeError('AI 基地数据无效');
        }

        const moves = this._generateMoves(game, playerSide, bases);
        if (!moves.length) return null;

        const ranked = moves.map(move => ({
            ...move,
            score: this._scoreMove(game, move, playerSide, bases)
        })).sort((a, b) => b.score - a.score);

        // A legal immediate win is never deliberately ignored, even on easy.
        const winningMove = ranked.find(move => move.targetAreaId === bases[this._enemy(playerSide)]);
        if (winningMove) return this._publicMove(winningMove);

        if (this.difficulty === 'easy') {
            const pool = ranked.slice(0, Math.min(4, ranked.length));
            return this._publicMove(pool[Math.floor(Math.random() * pool.length)]);
        }
        if (this.difficulty === 'medium') {
            return this._publicMove(this._weightedChoice(ranked));
        }
        return this._publicMove(this._searchHard(game, ranked, playerSide, bases));
    }

    _publicMove(move) {
        return {
            parentNodeId: move.parentNodeId,
            targetAreaId: move.targetAreaId,
            x: move.x,
            y: move.y
        };
    }

    _enemy(side) {
        return side === 'red' ? 'blue' : 'red';
    }

    _generateMoves(game, side, bases) {
        const aliveNodes = game.getAliveNodes();
        const occupiedBySide = new Set(game.getAliveNodesByOwner(side).map(node => node.areaId));
        const moves = [];
        for (const parent of game.getAliveNodesByOwner(side)) {
            if (parent.isFrozen) continue;
            const isFirstRootBranch = parent.isRoot && parent.childrenIds.length === 0;
            const targets = isFirstRootBranch
                ? this.areaCenters.map((_, index) => index + 1)
                : (this.adjacency[parent.areaId] || []);
            for (const targetAreaId of targets) {
                if (!this.areaCenters[targetAreaId - 1] || occupiedBySide.has(targetAreaId)) continue;
                const result = this.ruleEngine.canGrow(game, parent, targetAreaId, {
                    ownBaseId: bases[side],
                    enemyBaseId: bases[this._enemy(side)]
                });
                if (!result.allowed) continue;
                const center = this.areaCenters[targetAreaId - 1];
                moves.push({
                    parentNodeId: parent.id,
                    targetAreaId,
                    x: center[0],
                    y: center[1],
                    attacks: aliveNodes.some(node =>
                        node.owner !== side && node.areaId === targetAreaId
                    )
                });
            }
        }
        return moves;
    }

    _distanceToBase(game, side, baseId) {
        const occupied = new Set(game.getAliveNodes().map(node => node.areaId));
        let best = Infinity;
        for (const node of game.getAliveNodesByOwner(side)) {
            const queue = [node.areaId];
            const distance = new Map([[node.areaId, 0]]);
            for (let head = 0; head < queue.length; head++) {
                const current = queue[head];
                const d = distance.get(current);
                if (current === baseId) {
                    best = Math.min(best, d);
                    break;
                }
                for (const next of this.adjacency[current] || []) {
                    if (distance.has(next)) continue;
                    if (occupied.has(next) && next !== baseId) continue;
                    distance.set(next, d + 1);
                    queue.push(next);
                }
            }
        }
        return best;
    }

    _scoreMove(game, move, side, bases) {
        const enemy = this._enemy(side);
        if (move.targetAreaId === bases[enemy]) return WIN_SCORE;

        const beforeDistance = this._distanceToBase(game, side, bases[enemy]);
        const next = this._simulateMove(game, move, side, bases);
        if (!next) return -WIN_SCORE;

        if (next.isGameOver) return next.getPlayerRootNodes(side).length ? WIN_SCORE : -WIN_SCORE;
        const afterDistance = this._distanceToBase(next, side, bases[enemy]);
        const progress = Number.isFinite(beforeDistance) && Number.isFinite(afterDistance)
            ? beforeDistance - afterDistance
            : (Number.isFinite(afterDistance) ? 1 : 0);

        let score = progress * 95;
        if (move.attacks) {
            const beforeEnemyNodes = game.getAliveNodesByOwner(enemy).length;
            const afterEnemyNodes = next.getAliveNodesByOwner(enemy).length;
            score += (beforeEnemyNodes - afterEnemyNodes) * 85;
            const beforeRoots = game.getPlayerRootNodes(enemy).length;
            const afterRoots = next.getPlayerRootNodes(enemy).length;
            score += (beforeRoots - afterRoots) * 900;
        }

        // Reward useful expansion, but keep it subordinate to concrete attacks
        // and progress toward the opposing fortress.
        const ownAreaGain = next.getAliveNodesByOwner(side).length -
            game.getAliveNodesByOwner(side).length;
        score += ownAreaGain * 8;

        const ownThreat = this._distanceToBase(next, enemy, bases[side]);
        if (Number.isFinite(ownThreat)) score -= Math.max(0, 5 - ownThreat) * 24;
        return score;
    }

    _simulateMove(game, move, side, bases) {
        const next = GameState.fromJSON(game.toJSON());
        next.currentTurn = side;
        const parent = next.getNode(move.parentNodeId);
        if (!parent) return null;
        const child = next.addNode(parent.id, move.x, move.y, move.targetAreaId, side);
        if (!child) return null;

        const enemy = this._enemy(side);
        if (move.targetAreaId === bases[enemy]) {
            next.isGameOver = true;
            return next;
        }

        const defender = next.getAliveNodes().find(node =>
            node.id !== child.id && node.owner === enemy && node.areaId === move.targetAreaId
        );
        if (defender) {
            const combat = resolveCombat(next, child, defender);
            if (combat.nodesToDelete.length) next.deleteNodes(combat.nodesToDelete);
            if (combat.freezeTargetId) {
                const frozen = next.getNode(combat.freezeTargetId);
                if (frozen) frozen.isFrozen = true;
            }
        }

        if (!next.getPlayerRootNodes(enemy).length) {
            next.isGameOver = true;
            return next;
        }
        if (!next.getPlayerRootNodes(side).length) {
            next.isGameOver = true;
            return next;
        }

        // Match the live turn transition: the acting side's temporary freezes
        // expire when that side completes its action.
        for (const node of next.getAliveNodesByOwner(side)) node.isFrozen = false;
        next.switchTurn();
        return next;
    }

    _evaluateState(game, perspective, bases) {
        const opponent = this._enemy(perspective);
        const ownRoots = game.getPlayerRootNodes(perspective).length;
        const enemyRoots = game.getPlayerRootNodes(opponent).length;
        if (ownRoots === 0) return -WIN_SCORE;
        if (enemyRoots === 0) return WIN_SCORE;
        if (game.isGameOver) return 0;

        const ownDistance = this._distanceToBase(game, perspective, bases[opponent]);
        const enemyDistance = this._distanceToBase(game, opponent, bases[perspective]);
        const ownNodes = game.getAliveNodesByOwner(perspective).length;
        const enemyNodes = game.getAliveNodesByOwner(opponent).length;

        const distanceValue = distance =>
            Number.isFinite(distance) ? Math.max(-500, 180 - distance * 42) : -260;
        return (distanceValue(ownDistance) - distanceValue(enemyDistance)) +
            (ownNodes - enemyNodes) * 7 +
            (ownRoots - enemyRoots) * 220;
    }

    _searchHard(game, rankedMoves, side, bases) {
        // A bounded two-ply adversarial search: AI action, best opponent reply.
        // Candidate pruning keeps the worker responsive on the 50-area map.
        const candidates = rankedMoves.slice(0, SEARCH_WIDTH);
        let bestMove = candidates[0];
        let bestValue = -Infinity;

        for (const move of candidates) {
            const afterAI = this._simulateMove(game, move, side, bases);
            if (!afterAI) continue;
            if (afterAI.isGameOver) return move;

            const opponent = this._enemy(side);
            const replies = this._generateMoves(afterAI, opponent, bases)
                .map(reply => ({
                    ...reply,
                    score: this._scoreMove(afterAI, reply, opponent, bases)
                }))
                .sort((a, b) => b.score - a.score)
                .slice(0, SEARCH_WIDTH);

            let value;
            if (!replies.length) {
                value = this._evaluateState(afterAI, side, bases);
            } else {
                let worstReply = Infinity;
                for (const reply of replies) {
                    const afterReply = this._simulateMove(afterAI, reply, opponent, bases);
                    const replyValue = afterReply
                        ? this._evaluateState(afterReply, side, bases)
                        : -WIN_SCORE;
                    worstReply = Math.min(worstReply, replyValue);
                }
                value = worstReply;
            }

            // Retain a small amount of the immediate tactical score as a tie-break.
            value += move.score * 0.12;
            if (value > bestValue) {
                bestValue = value;
                bestMove = move;
            }
        }
        return bestMove;
    }

    _weightedChoice(ranked) {
        const top = ranked.slice(0, Math.min(8, ranked.length));
        const floor = Math.min(...top.map(move => move.score));
        const weights = top.map(move => Math.max(1, move.score - floor + 12));
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        let pick = Math.random() * total;
        for (let i = 0; i < top.length; i++) {
            pick -= weights[i];
            if (pick <= 0) return top[i];
        }
        return top[0];
    }
}
