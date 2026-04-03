// ============================================================================
// Match Runner — Server-authoritative match execution
// ============================================================================
import { runMatch } from "../engine/tick.js";
import { ENGINE_VERSION } from "../shared/config.js";
export class MatchRunner {
    matchHistory = [];
    replays = new Map();
    ratingStore;
    constructor(ratingStore) {
        this.ratingStore = ratingStore;
    }
    static MAX_HISTORY = 1000;
    static MAX_REPLAYS = 100;
    /** Execute a server-authoritative match */
    runRankedMatch(request) {
        const player1EloAtStart = this.ratingStore.getOrCreate(request.player1.playerId).elo;
        const player2EloAtStart = this.ratingStore.getOrCreate(request.player2.playerId).elo;
        const setup = {
            config: request.config,
            participants: [
                {
                    program: request.player1.program,
                    constants: request.player1.constants,
                    playerId: request.player1.playerId,
                    teamId: 0,
                },
                {
                    program: request.player2.program,
                    constants: request.player2.constants,
                    playerId: request.player2.playerId,
                    teamId: 1,
                },
            ],
        };
        const result = runMatch(setup);
        const matchId = result.replay.metadata.matchId;
        // Update ratings
        if (request.config.mode === "1v1_ranked") {
            if (result.winner === 0) {
                this.ratingStore.recordResult(request.player1.playerId, request.player2.playerId, matchId);
            }
            else if (result.winner === 1) {
                this.ratingStore.recordResult(request.player2.playerId, request.player1.playerId, matchId);
            }
            else {
                this.ratingStore.recordDraw(request.player1.playerId, request.player2.playerId, matchId);
            }
        }
        // Create match record
        const now = Date.now();
        const record = {
            matchId,
            config: request.config,
            participants: result.replay.metadata.participants.map((p, i) => ({
                ...p,
                eloAtStart: i === 0 ? player1EloAtStart : player2EloAtStart,
            })),
            status: "completed",
            winner: result.winner,
            startedAt: now,
            endedAt: now,
            replayId: matchId,
            engineVersion: ENGINE_VERSION,
        };
        this.matchHistory.push(record);
        if (this.matchHistory.length > MatchRunner.MAX_HISTORY) {
            this.matchHistory.shift();
        }
        this.replays.set(matchId, result.replay);
        if (this.replays.size > MatchRunner.MAX_REPLAYS) {
            const oldestKey = this.replays.keys().next().value;
            this.replays.delete(oldestKey);
        }
        return { record, result, replay: result.replay };
    }
    /** Run an unranked match (no Elo changes) */
    runUnrankedMatch(request) {
        const unrankedConfig = request.config.mode === "1v1_ranked"
            ? { ...request.config, mode: "1v1_unranked" }
            : request.config;
        return this.runUnrankedMatchWithParticipants({
            config: unrankedConfig,
            participants: [
                {
                    playerId: request.player1.playerId,
                    program: request.player1.program,
                    constants: request.player1.constants,
                    teamId: 0,
                },
                {
                    playerId: request.player2.playerId,
                    program: request.player2.program,
                    constants: request.player2.constants,
                    teamId: 1,
                },
            ],
        });
    }
    /** Run an unranked match for any participant count (no Elo changes) */
    runUnrankedMatchWithParticipants(request) {
        const setup = {
            config: request.config,
            participants: request.participants.map(p => ({
                program: p.program,
                constants: p.constants,
                playerId: p.playerId,
                teamId: p.teamId,
            })),
        };
        const result = runMatch(setup);
        const matchId = result.replay.metadata.matchId;
        const now = Date.now();
        const record = {
            matchId,
            config: request.config,
            participants: result.replay.metadata.participants,
            status: "completed",
            winner: result.winner,
            startedAt: now,
            endedAt: now,
            replayId: matchId,
            engineVersion: ENGINE_VERSION,
        };
        this.matchHistory.push(record);
        if (this.matchHistory.length > MatchRunner.MAX_HISTORY) {
            this.matchHistory.shift();
        }
        this.replays.set(matchId, result.replay);
        if (this.replays.size > MatchRunner.MAX_REPLAYS) {
            const oldestKey = this.replays.keys().next().value;
            this.replays.delete(oldestKey);
        }
        return { record, result, replay: result.replay };
    }
    getMatchHistory(limit = 50) {
        return this.matchHistory.slice(-limit);
    }
    getReplay(matchId) {
        return this.replays.get(matchId);
    }
    getMatchCount() {
        return this.matchHistory.length;
    }
}
