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
        { maxNodes = 4000, shouldStop = () => false, minCascadeLoss = 2, minNetNodeGain = 2 } = {}
    ) {
        const defenderSide = attackerSide === 'red' ? 'blue' : 'red';
        const result = { moves: [], nodes: 0, complete: true, guaranteedRootLoss: 0,
            guaranteedCascadeLoss: 0, guaranteedNodeLoss: 0, guaranteedSelfLoss: 0,
            guaranteedNetNodeGain: 0 };
        const visit = () => {
            if (result.nodes >= maxNodes || shouldStop()) { result.complete = false; return false; }
            result.nodes++; return true;
        };
        const lostNodes = (before, after, side) => {
            const afterIds = new Set(after.getAliveNodesByOwner(side).map(node => node.id));
            return before.getAliveNodesByOwner(side).filter(node => !afterIds.has(node.id)).length;
        };
        const rootLoss = (before, after, side) =>
            before.getPlayerRootNodes(side).length - after.getPlayerRootNodes(side).length;
        const measure = (afterCandidate, afterResponse, afterContinuation, finalMove) => {
            if (!afterContinuation) return null;
            const enemyLoss =
                lostNodes(rootState, afterCandidate, defenderSide) +
                lostNodes(afterCandidate, afterResponse, defenderSide) +
                lostNodes(afterResponse, afterContinuation, defenderSide);
            const selfLoss =
                lostNodes(rootState, afterCandidate, attackerSide) +
                lostNodes(afterCandidate, afterResponse, attackerSide) +
                lostNodes(afterResponse, afterContinuation, attackerSide);
            const enemyRootLoss = rootLoss(rootState, afterContinuation, defenderSide);
            const ownRootLoss = rootLoss(rootState, afterContinuation, attackerSide);
            const directTarget = afterResponse.getAliveNodesByOwner(defenderSide)
                .find(node => node.areaId === finalMove.targetAreaId);
            const afterEnemyIds = new Set(afterContinuation.getAliveNodesByOwner(defenderSide)
                .map(node => node.id));
            const directTargetLoss = directTarget && !afterEnemyIds.has(directTarget.id) ? 1 : 0;
            const cascadeLoss = Math.max(0, enemyLoss - enemyRootLoss - directTargetLoss);
            return {
                rootLoss: enemyRootLoss, cascadeLoss, nodeLoss: enemyLoss,
                selfLoss, ownRootLoss, netNodeGain: enemyLoss - selfLoss
            };
        };
        const qualifies = gain => Boolean(gain && gain.ownRootLoss === 0 && (
            gain.rootLoss > 0 ||
            (gain.cascadeLoss >= minCascadeLoss && gain.netNodeGain >= minNetNodeGain)
        ));
        const compare = (x,y) => (x.rootLoss-y.rootLoss) ||
            (x.netNodeGain-y.netNodeGain) || (x.cascadeLoss-y.cascadeLoss) ||
            (x.nodeLoss-y.nodeLoss);
        const better = (x,y) => !y || compare(x,y)>0;
        const worse = (x,y) => !y || compare(x,y)<0;
        let bestCandidate = null;
        for (const candidate of moves) {
            if (!visit()) break;
            const afterCandidate = candidate._nextState || simulateMove(rootState,candidate,attackerSide,bases);
            if (!afterCandidate || afterCandidate.isGameOver ||
                !afterCandidate.getPlayerRootNodes(attackerSide).length) continue;
            if (!visit()) break;
            const replies = generateMoves(afterCandidate,defenderSide,bases);
            const responses = replies.length ? replies : [null];
            let survives = true, worstCaseGain = null;
            for (const response of responses) {
                if (!visit()) { survives=false; break; }
                if (response?.targetAreaId === bases[attackerSide]) { survives=false; break; }
                const afterResponse = response
                    ? response._nextState || simulateMove(afterCandidate,response,defenderSide,bases)
                    : simulatePass(afterCandidate,defenderSide);
                if (!afterResponse || afterResponse.isGameOver ||
                    !afterResponse.getPlayerRootNodes(attackerSide).length) { survives=false; break; }
                const continuations = generateMoves(afterResponse,attackerSide,bases);
                let bestContinuation = null;
                for (const continuation of continuations) {
                    if (!continuation.attacks) continue;
                    if (!visit()) { survives=false; break; }
                    const afterContinuation = continuation._nextState ||
                        simulateMove(afterResponse,continuation,attackerSide,bases);
                    if (!afterContinuation || afterContinuation.isGameOver ||
                        !afterContinuation.getPlayerRootNodes(attackerSide).length) continue;
                    const gain = measure(afterCandidate,afterResponse,afterContinuation,continuation);
                    if (qualifies(gain) && better(gain,bestContinuation)) bestContinuation=gain;
                }
                if (!survives || !qualifies(bestContinuation)) { survives=false; break; }
                if (worse(bestContinuation,worstCaseGain)) worstCaseGain=bestContinuation;
                if (!result.complete) { survives=false; break; }
            }
            if (survives && result.complete && worstCaseGain) {
                const proof={move:candidate,...worstCaseGain};
                if (!bestCandidate || better(proof,bestCandidate)) bestCandidate=proof;
            }
            if (!result.complete) break;
        }
        if (bestCandidate && result.complete) {
            result.moves=[bestCandidate.move];
            result.guaranteedRootLoss=bestCandidate.rootLoss;
            result.guaranteedCascadeLoss=bestCandidate.cascadeLoss;
            result.guaranteedNodeLoss=bestCandidate.nodeLoss;
            result.guaranteedSelfLoss=bestCandidate.selfLoss;
            result.guaranteedNetNodeGain=bestCandidate.netNodeGain;
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
            opponentAttackReplies: 0, inducedDefensiveReplies: 0,
            inducementValidated: false, sacrificeValidated: false
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
        const measureAttack = (before, after, move, accumulatedSelfLoss, accumulatedEnemyLoss) => {
            if (!after) return null;
            const enemyLoss = accumulatedEnemyLoss +
                lostNodes(before, after, defenderSide);
            const selfLoss = accumulatedSelfLoss +
                lostNodes(before, after, attackerSide);
            const rootLoss = rootCount(rootState, defenderSide) - rootCount(after, defenderSide);
            const ownRootLoss = rootCount(rootState, attackerSide) - rootCount(after, attackerSide);
            const directTarget = alive(before, defenderSide)
                .find(node => node.areaId === move.targetAreaId);
            const afterIds = new Set(alive(after, defenderSide).map(node => node.id));
            const directTargetLoss = directTarget && !afterIds.has(directTarget.id) ? 1 : 0;
            const cascadeLoss = Math.max(0, enemyLoss - rootLoss - directTargetLoss);
            return { rootLoss, cascadeLoss, nodeLoss: enemyLoss, selfLoss, ownRootLoss,
                netNodeGain: enemyLoss - selfLoss };
        };
        const qualifies = gain => gain && gain.ownRootLoss === 0 && (
            gain.rootLoss > 0 ||
            (gain.cascadeLoss >= minCascadeLoss && gain.netNodeGain >= minNetNodeGain)
        );
        const compareGain = (left,right) => (left.rootLoss-right.rootLoss) ||
            (left.netNodeGain-right.netNodeGain) || (left.cascadeLoss-right.cascadeLoss) ||
            (left.nodeLoss-right.nodeLoss);
        const better = (left,right) => !right || compareGain(left,right)>0;
        const worse = (left,right) => !right || compareGain(left,right)<0;

        const proveAfterFirstReply = (state, initialThreat, firstSelfLoss, firstEnemyLoss) => {
            if (!visit()) return null;
            if (state.isGameOver || rootCount(state, attackerSide) === 0) return null;
            const setups = generateMoves(state, attackerSide, bases);
            const inducedDefense = initialThreat && !this.findImmediateWinningMove(
                setups, attackerSide, bases
            );
            let bestSetup = null;

            for (const setup of setups) {
                if (!visit()) return null;
                const afterSetup = setup._nextState ||
                    simulateMove(state, setup, attackerSide, bases);
                if (!afterSetup || afterSetup.isGameOver ||
                    rootCount(afterSetup, attackerSide) === 0) continue;
                const setupSelfLoss = firstSelfLoss +
                    lostNodes(state, afterSetup, attackerSide);
                const setupEnemyLoss = firstEnemyLoss +
                    lostNodes(state, afterSetup, defenderSide);

                if (!visit()) return null;
                const replies = generateMoves(afterSetup, defenderSide, bases);
                const responses = replies.length ? replies : [null];
                let survives = true;
                let worstGain = null;
                let attackReplyCount = 0;

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
                            afterResponse, afterAttack, attack,
                            setupSelfLoss + lostNodes(afterSetup, afterResponse, attackerSide),
                            setupEnemyLoss + lostNodes(afterSetup, afterResponse, defenderSide)
                        );
                        if (qualifies(gain) && better(gain, bestAttack)) {
                            bestAttack = { ...gain, attack };
                        }
                    }

                    if (!bestAttack) {
                        survives = false;
                        break;
                    }
                    if (worse(bestAttack, worstGain)) {
                        worstGain = bestAttack;
                    }
                    if (!result.complete) return null;
                }

                if (survives && result.complete && worstGain) {
                    const proof = {
                        setup, attack: worstGain.attack,
                        ...worstGain,
                        opponentAttackReplies: attackReplyCount,
                        inducedDefensiveReplies: inducedDefense ? 1 : 0,
                        selfLoss: worstGain.selfLoss
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
            const initialAttackerMoves = generateMoves(afterCandidate, attackerSide, bases);
            const initialThreat = Boolean(this.findImmediateWinningMove(
                initialAttackerMoves, attackerSide, bases
            ));
            const firstReplies = generateMoves(afterCandidate, defenderSide, bases);
            const responses = firstReplies.length ? firstReplies : [null];
            let survives = true;
            let worstProof = null;
            let attackReplyCount = 0;
            let inducedDefenseCount = 0;

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
                if (response?.attacks) attackReplyCount++;
                const firstSelfLoss = lostNodes(rootState, afterCandidate, attackerSide) +
                    lostNodes(afterCandidate, afterResponse, attackerSide);
                const firstEnemyLoss = lostNodes(rootState, afterCandidate, defenderSide) +
                    lostNodes(afterCandidate, afterResponse, defenderSide);
                const proof = proveAfterFirstReply(
                    afterResponse, initialThreat, firstSelfLoss, firstEnemyLoss
                );
                if (!proof) {
                    survives = false;
                    break;
                }
                attackReplyCount += proof.opponentAttackReplies;
                inducedDefenseCount += proof.inducedDefensiveReplies;
                if (worse(proof, worstProof)) worstProof = proof;
                if (!result.complete) {
                    survives = false;
                    break;
                }
            }

            // Do not elevate an otherwise quiet positional plan into a
            // forcing tactic. The extended layer is reserved for genuine
            // counterplay, a neutralized immediate threat, or a net-positive
            // sacrifice that was exposed to opponent attacks.
            const hasTacticalForcingFeature = attackReplyCount > 0 ||
                inducedDefenseCount > 0 || worstProof?.selfLoss > 0;
            if (survives && result.complete && worstProof && hasTacticalForcingFeature) {
                const candidateProof = {
                    move: candidate, setup: worstProof.setup, attack: worstProof.attack,
                    rootLoss: worstProof.rootLoss,
                    cascadeLoss: worstProof.cascadeLoss,
                    nodeLoss: worstProof.nodeLoss,
                    netNodeGain: worstProof.netNodeGain,
                    selfLoss: worstProof.selfLoss,
                    opponentAttackReplies: attackReplyCount,
                    inducedDefensiveReplies: inducedDefenseCount
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
            result.inducedDefensiveReplies = bestCandidate.inducedDefensiveReplies;
            result.inducementValidated = bestCandidate.inducedDefensiveReplies > 0;
            result.sacrificeValidated = bestCandidate.selfLoss > 0 &&
                bestCandidate.netNodeGain >= minNetNodeGain;
        }
        return result;
    }

    countImmediateWinningReplies(game, side, bases, generateMoves, simulateMove) {
        const opponent = side === 'red' ? 'blue' : 'red';
        const originalTurn = game.currentTurn;
        game.currentTurn = opponent;
        try {
            return this.analyzeOpponentReplies(
                game, side, opponent, bases, generateMoves, simulateMove
            ).immediateWinningMoves;
        } finally {
            game.currentTurn = originalTurn;
        }
    }

    findMandatoryDefenses(game, moves, side, bases, simulateMove, generateMoves) {
        const immediateWinningMoves = this.countImmediateWinningReplies(
            game, side, bases, generateMoves, simulateMove
        );
        if (!immediateWinningMoves) {
            return { moves, hasImmediateThreat: false, immediateWinningMoves: 0 };
        }
        return {
            moves: this.rankDefenses(
                game, moves, side, bases, simulateMove, generateMoves, immediateWinningMoves
            ),
            hasImmediateThreat: true,
            immediateWinningMoves
        };
    }

    rankDefenses(game, moves, side, bases, simulateMove, generateMoves, knownCurrentThreats = undefined) {
        const opponent = side === 'red' ? 'blue' : 'red';
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

        const currentThreats = knownCurrentThreats ??
            this.countImmediateWinningReplies(game, side, bases, generateMoves, simulateMove);

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
