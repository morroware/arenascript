<?php
// ============================================================================
// Auth — anonymous player token issuance
// ----------------------------------------------------------------------------
// The ArenaScript backend uses lightweight anonymous bearer tokens: 32 hex
// characters of cryptographic randomness, sent in the X-Arena-Player header.
//
// This endpoint mints a fresh token on demand. The client is responsible for
// persisting it (localStorage). There is no password, no account recovery,
// and no rate-limiting beyond what the host provides — it's the minimum
// viable identity system for a beta and should be replaced with a real
// account system before public launch.
// ============================================================================

require_once __DIR__ . '/_bootstrap.php';

as_bootstrap();
as_require_method('POST', 'GET');

as_respond([
    'playerId' => as_issue_token(),
    'note'     => 'Store this token in localStorage and send it in X-Arena-Player on every authenticated request.',
], 201);
