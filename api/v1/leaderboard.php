<?php

declare(strict_types=1);

require_once __DIR__ . '/../_bootstrap.php';
require_once __DIR__ . '/../db.php';

as_bootstrap();
as_require_method('GET');

$queue = (string) ($_GET['queue'] ?? '1v1_ranked');
$limit = max(1, min(200, (int) ($_GET['limit'] ?? 100)));

$pdo = as_db();
$stmt = $pdo->prepare(
    'SELECT r.user_id, u.username, r.queue, r.elo, r.wins, r.losses, r.draws, r.provisional_games, r.updated_at
     FROM ratings r
     JOIN users u ON u.id = r.user_id
     WHERE r.queue = :queue
     ORDER BY r.elo DESC, r.updated_at ASC
     LIMIT :limit'
);
$stmt->bindValue('queue', $queue);
$stmt->bindValue('limit', $limit, PDO::PARAM_INT);
$stmt->execute();

as_respond([
    'queue' => $queue,
    'leaderboard' => $stmt->fetchAll(),
]);
