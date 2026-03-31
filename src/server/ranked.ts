// ============================================================================
// Ranked System — Elo Ratings and Rank Tiers
// ============================================================================

import type { PlayerRating, RankTier } from "../shared/types.js";
import { INITIAL_ELO, ELO_K_FACTOR, ELO_K_FACTOR_HIGH, RANK_THRESHOLDS } from "../shared/config.js";

/** Calculate expected score using standard Elo formula */
function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/** Get K-factor based on rating (higher-rated players change slower) */
function getKFactor(rating: number): number {
  return rating > 2400 ? ELO_K_FACTOR_HIGH : ELO_K_FACTOR;
}

/** Calculate new Elo ratings after a match */
export function calculateEloChange(
  winnerRating: number,
  loserRating: number,
): { winnerNew: number; loserNew: number; winnerDelta: number; loserDelta: number } {
  const expectedWin = expectedScore(winnerRating, loserRating);
  const expectedLose = expectedScore(loserRating, winnerRating);

  const kWinner = getKFactor(winnerRating);
  const kLoser = getKFactor(loserRating);

  const winnerDelta = Math.round(kWinner * (1 - expectedWin));
  const loserDelta = Math.round(kLoser * (0 - expectedLose));

  return {
    winnerNew: winnerRating + winnerDelta,
    loserNew: Math.max(0, loserRating + loserDelta),
    winnerDelta,
    loserDelta,
  };
}

/** Calculate Elo change for a draw */
export function calculateEloDraw(
  ratingA: number,
  ratingB: number,
): { newA: number; newB: number; deltaA: number; deltaB: number } {
  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = expectedScore(ratingB, ratingA);

  const kA = getKFactor(ratingA);
  const kB = getKFactor(ratingB);

  const deltaA = Math.round(kA * (0.5 - expectedA));
  const deltaB = Math.round(kB * (0.5 - expectedB));

  return {
    newA: Math.max(0, ratingA + deltaA),
    newB: Math.max(0, ratingB + deltaB),
    deltaA,
    deltaB,
  };
}

/** Determine rank tier from Elo rating */
export function getRankTier(elo: number): RankTier {
  if (elo >= RANK_THRESHOLDS.champion) return "champion";
  if (elo >= RANK_THRESHOLDS.diamond) return "diamond";
  if (elo >= RANK_THRESHOLDS.platinum) return "platinum";
  if (elo >= RANK_THRESHOLDS.gold) return "gold";
  if (elo >= RANK_THRESHOLDS.silver) return "silver";
  return "bronze";
}

/** In-memory player rating store (for PoC — production would use a database) */
export class RatingStore {
  private ratings = new Map<string, PlayerRating>();

  getOrCreate(playerId: string): PlayerRating {
    if (!this.ratings.has(playerId)) {
      this.ratings.set(playerId, {
        playerId,
        elo: INITIAL_ELO,
        tier: getRankTier(INITIAL_ELO),
        wins: 0,
        losses: 0,
        draws: 0,
        matchHistory: [],
      });
    }
    return this.ratings.get(playerId)!;
  }

  /** Update ratings after a match with a winner */
  recordResult(winnerId: string, loserId: string, matchId: string): {
    winnerRating: PlayerRating;
    loserRating: PlayerRating;
  } {
    const winner = this.getOrCreate(winnerId);
    const loser = this.getOrCreate(loserId);

    const { winnerNew, loserNew } = calculateEloChange(winner.elo, loser.elo);

    winner.elo = winnerNew;
    winner.tier = getRankTier(winnerNew);
    winner.wins++;
    winner.matchHistory.push(matchId);

    loser.elo = loserNew;
    loser.tier = getRankTier(loserNew);
    loser.losses++;
    loser.matchHistory.push(matchId);

    return { winnerRating: winner, loserRating: loser };
  }

  /** Update ratings after a draw */
  recordDraw(playerAId: string, playerBId: string, matchId: string): void {
    const a = this.getOrCreate(playerAId);
    const b = this.getOrCreate(playerBId);

    const { newA, newB } = calculateEloDraw(a.elo, b.elo);

    a.elo = newA;
    a.tier = getRankTier(newA);
    a.draws++;
    a.matchHistory.push(matchId);

    b.elo = newB;
    b.tier = getRankTier(newB);
    b.draws++;
    b.matchHistory.push(matchId);
  }

  /** Get leaderboard sorted by Elo descending */
  getLeaderboard(limit = 100): PlayerRating[] {
    return [...this.ratings.values()]
      .sort((a, b) => b.elo - a.elo)
      .slice(0, limit);
  }

  getPlayerCount(): number {
    return this.ratings.size;
  }
}
