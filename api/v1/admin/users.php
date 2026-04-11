<?php

declare(strict_types=1);

require_once __DIR__ . '/../../_bootstrap.php';
require_once __DIR__ . '/../../db.php';

as_bootstrap();
as_require_method('GET');

as_require_role('admin');

$limit = max(1, min(200, (int) ($_GET['limit'] ?? 50)));
$offset = max(0, (int) ($_GET['offset'] ?? 0));
$status = (string) ($_GET['status'] ?? '');

$pdo = as_db();
if ($status !== '' && in_array($status, ['active', 'suspended', 'deleted'], true)) {
    $stmt = $pdo->prepare(
        'SELECT id, email, username, status, created_at, updated_at, last_login_at
         FROM users WHERE status = :status
         ORDER BY created_at DESC LIMIT :limit OFFSET :offset'
    );
    $stmt->bindValue('status', $status);
} else {
    $stmt = $pdo->prepare(
        'SELECT id, email, username, status, created_at, updated_at, last_login_at
         FROM users ORDER BY created_at DESC LIMIT :limit OFFSET :offset'
    );
}
$stmt->bindValue('limit', $limit, PDO::PARAM_INT);
$stmt->bindValue('offset', $offset, PDO::PARAM_INT);
$stmt->execute();

as_respond(['users' => $stmt->fetchAll(), 'limit' => $limit, 'offset' => $offset]);
