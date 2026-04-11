<?php

declare(strict_types=1);

require_once __DIR__ . '/../../_bootstrap.php';
require_once __DIR__ . '/../../db.php';

as_bootstrap();
as_require_method('POST');
as_require(
    as_rate_limit('auth_login:' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 20, 300),
    'Too many login attempts. Try again in a few minutes.',
    429,
);

$body = as_body();
$identity = strtolower(trim((string) ($body['identity'] ?? '')));
$password = (string) ($body['password'] ?? '');

as_require($identity !== '', 'identity is required');
as_require($password !== '', 'password is required');

$pdo = as_db();
$stmt = $pdo->prepare(
    'SELECT id, email, username, password_hash, status
     FROM users
     WHERE email = :identity OR username = :identity
     LIMIT 1'
);
$stmt->execute(['identity' => $identity]);
$user = $stmt->fetch();

as_require(is_array($user), 'Invalid credentials', 401);
as_require(($user['status'] ?? 'active') === 'active', 'Account is not active', 403);
as_require(password_verify($password, (string) $user['password_hash']), 'Invalid credentials', 401);

$session = as_issue_session((string) $user['id']);

$update = $pdo->prepare('UPDATE users SET last_login_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = :id');
$update->execute(['id' => $user['id']]);

$roles = as_user_roles((string) $user['id']);

as_respond([
    'user' => [
        'id' => $user['id'],
        'email' => $user['email'],
        'username' => $user['username'],
        'status' => $user['status'],
        'roles' => $roles,
    ],
    'session' => $session,
]);
