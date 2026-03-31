// ============================================================================
// Tournament System — Single Elimination, Round Robin, Swiss
// ============================================================================

import type {
  Tournament, TournamentFormat, TournamentParticipant,
  TournamentRound, TournamentMatch, CompiledProgram,
} from "../shared/types.js";
import type { ConstPoolEntry } from "../runtime/opcodes.js";
import { runMatch, type MatchSetup } from "../engine/tick.js";
import { SeededRNG } from "../shared/prng.js";

export interface TournamentEntry {
  playerId: string;
  program: CompiledProgram;
  constants: ConstPoolEntry[];
  elo: number;
}

export class TournamentManager {
  private tournaments = new Map<string, TournamentState>();

  createTournament(
    name: string,
    format: TournamentFormat,
    entries: TournamentEntry[],
    seed = Date.now(),
  ): Tournament {
    const id = `tournament_${seed}`;
    const rng = new SeededRNG(seed);

    // Seed participants by Elo (highest first)
    const sorted = [...entries].sort((a, b) => b.elo - a.elo);

    const participants: TournamentParticipant[] = sorted.map((e, i) => ({
      playerId: e.playerId,
      programId: e.program.programId,
      seed: i + 1,
      wins: 0,
      losses: 0,
      eliminated: false,
    }));

    const tournament: Tournament = {
      id,
      name,
      format,
      status: "in_progress",
      participants,
      rounds: [],
      createdAt: Date.now(),
    };

    this.tournaments.set(id, {
      tournament,
      entries: sorted,
      rng,
      currentRound: 0,
    });

    // Generate first round
    this.generateNextRound(id);

    return tournament;
  }

  /** Generate pairings for the next round */
  private generateNextRound(tournamentId: string): TournamentRound | null {
    const state = this.tournaments.get(tournamentId);
    if (!state) return null;

    const { tournament, rng } = state;
    const active = tournament.participants.filter(p => !p.eliminated);

    if (active.length < 2) return null;

    let matches: TournamentMatch[];

    switch (tournament.format) {
      case "single_elimination":
        matches = this.generateSingleEliminationPairings(active, rng);
        break;
      case "round_robin":
        matches = this.generateRoundRobinPairings(tournament, state.currentRound);
        break;
      case "swiss":
        matches = this.generateSwissPairings(active, rng);
        break;
      default:
        return null;
    }

    const round: TournamentRound = {
      roundNumber: state.currentRound + 1,
      matches,
      completed: false,
    };

    tournament.rounds.push(round);
    state.currentRound++;

    return round;
  }

  /** Run all matches in the current round */
  runCurrentRound(tournamentId: string): TournamentRound | null {
    const state = this.tournaments.get(tournamentId);
    if (!state) return null;

    const { tournament, entries, rng } = state;
    const currentRound = tournament.rounds[tournament.rounds.length - 1];
    if (!currentRound || currentRound.completed) return null;

    for (const match of currentRound.matches) {
      if (match.completed) continue;

      const entry1 = entries[match.participant1Index];
      const entry2 = entries[match.participant2Index];

      if (!entry1 || !entry2) continue;

      const setup: MatchSetup = {
        config: {
          mode: "tournament",
          arenaWidth: 100,
          arenaHeight: 100,
          maxTicks: 3000,
          tickRate: 30,
          seed: rng.nextInt(0, 2147483647),
        },
        participants: [
          {
            program: entry1.program,
            constants: entry1.constants,
            playerId: entry1.playerId,
            teamId: 0,
          },
          {
            program: entry2.program,
            constants: entry2.constants,
            playerId: entry2.playerId,
            teamId: 1,
          },
        ],
      };

      const result = runMatch(setup);
      match.matchId = `tmatch_${rng.nextInt(0, 999999)}`;
      match.completed = true;

      if (result.winner === 0) {
        match.winner = match.participant1Index;
        tournament.participants[match.participant1Index].wins++;
        tournament.participants[match.participant2Index].losses++;
        if (tournament.format === "single_elimination") {
          tournament.participants[match.participant2Index].eliminated = true;
        }
      } else if (result.winner === 1) {
        match.winner = match.participant2Index;
        tournament.participants[match.participant2Index].wins++;
        tournament.participants[match.participant1Index].losses++;
        if (tournament.format === "single_elimination") {
          tournament.participants[match.participant1Index].eliminated = true;
        }
      } else {
        // Draw — in single elimination, give it to higher seed
        match.winner = match.participant1Index;
        if (tournament.format === "single_elimination") {
          tournament.participants[match.participant2Index].eliminated = true;
        }
      }
    }

    currentRound.completed = true;

    // Check if tournament is over
    const active = tournament.participants.filter(p => !p.eliminated);
    if (tournament.format === "single_elimination" && active.length <= 1) {
      tournament.status = "completed";
    } else if (tournament.format === "round_robin") {
      // Round robin ends when we've done n-1 rounds
      const totalRounds = tournament.participants.length - 1;
      if (tournament.rounds.length >= totalRounds) {
        tournament.status = "completed";
      } else {
        this.generateNextRound(tournamentId);
      }
    } else if (tournament.format === "swiss") {
      // Swiss typically runs log2(n) rounds
      const totalRounds = Math.ceil(Math.log2(tournament.participants.length));
      if (tournament.rounds.length >= totalRounds) {
        tournament.status = "completed";
      } else {
        this.generateNextRound(tournamentId);
      }
    }

    // Generate next round if not complete
    if (tournament.status === "in_progress" && tournament.format === "single_elimination") {
      this.generateNextRound(tournamentId);
    }

    return currentRound;
  }

  /** Get tournament standings */
  getStandings(tournamentId: string): TournamentParticipant[] {
    const state = this.tournaments.get(tournamentId);
    if (!state) return [];
    return [...state.tournament.participants].sort((a, b) => {
      if (a.eliminated && !b.eliminated) return 1;
      if (!a.eliminated && b.eliminated) return -1;
      return b.wins - a.wins || a.losses - b.losses || a.seed - b.seed;
    });
  }

  getTournament(id: string): Tournament | undefined {
    return this.tournaments.get(id)?.tournament;
  }

  // --- Pairing Generators ---

  private generateSingleEliminationPairings(
    active: TournamentParticipant[],
    rng: SeededRNG,
  ): TournamentMatch[] {
    const matches: TournamentMatch[] = [];
    // Pair by seed: 1v(n), 2v(n-1), etc.
    const sorted = [...active].sort((a, b) => a.seed - b.seed);
    for (let i = 0; i < Math.floor(sorted.length / 2); i++) {
      const p1 = sorted[i];
      const p2 = sorted[sorted.length - 1 - i];
      matches.push({
        matchId: "",
        participant1Index: p1.seed - 1,
        participant2Index: p2.seed - 1,
        completed: false,
      });
    }
    // Bye for odd participant (auto-advance highest remaining)
    return matches;
  }

  private generateRoundRobinPairings(
    tournament: Tournament,
    roundIndex: number,
  ): TournamentMatch[] {
    const n = tournament.participants.length;
    const matches: TournamentMatch[] = [];

    // Circle method for round-robin scheduling
    // Fix player 0, rotate others
    const indices = Array.from({ length: n }, (_, i) => i);

    for (let r = 0; r < roundIndex; r++) {
      // Rotate all except first
      const last = indices.pop()!;
      indices.splice(1, 0, last);
    }

    for (let i = 0; i < Math.floor(n / 2); i++) {
      matches.push({
        matchId: "",
        participant1Index: indices[i],
        participant2Index: indices[n - 1 - i],
        completed: false,
      });
    }

    return matches;
  }

  private generateSwissPairings(
    active: TournamentParticipant[],
    rng: SeededRNG,
  ): TournamentMatch[] {
    // Sort by wins (desc), then by seed
    const sorted = [...active].sort((a, b) => b.wins - a.wins || a.seed - b.seed);
    const matches: TournamentMatch[] = [];
    const paired = new Set<number>();

    for (let i = 0; i < sorted.length; i++) {
      if (paired.has(sorted[i].seed - 1)) continue;
      for (let j = i + 1; j < sorted.length; j++) {
        if (paired.has(sorted[j].seed - 1)) continue;
        matches.push({
          matchId: "",
          participant1Index: sorted[i].seed - 1,
          participant2Index: sorted[j].seed - 1,
          completed: false,
        });
        paired.add(sorted[i].seed - 1);
        paired.add(sorted[j].seed - 1);
        break;
      }
    }

    return matches;
  }
}

interface TournamentState {
  tournament: Tournament;
  entries: TournamentEntry[];
  rng: SeededRNG;
  currentRound: number;
}
