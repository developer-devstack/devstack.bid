-- User custom domains (BYO hostname on devstack-sites) and optional server Worker bindings (hosted SSR only).
CREATE TABLE IF NOT EXISTS project_custom_domains (
  id              TEXT PRIMARY KEY NOT NULL,
  project_id      TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  hostname        TEXT NOT NULL COLLATE NOCASE,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'error', 'removed')),
  verify_token    TEXT NOT NULL,
  cf_domain_id    TEXT,
  error_message   TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  verified_at     INTEGER
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS project_custom_domains_hostname_uq ON project_custom_domains (hostname) WHERE status != 'removed';
CREATE INDEX IF NOT EXISTS project_custom_domains_project_idx ON project_custom_domains (project_id, status);

CREATE TABLE IF NOT EXISTS project_server_bindings (
  project_id      TEXT PRIMARY KEY NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  bindings_json   TEXT NOT NULL DEFAULT '{}',
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
) STRICT;

UPDATE schema_meta SET value = '24', updated_at = unixepoch('subsec') * 1000 WHERE key = 'schema_version';
