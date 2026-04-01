// ============================================================================
// ArenaScript PoC Demo — Full end-to-end demonstration
// ============================================================================
import { compile } from "./lang/pipeline.js";
import { runMatch } from "./engine/tick.js";
import { RatingStore } from "./server/ranked.js";
import { MatchRunner } from "./server/match-runner.js";
import { MatchmakingQueue } from "./server/matchmaking.js";
import { TournamentManager } from "./server/tournament.js";
import { LobbyManager } from "./server/lobby.js";
// ============================================================================
// Example Bots
// ============================================================================
const AGGRESSOR_BOT = `
robot "Bruiser" version "2.0"

meta {
  author: "Player1"
  class: "brawler"
}

state {
  ticks_moving: number = 0
}

on spawn {
  set ticks_moving = 0
}

on tick {
  if is_in_hazard() {
    turn_right
    move_forward
    return
  }

  let enemy = nearest_enemy()
  if enemy != null {
    if can_attack(enemy) {
      attack enemy
    } else {
      move_toward enemy.position
    }
    return
  }

  set ticks_moving = ticks_moving + 1
  if wall_ahead(3) {
    turn_right
    set ticks_moving = 0
  } else if ticks_moving > 25 {
    turn_left
    set ticks_moving = 0
  } else {
    move_forward
  }
}

on damaged(event) {
  if health() < 40 {
    let heal = nearest_heal_zone()
    if heal != null {
      move_to heal.position
    }
  }
}
`;
const KITER_BOT = `
robot "Kiter" version "2.0"

meta {
  author: "Player2"
  class: "ranger"
}

const {
  SAFE_HEALTH = 35
}

state {
  retreating: boolean = false
}

on spawn {
  set retreating = false
}

on tick {
  if is_in_hazard() {
    move_forward
    return
  }

  let enemy = nearest_enemy()

  if enemy == null {
    let cp = nearest_control_point()
    if cp != null {
      move_to cp.position
    } else {
      if wall_ahead(4) {
        turn_right
      } else {
        move_forward
      }
    }
    return
  }

  if health() < SAFE_HEALTH {
    set retreating = true
    let heal = nearest_heal_zone()
    if heal != null {
      move_to heal.position
      return
    }
    retreat
    return
  }

  set retreating = false

  if can_attack(enemy) {
    fire_at enemy.position
  } else {
    move_toward enemy.position
  }
}

on low_health {
  set retreating = true
}
`;
const TANK_BOT = `
robot "Fortress" version "2.0"

meta {
  author: "Player3"
  class: "tank"
}

on tick {
  if is_in_hazard() {
    move_forward
    return
  }

  let enemy = nearest_enemy()
  if enemy == null {
    let cp = nearest_control_point()
    if cp != null {
      move_to cp.position
    } else {
      if wall_ahead(3) {
        turn_left
      } else {
        move_forward
      }
    }
    return
  }

  if health() < 55 {
    shield
  }

  if can_attack(enemy) {
    attack enemy
  } else {
    move_toward enemy.position
  }
}

on damaged {
  if health() < 45 {
    shield
  }
}
`;
const SUPPORT_BOT = `
robot "Healer" version "2.0"

meta {
  author: "Player4"
  class: "support"
}

state {
  retreating: boolean = false
}

on tick {
  if is_in_hazard() {
    move_forward
    return
  }

  if is_in_heal_zone() and health() < max_health() {
    stop
    return
  }

  let enemy = nearest_enemy()

  if enemy == null {
    let cp = nearest_control_point()
    if cp != null {
      move_to cp.position
    } else {
      if wall_ahead(3) {
        turn_right
      } else {
        move_forward
      }
    }
    return
  }

  if health() < 35 {
    set retreating = true
    let heal = nearest_heal_zone()
    if heal != null {
      move_to heal.position
      return
    }
    retreat
    return
  }

  set retreating = false

  if can_attack(enemy) {
    attack enemy
  } else {
    move_toward enemy.position
  }
}

on low_health {
  set retreating = true
}
`;
// ============================================================================
// Main Demo
// ============================================================================
function separator(title) {
    console.log("\n" + "=".repeat(60));
    console.log(`  ${title}`);
    console.log("=".repeat(60) + "\n");
}
function main() {
    console.log("ArenaScript PoC — Full System Demo\n");
    // --- 1. Compile Bots ---
    separator("1. COMPILER — Compiling ArenaScript Programs");
    const bots = [
        { name: "Bruiser", source: AGGRESSOR_BOT },
        { name: "Kiter", source: KITER_BOT },
        { name: "Fortress", source: TANK_BOT },
        { name: "Healer", source: SUPPORT_BOT },
    ];
    const compiledBots = [];
    for (const bot of bots) {
        const result = compile(bot.source);
        compiledBots.push({ name: bot.name, result });
        if (result.success) {
            console.log(`  [OK] ${bot.name} compiled successfully`);
            console.log(`       Class: ${result.program.robotClass} | Bytecode: ${result.program.bytecode.length} bytes`);
            console.log(`       Events: ${[...result.program.eventHandlers.keys()].join(", ")}`);
        }
        else {
            console.log(`  [FAIL] ${bot.name}: ${result.errors.join(", ")}`);
        }
    }
    // --- 2. Run a 1v1 Match ---
    separator("2. ARENA — Running 1v1 Match (Bruiser vs Kiter)");
    const bot1 = compiledBots[0].result;
    const bot2 = compiledBots[1].result;
    if (bot1.success && bot2.success) {
        const setup = {
            config: {
                mode: "1v1_ranked",
                arenaWidth: 100,
                arenaHeight: 100,
                maxTicks: 3000,
                tickRate: 30,
                seed: 42,
            },
            participants: [
                { program: bot1.program, constants: bot1.constants, playerId: "player1", teamId: 0 },
                { program: bot2.program, constants: bot2.constants, playerId: "player2", teamId: 1 },
            ],
        };
        const result = runMatch(setup);
        console.log(`  Winner: Team ${result.winner !== null ? result.winner : "DRAW"}`);
        console.log(`  Reason: ${result.reason}`);
        console.log(`  Ticks: ${result.tickCount}`);
        console.log(`  Replay frames: ${result.replay.frames.length}`);
        console.log("\n  Robot Stats:");
        for (const [id, stats] of result.robotStats) {
            console.log(`    ${id}: dmg_dealt=${stats.damageDealt} dmg_taken=${stats.damageTaken} kills=${stats.kills}`);
        }
        // Show a few replay frames
        console.log("\n  Sample Replay Frames:");
        const sampleFrames = [0, Math.floor(result.tickCount / 4), Math.floor(result.tickCount / 2), result.tickCount - 1];
        for (const idx of sampleFrames) {
            const frame = result.replay.frames[idx];
            if (frame) {
                console.log(`    Tick ${frame.tick}:`);
                for (const r of frame.robots) {
                    console.log(`      ${r.id}: pos=(${r.position.x.toFixed(1)}, ${r.position.y.toFixed(1)}) hp=${r.health}`);
                }
            }
        }
    }
    separator("2B. ARENA — Running 2v2 Preset Team Simulation");
    const bot3 = compiledBots[2].result;
    const bot4 = compiledBots[3].result;
    if (bot1.success && bot2.success && bot3.success && bot4.success) {
        const teamSetup = {
            config: {
                mode: "squad_2v2",
                arenaWidth: 100,
                arenaHeight: 100,
                maxTicks: 3000,
                tickRate: 30,
                seed: 4242,
            },
            participants: [
                { program: bot1.program, constants: bot1.constants, playerId: "player1", teamId: 0 },
                { program: bot4.program, constants: bot4.constants, playerId: "player4", teamId: 0 },
                { program: bot2.program, constants: bot2.constants, playerId: "player2", teamId: 1 },
                { program: bot3.program, constants: bot3.constants, playerId: "player3", teamId: 1 },
            ],
        };
        const teamResult = runMatch(teamSetup);
        console.log(`  Winner: Team ${teamResult.winner !== null ? teamResult.winner : "DRAW"}`);
        console.log(`  Reason: ${teamResult.reason}`);
        console.log(`  Ticks: ${teamResult.tickCount}`);
    }
    // --- 3. Ranked System ---
    separator("3. RANKED — Elo Rating System");
    const ratingStore = new RatingStore();
    const matchRunner = new MatchRunner(ratingStore);
    if (bot1.success && bot2.success) {
        // Run multiple ranked matches
        for (let i = 0; i < 5; i++) {
            const response = matchRunner.runRankedMatch({
                player1: { playerId: "player1", program: bot1.program, constants: bot1.constants },
                player2: { playerId: "player2", program: bot2.program, constants: bot2.constants },
                config: {
                    mode: "1v1_ranked",
                    arenaWidth: 100,
                    arenaHeight: 100,
                    maxTicks: 3000,
                    tickRate: 30,
                    seed: 100 + i,
                },
            });
            console.log(`  Match ${i + 1}: Winner Team ${response.result.winner ?? "DRAW"} (${response.result.tickCount} ticks)`);
        }
        console.log("\n  Leaderboard:");
        for (const player of ratingStore.getLeaderboard()) {
            console.log(`    ${player.playerId}: Elo=${player.elo} Tier=${player.tier} W=${player.wins} L=${player.losses}`);
        }
    }
    // --- 4. Matchmaking ---
    separator("4. MATCHMAKING — Queue-Based Pairing");
    const matchmaking = new MatchmakingQueue(ratingStore);
    if (bot1.success && bot2.success) {
        matchmaking.enqueue("player1", bot1.program, bot1.constants);
        console.log("  player1 queued");
        matchmaking.enqueue("player2", bot2.program, bot2.constants);
        console.log("  player2 queued");
        const pairing = matchmaking.tryMatch();
        if (pairing) {
            console.log(`  Match found: ${pairing.player1.playerId} vs ${pairing.player2.playerId}`);
            console.log(`  Elo diff: ${Math.abs(pairing.player1.elo - pairing.player2.elo)}`);
        }
    }
    // --- 5. Tournament ---
    separator("5. TOURNAMENT — Single Elimination");
    const tournamentMgr = new TournamentManager();
    const allCompiled = compiledBots.filter(b => b.result.success);
    if (allCompiled.length >= 4) {
        const entries = allCompiled.map((b, i) => ({
            playerId: `player${i + 1}`,
            program: b.result.program,
            constants: b.result.constants,
            elo: ratingStore.getOrCreate(`player${i + 1}`).elo,
        }));
        const tournament = tournamentMgr.createTournament("PoC Championship", "single_elimination", entries, 999);
        console.log(`  Tournament: ${tournament.name} (${tournament.format})`);
        console.log(`  Participants: ${tournament.participants.length}`);
        // Run rounds
        let roundNum = 0;
        while (tournament.status === "in_progress") {
            const round = tournamentMgr.runCurrentRound(tournament.id);
            if (!round)
                break;
            roundNum++;
            console.log(`\n  Round ${roundNum}:`);
            for (const match of round.matches) {
                const p1 = tournament.participants[match.participant1Index];
                const p2 = tournament.participants[match.participant2Index];
                const winnerP = match.winner !== undefined ? tournament.participants[match.winner] : null;
                console.log(`    ${p1.playerId} vs ${p2.playerId} -> Winner: ${winnerP?.playerId ?? "?"}`);
            }
        }
        console.log("\n  Final Standings:");
        for (const p of tournamentMgr.getStandings(tournament.id)) {
            console.log(`    Seed #${p.seed} ${p.playerId}: W=${p.wins} L=${p.losses} ${p.eliminated ? "(eliminated)" : "(CHAMPION)"}`);
        }
    }
    // --- 6. Lobby System ---
    separator("6. LOBBY — Multiplayer Match Orchestration");
    const lobbyMgr = new LobbyManager(matchRunner, matchmaking);
    if (bot1.success && bot2.success) {
        const lobby = lobbyMgr.createLobby("player1", "Test Lobby");
        console.log(`  Lobby created: ${lobby.name} (${lobby.id})`);
        lobbyMgr.joinLobby(lobby.id, "player2");
        console.log("  player2 joined");
        lobbyMgr.submitProgram(lobby.id, "player1", bot1.program, bot1.constants);
        lobbyMgr.submitProgram(lobby.id, "player2", bot2.program, bot2.constants);
        console.log("  Both players submitted bots");
        const lobbyState = lobbyMgr.getLobby(lobby.id);
        console.log(`  Lobby status: ${lobbyState.status}`);
        const matchResponse = lobbyMgr.startMatch(lobby.id);
        if (matchResponse) {
            console.log(`  Match completed: Winner Team ${matchResponse.result.winner ?? "DRAW"}`);
            console.log(`  Match ID: ${matchResponse.record.matchId}`);
        }
    }
    // --- 7. Determinism Verification ---
    separator("7. DETERMINISM — Replay Verification");
    if (bot1.success && bot2.success) {
        const config = {
            mode: "1v1_ranked",
            arenaWidth: 100,
            arenaHeight: 100,
            maxTicks: 500,
            tickRate: 30,
            seed: 12345,
        };
        const setup = {
            config,
            participants: [
                { program: bot1.program, constants: bot1.constants, playerId: "p1", teamId: 0 },
                { program: bot2.program, constants: bot2.constants, playerId: "p2", teamId: 1 },
            ],
        };
        const run1 = runMatch(setup);
        const run2 = runMatch(setup);
        const deterministic = run1.tickCount === run2.tickCount &&
            run1.winner === run2.winner &&
            run1.replay.frames.length === run2.replay.frames.length;
        console.log(`  Run 1: Winner=${run1.winner} Ticks=${run1.tickCount}`);
        console.log(`  Run 2: Winner=${run2.winner} Ticks=${run2.tickCount}`);
        console.log(`  Deterministic: ${deterministic ? "YES" : "NO"}`);
        if (deterministic && run1.replay.frames.length > 0) {
            // Compare final frame
            const last1 = run1.replay.frames[run1.replay.frames.length - 1];
            const last2 = run2.replay.frames[run2.replay.frames.length - 1];
            let positionsMatch = true;
            for (let i = 0; i < last1.robots.length; i++) {
                const r1 = last1.robots[i];
                const r2 = last2.robots[i];
                if (Math.abs(r1.position.x - r2.position.x) > 0.001 ||
                    Math.abs(r1.position.y - r2.position.y) > 0.001) {
                    positionsMatch = false;
                }
            }
            console.log(`  Final positions match: ${positionsMatch ? "YES" : "NO"}`);
        }
    }
    separator("DEMO COMPLETE");
    console.log("  All systems operational. ArenaScript PoC is ready.\n");
}
main();
