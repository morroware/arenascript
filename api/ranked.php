<?php
// ============================================================================
// Ranked System — Elo Ratings and Rank Tiers
// ============================================================================

require_once __DIR__ . '/config.php';

/** Calculate expected score using standard Elo formula */
function expectedScore(float $ratingA, float $ratingB): float
{
    return 1.0 / (1.0 + pow(10, ($ratingB - $ratingA) / 400));
}

/** Get K-factor based on rating (higher-rated players change slower) */
function getKFactor(float $rating): int
{
    return $rating > 2400 ? ELO_K_FACTOR_HIGH : ELO_K_FACTOR;
}

/**
 * Calculate new Elo ratings after a match.
 *
 * @return array{winnerNew: int, loserNew: int, winnerDelta: int, loserDelta: int}
 */
function calculateEloChange(float $winnerRating, float $loserRating): array
{
    $expectedWin  = expectedScore($winnerRating, $loserRating);

    // Use average K-factor for both players to maintain zero-sum
    $kWinner = getKFactor($winnerRating);
    $kLoser  = getKFactor($loserRating);
    $k = ($kWinner + $kLoser) / 2;

    $winnerDelta = (int) round($k * (1 - $expectedWin));
    // Enforce the rating floor of 0 without breaking zero-sum. Previously
    // the loser was clamped via max(0, ...) while the winner still received
    // the full delta, inflating total Elo on the ladder over time.
    if ($loserRating - $winnerDelta < 0) {
        $winnerDelta = (int) $loserRating;
    }
    $loserDelta = -$winnerDelta;

    return [
        'winnerNew'   => (int) ($winnerRating + $winnerDelta),
        'loserNew'    => (int) ($loserRating + $loserDelta),
        'winnerDelta' => $winnerDelta,
        'loserDelta'  => $loserDelta,
    ];
}

/**
 * Calculate Elo change for a draw.
 *
 * @return array{newA: int, newB: int, deltaA: int, deltaB: int}
 */
function calculateEloDraw(float $ratingA, float $ratingB): array
{
    $expectedA = expectedScore($ratingA, $ratingB);
    $expectedB = expectedScore($ratingB, $ratingA);

    $kA = getKFactor($ratingA);
    $kB = getKFactor($ratingB);

    $deltaA = (int) round($kA * (0.5 - $expectedA));
    $deltaB = (int) round($kB * (0.5 - $expectedB));

    return [
        'newA'   => (int) max(0, $ratingA + $deltaA),
        'newB'   => (int) max(0, $ratingB + $deltaB),
        'deltaA' => $deltaA,
        'deltaB' => $deltaB,
    ];
}

/** Determine rank tier from Elo rating */
function getRankTier(int $elo): string
{
    // Iterate thresholds in descending order so changes to config are auto-reflected
    $tiers = RANK_THRESHOLDS;
    arsort($tiers);
    foreach ($tiers as $tier => $threshold) {
        if ($elo >= $threshold) {
            return $tier;
        }
    }
    return 'bronze';
}

/**
 * In-memory player rating store (for PoC — production would use a database).
 */
class RatingStore
{
    /** @var array<string, array> playerId => PlayerRating */
    private array $ratings = [];

    public function getOrCreate(string $playerId): array
    {
        if (!isset($this->ratings[$playerId])) {
            $this->ratings[$playerId] = [
                'playerId'     => $playerId,
                'elo'          => INITIAL_ELO,
                'tier'         => getRankTier(INITIAL_ELO),
                'wins'         => 0,
                'losses'       => 0,
                'draws'        => 0,
                'matchHistory' => [],
            ];
        }
        return $this->ratings[$playerId];
    }

    /**
     * Update ratings after a match with a winner.
     *
     * @return array{winnerRating: array, loserRating: array}
     */
    public function recordResult(string $winnerId, string $loserId, string $matchId): array
    {
        $winner = $this->getOrCreate($winnerId);
        $loser  = $this->getOrCreate($loserId);

        $result = calculateEloChange($winner['elo'], $loser['elo']);

        $winner['elo']  = $result['winnerNew'];
        $winner['tier'] = getRankTier($result['winnerNew']);
        $winner['wins']++;
        $winner['matchHistory'][] = $matchId;

        $loser['elo']  = $result['loserNew'];
        $loser['tier'] = getRankTier($result['loserNew']);
        $loser['losses']++;
        $loser['matchHistory'][] = $matchId;

        $this->ratings[$winnerId] = $winner;
        $this->ratings[$loserId]  = $loser;

        return ['winnerRating' => $winner, 'loserRating' => $loser];
    }

    /** Update ratings after a draw */
    public function recordDraw(string $playerAId, string $playerBId, string $matchId): void
    {
        $a = $this->getOrCreate($playerAId);
        $b = $this->getOrCreate($playerBId);

        $result = calculateEloDraw($a['elo'], $b['elo']);

        $a['elo']  = $result['newA'];
        $a['tier'] = getRankTier($result['newA']);
        $a['draws']++;
        $a['matchHistory'][] = $matchId;

        $b['elo']  = $result['newB'];
        $b['tier'] = getRankTier($result['newB']);
        $b['draws']++;
        $b['matchHistory'][] = $matchId;

        $this->ratings[$playerAId] = $a;
        $this->ratings[$playerBId] = $b;
    }

    /**
     * Get leaderboard sorted by Elo descending.
     *
     * @return array[]
     */
    public function getLeaderboard(int $limit = 100): array
    {
        $all = array_values($this->ratings);
        usort($all, fn(array $a, array $b) => $b['elo'] <=> $a['elo']);
        return array_slice($all, 0, $limit);
    }

    public function getPlayerCount(): int
    {
        return count($this->ratings);
    }
}
