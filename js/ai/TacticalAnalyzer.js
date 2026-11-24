// js/ai/TacticalAnalyzer.js
/**
 * Tactical pattern detection over legal moves and authoritative simulations.
 * Opponent replies are generated and simulated once per position so immediate
 * wins and structural losses share the same authoritative result.
 */
export class TacticalAnalyzer {
    findImmediateWinningMove(moves, side, bases) {
        const enemy = side === 'red' ? 'blue' : 'red';
        const enemyBaseId = bases[enemy];
        return moves.find(move =>
            move.targetAreaId === enemyBaseId ||
            (move._nextState?.isGameOver &&
                move._nextState.getPlayerRootNodes(enemy).length === 0 &&
                move._nextState.getPlayerRootNodes(side).length > 0)
        ) || null;
    }

    analyzeOpponentReplies(game, defenderSide, attackerSide, bases, generateMoves, simulateMove) {
        const risk = {
            immediateWinningMoves: 0,
            rootLossReplies: 0,
            maxRootLoss: 0,
            maxNodeLoss: 0,
            maxCascadeLoss: 0
        };
        const beforeNodes = game.getAliveNodesByOwner(defenderSide);
        const beforeIds = new Set(beforeNodes.map(node => node.id));
        const beforeRoots = game.getPlayerRootNodes(defenderSide);
        const beforeRootIds = new Set(beforeRoots.map(node => node.id));
        if (game.isGameOver || !beforeRoots.length) return risk;

        const originalTurn = game.currentTurn;
        game.currentTurn = attackerSide;
        try {
            const replies = generateMoves(game, attackerSide, bases);
            for (const move of replies) {
                if (move.targetAreaId === bases[defenderSide]) {
                    risk.immediateWinningMoves++;
                    continue;
                }
                if (!move.attacks) continue;

                const next = move._nextState || simulateMove(game, move, attackerSide, bases);
                if (!next) continue;
                if (next.isGameOver && !next.getPlayerRootNodes(defenderSide).length) {
                    risk.immediateWinningMoves++;
                }

                const afterNodes = next.getAliveNodesByOwner(defenderSide);
                const afterIds = new Set(afterNodes.map(node => node.id));
                const removedIds = [...beforeIds].filter(id => !afterIds.has(id));
                const afterRootIds = new Set(next.getPlayerRootNodes(defenderSide).map(node => node.id));
                const rootLoss = [...beforeRootIds].filter(id => !afterRootIds.has(id)).length;
                const directTarget = beforeNodes.find(node => node.areaId === move.targetAreaId);
                const directTargetId = directTarget?.id;
                const cascadeLoss = removedIds.filter(id =>
                    id !== directTargetId && !beforeRootIds.has(id)
                ).length;

                if (rootLoss > 0) risk.rootLossReplies++;
                risk.maxRootLoss = Math.max(risk.maxRootLoss, rootLoss);
                risk.maxNodeLoss = Math.max(risk.maxNodeLoss, removedIds.length);
                risk.maxCascadeLoss = Math.max(risk.maxCascadeLoss, cascadeLoss);
            }
        } finally {
            game.currentTurn = originalTurn;
        }
        return risk;
    }

    countImmediateWinningMoves(game, side, bases, generateMoves, simulateMove) {
        const opponent = side === 'red' ? 'blue' : 'red';
        return this.analyzeOpponentReplies(
            game, opponent, side, bases, generateMoves, simulateMove
        ).immediateWinningMoves;
    }

    measureAttackRisk(game, defenderSide, attackerSide, bases, generateMoves, simulateMove) {
        const { immediateWinningMoves, ...risk } = this.analyzeOpponentReplies(
            game, defenderSide, attackerSide, bases, generateMoves, simulateMove
        );
        return risk;
    }

    /**
     * Proves a bounded two-turn forcing win:
     * after a candidate move, every legal opponent reply must still leave at
     * least one immediate winning move for the attacker. This is an AND/OR
     * check, not a count of merely available threats.
     *
     * The result is conservative: an exhausted budget never turns an
     * unexamined branch into a proven win.
     */
    findForcedWinInTwoMoves(
        rootState, moves, attackerSide, bases, simulateMove, generateMoves, simulatePass,
        { maxNodes = 1200, shouldStop = () => false } = {}
    ) {
        const defenderSide = attackerSide === 'red' ? 'blue' : 'red';
        const result = { moves: [], nodes: 0, complete: true };

        const visit = () => {
            if (result.nodes >= maxNodes || shouldStop()) {
                result.complete = false;
                return false;
            }
            result.nodes++;
            return true;
        };

        const isWinningState = state => Boolean(
            state?.isGameOver &&
            state.getPlayerRootNodes(defenderSide).length === 0 &&
            state.getPlayerRootNodes(attackerSide).length > 0
        );

        const hasImmediateWin = state => {
            if (!visit()) return null;
            const winningMoves = generateMoves(state, attackerSide, bases);
            for (const move of winningMoves) {
                if (move.targetAreaId === bases[defenderSide]) return true;
                if (!visit()) return null;
                const next = move._nextState || simulateMove(state, move, attackerSide, bases);
                if (isWinningState(next)) return true;
            }
            return false;
        };

        for (const candidate of moves) {
            if (!visit()) break;
            const afterCandidate = candidate._nextState ||
                simulateMove(rootState, candidate, attackerSide, bases);
            if (!afterCandidate) continue;

            // An attack that already destroys the final enemy root is a
            // proven win even when it is not a direct base-entry move.
            if (isWinningState(afterCandidate)) {
                result.moves.push(candidate);
                break;
            }
            if (afterCandidate.isGameOver) continue;

            if (!visit()) break;
            const opponentMoves = generateMoves(afterCandidate, defenderSide, bases);
            const responses = opponentMoves.length ? opponentMoves : [null];
            let forcesWin = true;

            for (const response of responses) {
                if (!visit()) {
                    forcesWin = false;
                    break;
                }

                let afterResponse;
                if (response) {
                    if (response.targetAreaId === bases[attackerSide]) {
                        forcesWin = false;
                        break;
                    }
                    afterResponse = response._nextState ||
                        simulateMove(afterCandidate, response, defenderSide, bases);
                } else {
                    afterResponse = simulatePass(afterCandidate, defenderSide);
                }

                if (!afterResponse || afterResponse.isGameOver) {
                    if (!isWinningState(afterResponse)) forcesWin = false;
                } else {
                    const winningReply = hasImmediateWin(afterResponse);
                    if (winningReply !== true) forcesWin = false;
                }

                if (!forcesWin || !result.complete) break;
            }

            if (forcesWin && result.complete) {
                result.moves.push(candidate);
                // Candidates arrive in static-score order. One fully proven
                // win is sufficient; do not spend the remaining turn budget.
                if (result.moves.length) {
                    break;
                }
            }
            if (!result.complete) break;
        }

        return result;
    }

    /**
     * Finds a two-turn tactical gain that survives every legal opponent reply.
     * A qualifying continuation must remove an enemy root or at least two
     * non-root nodes (including cascade losses). This avoids treating a lone
     * expendable leaf as a meaningful forcing combination.
     */
    findForcedMaterialGainInTwoMoves(
        rootState, moves, attackerSide, bases, simulateMove, generateMoves, simulatePass,
        { maxNodes = 600, shouldStop = () => false, minCascadeLoss = 2 } = {}
    ) {
        const defenderSide = attackerSide === 'red' ? 'blue' : 'red';
        const result = {
            moves: [],
            nodes: 0,
            complete: true,
            guaranteedRootLoss: 0,
            guaranteedCascadeLoss: 0,
            guaranteedNodeLoss: 0
        };

        const visit = () => {
            if (result.nodes >= maxNodes || shouldStop()) {
                result.complete = false;
                return false;
            }
            result.nodes++;
            return true;
        };

        const measureGain = (before, after, move) => {
            if (!after) return null;
            const beforeNodes = before.getAliveNodesByOwner(defenderSide);
            const afterIds = new Set(
                after.getAliveNodesByOwner(defenderSide).map(node => node.id)
            );
            const beforeRoots = before.getPlayerRootNodes(defenderSide);
            const afterRootIds = new Set(
                after.getPlayerRootNodes(defenderSide).map(node => node.id)
            );
            const removedIds = beforeNodes
                .filter(node => !afterIds.has(node.id))
                .map(node => node.id);
            const beforeRootIds = new Set(beforeRoots.map(node => node.id));
            const rootLoss = [...beforeRootIds].filter(id => !afterRootIds.has(id)).length;
            const directTarget = beforeNodes.find(node => node.areaId === move.targetAreaId);
            const cascadeLoss = removedIds.filter(id =>
                id !== directTarget?.id && !beforeRootIds.has(id)
            ).length;
            return {
                rootLoss,
                nodeLoss: removedIds.length,
                cascadeLoss
            };
        };

        const isQualifyingGain = gain =>
            gain && (gain.rootLoss > 0 || gain.cascadeLoss >= minCascadeLoss);

        const betterGain = (left, right) => {
            if (!right) return true;
            if (left.rootLoss !== right.rootLoss) return left.rootLoss > right.rootLoss;
            if (left.cascadeLoss !== right.cascadeLoss) return left.cascadeLoss > right.cascadeLoss;
            return left.nodeLoss > right.nodeLoss;
        };

        let bestCandidate = null;
        for (const candidate of moves) {
            if (!visit()) break;
            const afterCandidate = candidate._nextState ||
                simulateMove(rootState, candidate, attackerSide, bases);
            if (!afterCandidate || afterCandidate.isGameOver) continue;

            if (!visit()) break;
            const opponentMoves = generateMoves(afterCandidate, defenderSide, bases);
            const responses = opponentMoves.length ? opponentMoves : [null];
            let survivesEveryReply = true;
            let worstCaseGain = null;

            for (const response of responses) {
                if (!visit()) {
                    survivesEveryReply = false;
                    break;
                }

                if (response?.targetAreaId === bases[attackerSide]) {
                    survivesEveryReply = false;
                    break;
                }

                const afterResponse = response
                    ? response._nextState || simulateMove(
                        afterCandidate, response, defenderSide, bases
                    )
                    : simulatePass(afterCandidate, defenderSide);

                if (!afterResponse || afterResponse.isGameOver) {
                    survivesEveryReply = false;
                    break;
                }

                const continuations = generateMoves(afterResponse, attackerSide, bases);
                let bestReplyGain = null;
                for (const continuation of continuations) {
                    if (!continuation.attacks) continue;
                    if (!visit()) {
                        survivesEveryReply = false;
                        break;
                    }
                    const afterContinuation = continuation._nextState ||
                        simulateMove(afterResponse, continuation, attackerSide, bases);
                    const gain = measureGain(afterResponse, afterContinuation, continuation);
                    if (isQualifyingGain(gain) && betterGain(gain, bestReplyGain)) {
                        bestReplyGain = gain;
                    }
                }

                if (!survivesEveryReply || !isQualifyingGain(bestReplyGain)) {
                    survivesEveryReply = false;
                    break;
                }
                if (!worstCaseGain || betterGain(worstCaseGain, bestReplyGain)) {
                    worstCaseGain = bestReplyGain;
                }
                if (!result.complete) {
                    survivesEveryReply = false;
                    break;
                }
            }

            if (survivesEveryReply && result.complete) {
                const candidateGain = { move: candidate, ...worstCaseGain };
                if (!bestCandidate || betterGain(candidateGain, bestCandidate)) {
                    bestCandidate = candidateGain;
                }
            }
            if (!result.complete) break;
        }

        if (bestCandidate && result.complete) {
            result.moves = [bestCandidate.move];
            result.guaranteedRootLoss = bestCandidate.rootLoss;
            result.guaranteedCascadeLoss = bestCandidate.cascadeLoss;
            result.guaranteedNodeLoss = bestCandidate.nodeLoss;
        }
        return result;
    }

    /**
     * Proves a three-action tactical combination:
     * candidate -> defender reply -> attacker setup -> defender reply -> attack.
     *
     * Every defender reply is an AND branch; the attacker may choose a setup
     * and a final attack (OR branches). Opponent attacks are allowed, but their
     * actual losses are charged against the final material gain. This models
     * counterattacks and sound tactical sacrifices without rewarding a
     * materially losing line.
     */
    findForcedTacticalSequenceInThreeMoves(
        rootState, moves, attackerSide, bases, simulateMove, generateMoves, simulatePass,
        { maxNodes = 600, shouldStop = () => false, minNetNodeGain = 2, minCascadeLoss = 2 } = {}
    ) {
        const defenderSide = attackerSide === 'red' ? 'blue' : 'red';
        const result = {
            moves: [], nodes: 0, complete: true, sequence: [],
            guaranteedRootLoss: 0, guaranteedCascadeLoss: 0,
            guaranteedNodeGain: 0, guaranteedSelfLoss: 0,
            opponentAttackReplies: 0, inducedAttackReplies: 0,
            sacrificeValidated: false
        };

        const visit = () => {
            if (result.nodes >= maxNodes || shouldStop()) {
                result.complete = false;
                return false;
            }
            result.nodes++;
            return true;
        };
        const alive = (state, side) => state.getAliveNodesByOwner(side);
        const lostNodes = (before, after, side) => {
            const afterIds = new Set(alive(after, side).map(node => node.id));
            return alive(before, side).filter(node => !afterIds.has(node.id)).length;
        };
        const rootCount = (state, side) => state.getPlayerRootNodes(side).length;
        const measureAttack = (before, after, move, accumulatedSelfLoss) => {
            if (!after) return null;
            const beforeNodes = alive(before, defenderSide);
            const afterIds = new Set(alive(after, defenderSide).map(node => node.id));
            const removed = beforeNodes.filter(node => !afterIds.has(node.id));
            const beforeRootIds = new Set(
                before.getPlayerRootNodes(defenderSide).map(node => node.id)
            );
            const afterRootIds = new Set(
                after.getPlayerRootNodes(defenderSide).map(node => node.id)
            );
            const rootLoss = [...beforeRootIds].filter(id => !afterRootIds.has(id)).length;
            const directTarget = beforeNodes.find(node => node.areaId === move.targetAreaId);
            const cascadeLoss = removed.filter(node =>
                node.id !== directTarget?.id && !beforeRootIds.has(node.id)
            ).length;
            const nodeLoss = removed.length;
            return {
                rootLoss, cascadeLoss, nodeLoss,
                selfLoss: accumulatedSelfLoss,
                netNodeGain: nodeLoss - accumulatedSelfLoss
            };
        };
        const qualifies = gain => gain && (
            gain.rootLoss > 0 ||
            (gain.cascadeLoss >= minCascadeLoss && gain.netNodeGain >= minNetNodeGain)
        );
        const better = (left, right) => !right ||
            left.rootLoss > right.rootLoss ||
            (left.rootLoss === right.rootLoss && left.netNodeGain > right.netNodeGain) ||
            (left.rootLoss === right.rootLoss && left.netNodeGain === right.netNodeGain &&
                left.cascadeLoss > right.cascadeLoss);

        const proveAfterFirstReply = (state, firstSelfLoss) => {
            if (!visit()) return null;
            if (state.isGameOver || rootCount(state, attackerSide) === 0) return null;
            const setups = generateMoves(state, attackerSide, bases);
            let bestSetup = null;

            for (const setup of setups) {
                if (!visit()) return null;
                const afterSetup = setup._nextState ||
                    simulateMove(state, setup, attackerSide, bases);
                if (!afterSetup || afterSetup.isGameOver ||
                    rootCount(afterSetup, attackerSide) === 0) continue;

                if (!visit()) return null;
                const replies = generateMoves(afterSetup, defenderSide, bases);
                const responses = replies.length ? replies : [null];
                let survives = true;
                let worstGain = null;
                let attackReplyCount = 0;
                let selfLossMax = firstSelfLoss;

                for (const response of responses) {
                    if (!visit()) return null;
                    if (response?.targetAreaId === bases[attackerSide]) {
                        survives = false;
                        break;
                    }
                    const afterResponse = response
                        ? response._nextState || simulateMove(
                            afterSetup, response, defenderSide, bases
                        )
                        : simulatePass(afterSetup, defenderSide);
                    if (!afterResponse || afterResponse.isGameOver ||
                        rootCount(afterResponse, attackerSide) === 0) {
                        survives = false;
                        break;
                    }

                    const branchSelfLoss = firstSelfLoss +
                        lostNodes(afterSetup, afterResponse, attackerSide);
                    selfLossMax = Math.max(selfLossMax, branchSelfLoss);
                    if (response?.attacks) attackReplyCount++;

                    if (!visit()) return null;
                    const finalAttacks = generateMoves(afterResponse, attackerSide, bases)
                        .filter(move => move.attacks);
                    let bestAttack = null;
                    for (const attack of finalAttacks) {
                        if (!visit()) return null;
                        const afterAttack = attack._nextState ||
                            simulateMove(afterResponse, attack, attackerSide, bases);
                        if (!afterAttack || rootCount(afterAttack, attackerSide) === 0) continue;
                        const gain = measureAttack(
                            afterResponse, afterAttack, attack, branchSelfLoss
                        );
                        if (qualifies(gain) && better(gain, bestAttack)) {
                            bestAttack = { ...gain, attack };
                        }
                    }

                    if (!bestAttack) {
                        survives = false;
                        break;
                    }
                    if (!worstGain || better(worstGain, bestAttack)) {
                        worstGain = bestAttack;
                    }
                    if (!result.complete) return null;
                }

                if (survives && result.complete && worstGain) {
                    const proof = {
                        setup, attack: worstGain.attack,
                        ...worstGain,
                        opponentAttackReplies: attackReplyCount,
                        selfLoss: selfLossMax
                    };
                    if (!bestSetup || better(proof, bestSetup)) bestSetup = proof;
                }
                if (!result.complete) return null;
            }
            return bestSetup;
        };

        let bestCandidate = null;
        for (const candidate of moves) {
            if (!visit()) break;
            const afterCandidate = candidate._nextState ||
                simulateMove(rootState, candidate, attackerSide, bases);
            if (!afterCandidate || afterCandidate.isGameOver ||
                rootCount(afterCandidate, attackerSide) === 0) continue;

            if (!visit()) break;
            const firstReplies = generateMoves(afterCandidate, defenderSide, bases);
            const responses = firstReplies.length ? firstReplies : [null];
            let survives = true;
            let worstProof = null;
            let attackReplyCount = 0;
            let selfLossMax = 0;

            for (const response of responses) {
                if (!visit()) {
                    survives = false;
                    break;
                }
                if (response?.targetAreaId === bases[attackerSide]) {
                    survives = false;
                    break;
                }
                const afterResponse = response
                    ? response._nextState || simulateMove(
                        afterCandidate, response, defenderSide, bases
                    )
                    : simulatePass(afterCandidate, defenderSide);
                if (!afterResponse || afterResponse.isGameOver ||
                    rootCount(afterResponse, attackerSide) === 0) {
                    survives = false;
                    break;
                }
                const selfLoss = lostNodes(afterCandidate, afterResponse, attackerSide);
                if (response?.attacks) attackReplyCount++;
                const proof = proveAfterFirstReply(
                    afterResponse, selfLoss
                );
                if (!proof) {
                    survives = false;
                    break;
                }
                attackReplyCount += proof.opponentAttackReplies;
                selfLossMax = Math.max(selfLossMax, proof.selfLoss);
                if (!worstProof || better(worstProof, proof)) worstProof = proof;
                if (!result.complete) {
                    survives = false;
                    break;
                }
            }

            if (survives && result.complete && worstProof) {
                const candidateProof = {
                    move: candidate, setup: worstProof.setup, attack: worstProof.attack,
                    rootLoss: worstProof.rootLoss,
                    cascadeLoss: worstProof.cascadeLoss,
                    nodeLoss: worstProof.nodeLoss,
                    netNodeGain: worstProof.netNodeGain,
                    selfLoss: selfLossMax,
                    opponentAttackReplies: attackReplyCount
                };
                if (!bestCandidate || better(candidateProof, bestCandidate)) {
                    bestCandidate = candidateProof;
                }
            }
            if (!result.complete) break;
        }

        if (bestCandidate && result.complete) {
            result.moves = [bestCandidate.move];
            result.sequence = [bestCandidate.move, bestCandidate.setup, bestCandidate.attack];
            result.guaranteedRootLoss = bestCandidate.rootLoss;
            result.guaranteedCascadeLoss = bestCandidate.cascadeLoss;
            result.guaranteedNodeGain = bestCandidate.netNodeGain;
            result.guaranteedSelfLoss = bestCandidate.selfLoss;
            result.opponentAttackReplies = bestCandidate.opponentAttackReplies;
            result.inducedAttackReplies = bestCandidate.opponentAttackReplies;
            result.sacrificeValidated = bestCandidate.selfLoss > 0 &&
                bestCandidate.netNodeGain >= minNetNodeGain;
        }
        return result;
    }

    rankDefenses(game, moves, side, bases, simulateMove, generateMoves) {
        const opponent = side === 'red' ? 'blue' : 'red';
        const originalTurn = game.currentTurn;
        const analysisCache = new WeakMap();
        const analyze = state => {
            let result = analysisCache.get(state);
            if (!result) {
                result = this.analyzeOpponentReplies(
                    state, side, opponent, bases, generateMoves, simulateMove
                );
                analysisCache.set(state, result);
            }
            return result;
        };

        game.currentTurn = opponent;
        let currentThreats;
        try {
            currentThreats = this.analyzeOpponentReplies(
                game, side, opponent, bases, generateMoves, simulateMove
            ).immediateWinningMoves;
        } finally {
            game.currentTurn = originalTurn;
        }

        // Immediate wins remain the highest-priority tactical threat.
        if (currentThreats) {
            const ranked = moves.map(move => {
                const next = move._nextState || simulateMove(game, move, side, bases);
                if (!next) return { move, remainingThreats: Infinity };
                const remainingThreats = !next.getPlayerRootNodes(side).length
                    ? Infinity
                    : next.isGameOver
                        ? 0
                        : analyze(next).immediateWinningMoves;
                return { move, remainingThreats };
            });
            const minimum = Math.min(...ranked.map(item => item.remainingThreats));
            return ranked
                .filter(item => item.remainingThreats === minimum)
                .map(item => item.move);
        }

        // Analyze each resulting position once. The same reply simulations
        // provide immediate-win, root-loss, total-loss, and cascade metrics.
        const rootRisk = moves.map(move => {
            const next = move._nextState || simulateMove(game, move, side, bases);
            if (!next || !next.getPlayerRootNodes(side).length) {
                return { move, immediateWinningMoves: Infinity, maxRootLoss: Infinity,
                    rootLossReplies: Infinity, maxCascadeLoss: Infinity };
            }
            if (next.isGameOver) {
                return { move, immediateWinningMoves: 0, maxRootLoss: 0,
                    rootLossReplies: 0, maxCascadeLoss: 0 };
            }
            return { move, ...analyze(next) };
        });
        const finiteRisk = rootRisk.filter(item => Number.isFinite(item.maxRootLoss));
        if (!finiteRisk.length) return moves;

        const minimumImmediateWins = Math.min(...finiteRisk.map(item => item.immediateWinningMoves));
        const immediateSafe = finiteRisk.filter(item => item.immediateWinningMoves === minimumImmediateWins);
        const minimumRootLoss = Math.min(...immediateSafe.map(item => item.maxRootLoss));
        const rootSafe = immediateSafe.filter(item => item.maxRootLoss === minimumRootLoss);
        const minimumRootLossReplies = Math.min(...rootSafe.map(item => item.rootLossReplies));
        const rootStable = rootSafe.filter(item => item.rootLossReplies === minimumRootLossReplies);
        const minimumCascadeLoss = Math.min(...rootStable.map(item => item.maxCascadeLoss));
        return rootStable
            .filter(item => item.maxCascadeLoss === minimumCascadeLoss)
            .map(item => item.move);
    }
}
