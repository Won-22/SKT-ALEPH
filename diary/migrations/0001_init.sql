-- 플랜두씨 다이어리 1 — 서버 데이터베이스(Cloudflare D1 / SQLite) 스키마 v2
-- 날짜 규칙: 날짜(YYYY-MM-DD)는 Asia/Seoul 달력 날짜, 시각(…Z)은 UTC ISO-8601, 시간 단위는 분(minute).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS plans (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  title                TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  period_start         TEXT    NOT NULL CHECK (period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  period_end           TEXT    NOT NULL CHECK (period_end   GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  priority             INTEGER NOT NULL CHECK (priority IN (1, 2, 3)),
  success_criteria     TEXT    NOT NULL CHECK (length(success_criteria) BETWEEN 1 AND 1000),
  est_minutes          INTEGER NOT NULL CHECK (est_minutes >= 0),
  carried_from_plan_id INTEGER REFERENCES plans (id) ON DELETE SET NULL,
  carried_note         TEXT    CHECK (carried_note IS NULL OR length(carried_note) BETWEEN 1 AND 300),
  created_at           TEXT    NOT NULL,
  updated_at           TEXT    NOT NULL,
  CHECK (period_end >= period_start)
);

-- 수정 이력: 1번이 처음 세운 계획이고, 고칠 때마다 다음 번호가 쌓인다. plans 는 항상 최신 값이다.
CREATE TABLE IF NOT EXISTS plan_revisions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id          INTEGER NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  revision_no      INTEGER NOT NULL CHECK (revision_no >= 1),
  title            TEXT    NOT NULL,
  period_start     TEXT    NOT NULL,
  period_end       TEXT    NOT NULL,
  priority         INTEGER NOT NULL,
  success_criteria TEXT    NOT NULL,
  est_minutes      INTEGER NOT NULL,
  recorded_at      TEXT    NOT NULL,
  UNIQUE (plan_id, revision_no)
);

CREATE TABLE IF NOT EXISTS todos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id     INTEGER NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  title       TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  status      TEXT    NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing')),
  due_date    TEXT    CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  priority    INTEGER NOT NULL DEFAULT 2 CHECK (priority IN (1, 2, 3)),
  est_minutes INTEGER NOT NULL DEFAULT 0 CHECK (est_minutes >= 0),
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todos_plan ON todos (plan_id);

CREATE TABLE IF NOT EXISTS todo_tags (
  todo_id INTEGER NOT NULL REFERENCES todos (id) ON DELETE CASCADE,
  tag     TEXT    NOT NULL CHECK (length(tag) BETWEEN 1 AND 30),
  PRIMARY KEY (todo_id, tag)
);

-- 실제로 한 일 기록: 계획·할 일 값을 건드리지 않고 따로 쌓인다.
CREATE TABLE IF NOT EXISTS runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  todo_id        INTEGER NOT NULL REFERENCES todos (id) ON DELETE CASCADE,
  started_at     TEXT    NOT NULL,
  ended_at       TEXT    NOT NULL,
  actual_minutes INTEGER NOT NULL CHECK (actual_minutes >= 0),
  blocked_reason TEXT    CHECK (blocked_reason IS NULL OR length(blocked_reason) BETWEEN 1 AND 500),
  created_at     TEXT    NOT NULL,
  CHECK (ended_at >= started_at)
);
CREATE INDEX IF NOT EXISTS idx_runs_todo ON runs (todo_id);

-- 완료 기록: todo_id 가 UNIQUE 이므로 같은 할 일의 완료는 몇 번을 눌러도 한 건만 남는다.
CREATE TABLE IF NOT EXISTS completions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  todo_id      INTEGER NOT NULL UNIQUE REFERENCES todos (id) ON DELETE CASCADE,
  completed_at TEXT    NOT NULL
);

-- 화면과 집계가 함께 쓰는 할 일 뷰: 완료 여부는 completions 하나에서만 결정된다.
DROP VIEW IF EXISTS todo_view;
CREATE VIEW todo_view AS
SELECT
  t.id, t.plan_id, t.title, t.due_date, t.priority, t.est_minutes, t.created_at, t.updated_at,
  CASE WHEN c.id IS NOT NULL THEN 'done' ELSE t.status END AS status,
  c.completed_at AS completed_at,
  COALESCE((SELECT SUM(r.actual_minutes) FROM runs r WHERE r.todo_id = t.id), 0) AS actual_minutes,
  (SELECT COUNT(*) FROM runs r WHERE r.todo_id = t.id) AS run_count,
  (SELECT group_concat(tag, ',') FROM (SELECT tag FROM todo_tags WHERE todo_id = t.id ORDER BY tag)) AS tags
FROM todos t
LEFT JOIN completions c ON c.todo_id = t.id;
