import { describe, it, expect } from "vitest";
import { compile } from "../lang/pipeline.js";
import { RatingStore } from "./ranked.js";
import { MatchRunner } from "./match-runner.js";
import { MatchmakingQueue } from "./matchmaking.js";
import { TournamentManager, type TournamentEntry } from "./tournament.js";
import { LobbyManager } from "./lobby.js";

const BOT_A = `
robot "Alpha" version "1.0"
meta { class: "brawler" }
on tick {
  let enemy = nearest_enemy()
  if enemy != null {
    if can_attack(enemy) {
      attack enemy
    } else {
      move_toward enemy.position
    }
  }
}
`;

const BOT_B = `
robot "Beta" version "1.0"
meta { class: "ranger" }
on tick {
  let enemy = nearest_enemy()
  if enemy != null {
    if can_attack(enemy) {
      attack enemy
    }
  }
}
`;

function compileBot(source: string) {
  const result = compile(source);
  if (!result.success) throw new Error(`Compile failed: ${result.errors.join(", ")}`);
  return { program: result.program!, constants: result.constants! };
}

describe("RatingStore", () => {
  it("creates players with initial Elo", () => {
    const store = new RatingStore();
    const player = store.getOrCreate("p1");
    expect(player.elo).toBe(1000);
    expect(player.tier).toBe("silver");
  });

  it("updates ratings after match", () => {
    const store = new RatingStore();
    store.recordResult("winner", "loser", "match1");
    const winner = store.getOrCreate("winner");
    const loser = store.getOrCreate("loser");
    expect(winner.elo).toBeGreaterThan(1000);
    expect(loser.elo).toBeLessThan(1000);
    expect(winner.wins).toBe(1);
    expect(loser.losses).toBe(1);
  });

  it("returns sorted leaderboard", () => {
    const store = new RatingStore();
    store.recordResult("a", "b", "m1");
    store.recordResult("a", "c", "m2");
    const board = store.getLeaderboard();
    expect(board[0].playerId).toBe("a");
    expect(board[0].elo).toBeGreaterThan(board[1].elo);
  });
});

describe("MatchRunner", () => {
  it("runs a ranked match and updates ratings", () => {
    const store = new RatingStore();
    const runner = new MatchRunner(store);
    const a = compileBot(BOT_A);
    const b = compileBot(BOT_B);

    const response = runner.runRankedMatch({
      player1: { playerId: "p1", ...a },
      player2: { playerId: "p2", ...b },
      config: {
        mode: "1v1_ranked",
        arenaWidth: 100, arenaHeight: 100,
        maxTicks: 1000, tickRate: 30, seed: 42,
      },
    });

    expect(response.record.status).toBe("completed");
    expect(response.record.matchId).toBeTruthy();
    expect(response.replay.frames.length).toBeGreaterThan(0);
    expect(runner.getMatchCount()).toBe(1);
  });

  it("records pre-match Elo in match participants", () => {
    const store = new RatingStore();
    const runner = new MatchRunner(store);
    const a = compileBot(BOT_A);
    const b = compileBot(BOT_B);

    const p1Before = store.getOrCreate("p1").elo;
    const p2Before = store.getOrCreate("p2").elo;
    const response = runner.runRankedMatch({
      player1: { playerId: "p1", ...a },
      player2: { playerId: "p2", ...b },
      config: {
        mode: "1v1_ranked",
        arenaWidth: 100, arenaHeight: 100,
        maxTicks: 1000, tickRate: 30, seed: 1337,
      },
    });

    expect(response.record.participants[0].eloAtStart).toBe(p1Before);
    expect(response.record.participants[1].eloAtStart).toBe(p2Before);
  });
});

describe("MatchmakingQueue", () => {
  it("pairs two queued players", () => {
    const store = new RatingStore();
    const queue = new MatchmakingQueue(store);
    const a = compileBot(BOT_A);
    const b = compileBot(BOT_B);

    queue.enqueue("p1", a.program, a.constants);
    queue.enqueue("p2", b.program, b.constants);

    const pairing = queue.tryMatch();
    expect(pairing).not.toBeNull();
    expect(pairing!.player1.playerId).toBeTruthy();
    expect(pairing!.player2.playerId).toBeTruthy();
    expect(queue.getQueueSize()).toBe(0);
  });

  it("does not match with only one player", () => {
    const store = new RatingStore();
    const queue = new MatchmakingQueue(store);
    const a = compileBot(BOT_A);
    queue.enqueue("p1", a.program, a.constants);
    expect(queue.tryMatch()).toBeNull();
  });
});

describe("TournamentManager", () => {
  it("creates and runs a single elimination tournament", () => {
    const mgr = new TournamentManager();
    const a = compileBot(BOT_A);
    const b = compileBot(BOT_B);

    const entries: TournamentEntry[] = [
      { playerId: "p1", program: a.program, constants: a.constants, elo: 1000 },
      { playerId: "p2", program: b.program, constants: b.constants, elo: 1000 },
    ];

    const tournament = mgr.createTournament("Test", "single_elimination", entries, 42);
    expect(tournament.participants).toHaveLength(2);
    expect(tournament.rounds).toHaveLength(1);

    const round = mgr.runCurrentRound(tournament.id);
    expect(round).not.toBeNull();
    expect(round!.completed).toBe(true);
    expect(tournament.status).toBe("completed");

    const standings = mgr.getStandings(tournament.id);
    expect(standings[0].wins).toBeGreaterThan(0);
  });

  it("runs a 4-player tournament", () => {
    const mgr = new TournamentManager();
    const a = compileBot(BOT_A);
    const b = compileBot(BOT_B);

    const entries: TournamentEntry[] = [
      { playerId: "p1", program: a.program, constants: a.constants, elo: 1200 },
      { playerId: "p2", program: b.program, constants: b.constants, elo: 1100 },
      { playerId: "p3", program: a.program, constants: a.constants, elo: 1000 },
      { playerId: "p4", program: b.program, constants: b.constants, elo: 900 },
    ];

    const tournament = mgr.createTournament("4P Test", "single_elimination", entries, 99);
    expect(tournament.participants).toHaveLength(4);

    // Run until complete
    while (tournament.status === "in_progress") {
      mgr.runCurrentRound(tournament.id);
    }

    expect(tournament.status).toBe("completed");
    const standings = mgr.getStandings(tournament.id);
    const champion = standings.find(p => !p.eliminated);
    expect(champion).toBeDefined();
  });
});

describe("LobbyManager", () => {
  it("creates and manages lobbies", () => {
    const store = new RatingStore();
    const runner = new MatchRunner(store);
    const queue = new MatchmakingQueue(store);
    const mgr = new LobbyManager(runner, queue);

    const lobby = mgr.createLobby("host", "Test Room");
    expect(lobby.players).toHaveLength(1);
    expect(lobby.status).toBe("waiting");

    mgr.joinLobby(lobby.id, "guest");
    expect(lobby.players).toHaveLength(2);
  });

  it("runs a match when all players are ready", () => {
    const store = new RatingStore();
    const runner = new MatchRunner(store);
    const queue = new MatchmakingQueue(store);
    const mgr = new LobbyManager(runner, queue);
    const a = compileBot(BOT_A);
    const b = compileBot(BOT_B);

    const lobby = mgr.createLobby("host", "Test Room");
    mgr.joinLobby(lobby.id, "guest");
    mgr.submitProgram(lobby.id, "host", a.program, a.constants);
    mgr.submitProgram(lobby.id, "guest", b.program, b.constants);

    expect(lobby.status).toBe("ready");

    const response = mgr.startMatch(lobby.id);
    expect(response).not.toBeNull();
    expect(response!.record.status).toBe("completed");
    expect(lobby.status).toBe("completed");
  });
});
