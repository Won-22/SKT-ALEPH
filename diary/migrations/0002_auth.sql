-- 0002: 로그인(계정·세션) + 계획의 주인(user_id) + 5일 관찰 표. 이미 쌓인 6번 자료는 지우지 않는다.
-- 주인이 없는(user_id 가 NULL 인) 6번 자료는 어느 계정에도 보이지 않는다. 내 계정으로 옮기는 방법은 docs/T07-auth-explainer.md.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  login_id   TEXT    NOT NULL UNIQUE CHECK (length(login_id) BETWEEN 3 AND 30),
  pw_algo    TEXT    NOT NULL,
  pw_iter    INTEGER NOT NULL CHECK (pw_iter > 0),
  pw_salt    TEXT    NOT NULL,
  pw_hash    TEXT    NOT NULL,
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT    NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

ALTER TABLE plans ADD COLUMN user_id INTEGER REFERENCES users (id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_plans_user ON plans (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_dup ON runs (todo_id, started_at);

CREATE TABLE IF NOT EXISTS observation (
  user_id   INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  question  TEXT    NOT NULL CHECK (length(question) BETWEEN 1 AND 200),
  metric    TEXT    NOT NULL CHECK (metric IN ('run_minutes', 'done_count')),
  unit      TEXT    NOT NULL,
  locked_on TEXT    NOT NULL CHECK (locked_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  locked_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_rules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  version      INTEGER NOT NULL CHECK (version IN (1, 2)),
  rule_text    TEXT    NOT NULL CHECK (length(rule_text) BETWEEN 1 AND 300),
  reason       TEXT    CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 300),
  changed_at   TEXT    NOT NULL,
  changed_on   TEXT    NOT NULL CHECK (changed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  before_dates TEXT,
  UNIQUE (user_id, version)
);

DROP VIEW IF EXISTS todo_view;
CREATE VIEW todo_view AS
SELECT
  t.id, t.plan_id, t.title, t.due_date, t.priority, t.est_minutes, t.created_at, t.updated_at,
  CASE WHEN c.id IS NOT NULL THEN 'done' ELSE t.status END AS status,
  c.completed_at AS completed_at,
  COALESCE((SELECT SUM(r.actual_minutes) FROM runs r WHERE r.todo_id = t.id), 0) AS actual_minutes,
  (SELECT COUNT(*) FROM runs r WHERE r.todo_id = t.id) AS run_count,
  (SELECT group_concat(tag, ',') FROM (SELECT tag FROM todo_tags WHERE todo_id = t.id ORDER BY tag)) AS tags,
  p.user_id AS user_id
FROM todos t
JOIN plans p ON p.id = t.plan_id
LEFT JOIN completions c ON c.todo_id = t.id;
