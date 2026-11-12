-- Migration 0025: Cursor Origin app installation id per user (from installation receipt on sign-in).
-- Used to mint installation access tokens and list repos the user granted to the DevStack Origin app.

CREATE TABLE cursor_installations (
  user_id          TEXT PRIMARY KEY NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  installation_id  TEXT NOT NULL,
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
) STRICT;

UPDATE schema_meta SET value = '25', updated_at = unixepoch('subsec') * 1000 WHERE key = 'schema_version';
