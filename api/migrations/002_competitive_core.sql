-- ArenaScript MySQL competitive systems schema (v1)

CREATE TABLE IF NOT EXISTS ratings (
  user_id CHAR(36) NOT NULL,
  queue VARCHAR(40) NOT NULL,
  elo INT NOT NULL DEFAULT 1000,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  draws INT NOT NULL DEFAULT 0,
  provisional_games INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (user_id, queue),
  CONSTRAINT fk_ratings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_ratings_queue_elo (queue, elo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS matches (
  id CHAR(36) PRIMARY KEY,
  mode VARCHAR(40) NOT NULL,
  seed INT NOT NULL,
  tick_count INT NOT NULL,
  winner_team INT NULL,
  reason VARCHAR(120) NOT NULL,
  reported_by_user_id CHAR(36) NOT NULL,
  result_json LONGTEXT NOT NULL,
  replay_json LONGTEXT NULL,
  created_at DATETIME NOT NULL,
  CONSTRAINT fk_matches_reporter FOREIGN KEY (reported_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_matches_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS match_participants (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  match_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  team_id INT NOT NULL,
  bot_version_id CHAR(36) NULL,
  result ENUM('win','loss','draw') NOT NULL,
  elo_before INT NULL,
  elo_after INT NULL,
  CONSTRAINT fk_match_participants_match FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  CONSTRAINT fk_match_participants_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_match_participants_bot_version FOREIGN KEY (bot_version_id) REFERENCES bot_versions(id) ON DELETE SET NULL,
  INDEX idx_match_participants_match (match_id),
  INDEX idx_match_participants_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lobbies (
  id CHAR(36) PRIMARY KEY,
  host_user_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  mode VARCHAR(40) NOT NULL,
  status ENUM('waiting','ready','in_match','completed','cancelled') NOT NULL DEFAULT 'waiting',
  settings_json LONGTEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  CONSTRAINT fk_lobbies_host FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_lobbies_status (status),
  INDEX idx_lobbies_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lobby_players (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  lobby_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  slot_index INT NOT NULL,
  ready_state TINYINT(1) NOT NULL DEFAULT 0,
  submitted_bot_version_id CHAR(36) NULL,
  joined_at DATETIME NOT NULL,
  UNIQUE KEY uq_lobby_user (lobby_id, user_id),
  UNIQUE KEY uq_lobby_slot (lobby_id, slot_index),
  CONSTRAINT fk_lobby_players_lobby FOREIGN KEY (lobby_id) REFERENCES lobbies(id) ON DELETE CASCADE,
  CONSTRAINT fk_lobby_players_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_lobby_players_bot_version FOREIGN KEY (submitted_bot_version_id) REFERENCES bot_versions(id) ON DELETE SET NULL,
  INDEX idx_lobby_players_lobby (lobby_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
