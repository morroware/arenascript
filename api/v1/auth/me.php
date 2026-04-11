<?php

declare(strict_types=1);

require_once __DIR__ . '/../../_bootstrap.php';
require_once __DIR__ . '/../../db.php';

as_bootstrap();
as_require_method('GET');

$user = as_require_user();
$user['roles'] = as_user_roles((string) $user['id']);

as_respond(['user' => $user]);
