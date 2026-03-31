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

/** Calculate new Elo ratings after a match */
function calculateEloChange(float $winnerRating, float $loserRating): array
{
    $expectedWin = expectedScore($winnerRating, $loserRating);
    $expectedLose = expectedScore($loserRating, $winnerRating);

    $kWinner = getKFactor($winnerRating);
    $kLoser = getKFactor($loserRating);

    $winnerDelta = (int) round($kWinner * (1 - $expectedWin));
    $loserDelta = (int) round($kLoser * (0 - $expectedLose));

    return [
        'winnerNew'   => $winnerRating + $winnerDelta,
        'loserNew'    => max(0, $loserRating + $loserDelta),
        'winnerDelta' => $winnerDelta,
        'loserDelta'  => $loserDelta,
    ];
}

/** Calculate Elo change for a draw */
function calculateEloDraw(float $ratingA, float $ratingB): array
{
    $expectedA = expectedScore($ratingA, $ratingB);
    $expectedB = expectedScore($ratingB, $ratingA);

    $kA = getKFactor($ratingA);
    $kB = getKFactor($ratingB);

    $deltaA = (int) round($kA * (0.5 - $expectedA));
    $deltaB = (int) round($kB * (0.5 - $expectedB));

    return [
        'newA'   => max(0, $ratingA + $deltaA),
        'newB'   => max(0, $ratingB + $deltaB),
        'deltaA' => $deltaA,
        'deltaB' => $deltaB,
    ];
}

/** Determine rank tier from Elo rating */
function getRankTier(int $elo): string
{
    if ($elo >= RANK_THRESHOLDS['champion']) return 'champion';
    if ($elo >= RANK_THRESHOLDS['diamond'])  return 'diamond';
    if ($elo >= RANK_THRESHOLDS['platinum']) return 'platinum';
    if ($elo >= RANK_THRESHOLDS['gold'])     return 'gold';
    if ($elo >= RANK_THRESHOLDS['silver'])   return 'silver';
    return 'bronze';
}

/** In-memory player rating store (for PoC -- production would use a database) */
class RatingStore
{
    /** @var array<string, array> */
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

    /** Update ratings after a match with a winner */
    public function recordResult(string $winnerId, string $loserId, string $matchId): array
    {
        $winner = $this->getOrCreate($winnerId);
        $loser = $this->getOrCreate($loserId);

        $change = calculateEloChange($winner['elo'], $loser['elo']);

        $winner['elo'] = $change['winnerNew'];
        $winner['tier'] = getRankTier((int) $change['winnerNew']);
        $winner['wins']++;
        $winner['matchHistory'][] = $matchId;

        $loser['elo'] = $change['loserNew'];
        $loser['tier'] = getRankTier((int) $change['loserNew']);
        $loser['losses']++;
        $loser['matchHistory'][] = $matchId;

        $this->ratings[$winnerId] = $winner;
        $this->ratings[$loserId] = $loser;

        return [
            'winnerRating' => $winner,
            'loserRating'  => $loser,
        ];
    }

    /** Update ratings after a draw */
    public function recordDraw(string $playerAId, string $playerBId, string $matchId): void
    {
        $a = $this->getOrCreate($playerAId);
        $b = $this->getOrCreate($playerBId);

        $change = calculateEloDraw($a['elo'], $b['elo']);

        $a['elo'] = $change['newA'];
        $a['tier'] = getRankTier((int) $change['newA']);
        $a['draws']++;
        $a['matchHistory'][] = $matchId;

        $b['elo'] = $change['newB'];
        $b['tier'] = getRankTier((int) $change['newB']);
        $b['draws']++;
        $b['matchHistory'][] = $matchId;

        $this->ratings[$playerAId] = $a;
        $this->ratings[$playerBId] = $b;
    }

    /** Get leaderboard sorted by Elo descending */
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
