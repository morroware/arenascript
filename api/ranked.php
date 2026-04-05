<?php
// ============================================================================
// Ranked System — Elo Ratings and Rank Tiers
// ============================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/_bootstrap.php';

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
 * File-backed player rating store. State persists across requests in
 * api/.storage/ratings.json. For beta scale (low-thousands of players)
 * the read-modify-write cost is negligible. Swap for a DB when needed —
 * the public interface is the only thing callers depend on.
 */
class RatingStore
{
    private JsonStore $store;

    public function __construct(?JsonStore $store = null)
    {
        $this->store = $store ?? new JsonStore('ratings');
    }

    private static function freshRating(string $playerId): array
    {
        return [
            'playerId'     => $playerId,
            'elo'          => INITIAL_ELO,
            'tier'         => getRankTier(INITIAL_ELO),
            'wins'         => 0,
            'losses'       => 0,
            'draws'        => 0,
            'matchHistory' => [],
        ];
    }

    public function getOrCreate(string $playerId): array
    {
        return $this->store->mutate(function (array $state) use ($playerId): array {
            if (!isset($state[$playerId])) {
                $state[$playerId] = self::freshRating($playerId);
            }
            return [$state, $state[$playerId]];
        });
    }

    /** Read-only lookup. Returns null if the player has never been recorded. */
    public function find(string $playerId): ?array
    {
        $all = $this->store->readAll();
        return $all[$playerId] ?? null;
    }

    /**
     * Update ratings after a match with a winner.
     *
     * @return array{winnerRating: array, loserRating: array}
     */
    public function recordResult(string $winnerId, string $loserId, string $matchId): array
    {
        return $this->store->mutate(function (array $state) use ($winnerId, $loserId, $matchId): array {
            $winner = $state[$winnerId] ?? self::freshRating($winnerId);
            $loser  = $state[$loserId]  ?? self::freshRating($loserId);

            $result = calculateEloChange($winner['elo'], $loser['elo']);

            $winner['elo']  = $result['winnerNew'];
            $winner['tier'] = getRankTier($result['winnerNew']);
            $winner['wins']++;
            $winner['matchHistory'][] = $matchId;

            $loser['elo']  = $result['loserNew'];
            $loser['tier'] = getRankTier($result['loserNew']);
            $loser['losses']++;
            $loser['matchHistory'][] = $matchId;

            $state[$winnerId] = $winner;
            $state[$loserId]  = $loser;

            return [$state, ['winnerRating' => $winner, 'loserRating' => $loser]];
        });
    }

    /** Update ratings after a draw */
    public function recordDraw(string $playerAId, string $playerBId, string $matchId): void
    {
        $this->store->mutate(function (array $state) use ($playerAId, $playerBId, $matchId): array {
            $a = $state[$playerAId] ?? self::freshRating($playerAId);
            $b = $state[$playerBId] ?? self::freshRating($playerBId);

            $result = calculateEloDraw($a['elo'], $b['elo']);

            $a['elo']  = $result['newA'];
            $a['tier'] = getRankTier($result['newA']);
            $a['draws']++;
            $a['matchHistory'][] = $matchId;

            $b['elo']  = $result['newB'];
            $b['tier'] = getRankTier($result['newB']);
            $b['draws']++;
            $b['matchHistory'][] = $matchId;

            $state[$playerAId] = $a;
            $state[$playerBId] = $b;

            return [$state, null];
        });
    }

    /**
     * Get leaderboard sorted by Elo descending.
     *
     * @return array[]
     */
    public function getLeaderboard(int $limit = 100): array
    {
        $all = array_values($this->store->readAll());
        usort($all, fn(array $a, array $b) => $b['elo'] <=> $a['elo']);
        return array_slice($all, 0, max(0, $limit));
    }

    public function getPlayerCount(): int
    {
        return count($this->store->readAll());
    }
}

// ----------------------------------------------------------------------------
// HTTP dispatcher
// ----------------------------------------------------------------------------
// GET  /api/ranked.php?player=<id>   -> single player rating (auto-created)
// GET  /api/ranked.php?leaderboard=1 -> top 100 leaderboard
// POST /api/ranked.php  { winner, loser, matchId }     -> record decisive result
// POST /api/ranked.php  { draw: [a,b], matchId }       -> record draw
// ----------------------------------------------------------------------------

if (PHP_SAPI !== 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    as_bootstrap();
    $store = new RatingStore();

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        if (isset($_GET['leaderboard'])) {
            $limit = isset($_GET['limit']) ? (int) $_GET['limit'] : 100;
            as_respond(['leaderboard' => $store->getLeaderboard($limit)]);
        }
        $player = $_GET['player'] ?? null;
        if (!is_string($player) || $player === '') {
            as_error('Missing query parameter: player (or leaderboard=1)', 400);
        }
        as_respond(['rating' => $store->getOrCreate($player)]);
    }

    if ($method === 'POST') {
        $body    = as_body();
        $matchId = $body['matchId'] ?? null;
        as_require(is_string($matchId) && $matchId !== '', 'matchId is required');

        if (isset($body['draw'])) {
            as_require(
                is_array($body['draw']) && count($body['draw']) === 2 &&
                is_string($body['draw'][0]) && is_string($body['draw'][1]),
                'draw must be a [playerA, playerB] array',
            );
            $store->recordDraw($body['draw'][0], $body['draw'][1], $matchId);
            as_respond([
                'ok'   => true,
                'a'    => $store->find($body['draw'][0]),
                'b'    => $store->find($body['draw'][1]),
            ]);
        }

        $winner = $body['winner'] ?? null;
        $loser  = $body['loser']  ?? null;
        as_require(
            is_string($winner) && $winner !== '' && is_string($loser) && $loser !== '',
            'winner and loser are required (or provide draw=[a,b])',
        );
        as_require($winner !== $loser, 'winner and loser must differ');

        $result = $store->recordResult($winner, $loser, $matchId);
        as_respond(['ok' => true] + $result);
    }

    as_require_method('GET', 'POST');
}
