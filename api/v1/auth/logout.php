<?php

declare(strict_types=1);

require_once __DIR__ . '/../../_bootstrap.php';
require_once __DIR__ . '/../../db.php';

as_bootstrap();
as_require_method('POST');

$token = as_bearer_token();
as_require(is_string($token), 'Bearer token is required', 401);

$pdo = as_db();
$stmt = $pdo->prepare('UPDATE sessions SET revoked_at = UTC_TIMESTAMP() WHERE token_hash = :token_hash AND revoked_at IS NULL');
$stmt->execute(['token_hash' => as_session_token_hash($token)]);

as_respond(['ok' => true]);
