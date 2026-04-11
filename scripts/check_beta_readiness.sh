#!/usr/bin/env bash
set -euo pipefail

echo "[1/3] JavaScript syntax"
node --check js/api-client.js
node --check js/app.js

echo "[2/3] Core PHP syntax"
php -l api/_bootstrap.php
php -l api/db.php
php -l api/install.php

echo "[3/3] v1 endpoint syntax"
php -l api/v1/auth/register.php
php -l api/v1/auth/login.php
php -l api/v1/auth/logout.php
php -l api/v1/auth/me.php
php -l api/v1/bots/index.php
php -l api/v1/bots/versions.php
php -l api/v1/admin/users.php
php -l api/v1/admin/suspend-user.php
php -l api/v1/leaderboard.php
php -l api/v1/lobbies/index.php
php -l api/v1/matches/report.php

echo "Beta readiness syntax checks passed."
