-- 나만의 자리(패스키) — Cloudflare D1(SQLite) 스키마
-- 비밀번호 칸이 아예 없다. 서버에는 공개키만 저장되고 개인키는 기기 밖으로 나오지 않는다.
-- 시각은 UTC ISO-8601(…Z)로 저장하고 화면에는 서울 시간(KST)으로 보여 준다.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  handle      TEXT    NOT NULL UNIQUE CHECK (length(handle) BETWEEN 3 AND 30),
  user_handle TEXT    NOT NULL UNIQUE,
  created_at  TEXT    NOT NULL
);

-- 패스키 한 개 = 기기 하나가 가진 키 한 쌍 중 "공개키". 계정 하나에 여러 개 등록할 수 있다.
CREATE TABLE IF NOT EXISTS passkeys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  credential_id TEXT    NOT NULL UNIQUE,
  public_key    TEXT    NOT NULL,
  counter       INTEGER NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports    TEXT,
  device_type   TEXT    NOT NULL,
  backed_up     INTEGER NOT NULL DEFAULT 0 CHECK (backed_up IN (0, 1)),
  name          TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 30),
  created_at    TEXT    NOT NULL,
  last_used_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_passkeys_account ON passkeys (account_id);

-- 일회용 질문(challenge). 서버가 만들어 보내고, 확인할 때까지만(2분) 보관하며, 한 번 쓰면 바로 지운다.
CREATE TABLE IF NOT EXISTS challenges (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge    TEXT    NOT NULL UNIQUE,
  purpose      TEXT    NOT NULL CHECK (purpose IN ('register', 'add', 'login')),
  handle       TEXT,
  user_handle  TEXT,
  account_id   INTEGER REFERENCES accounts (id) ON DELETE CASCADE,
  passkey_name TEXT,
  created_at   TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL
);

-- 로그인 상태. 쿠키에는 무작위 값 원문, 여기에는 그 SHA-256 만 있다. 로그인에 쓴 패스키를 지우면 그 세션도 함께 지워진다.
CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT    NOT NULL UNIQUE,
  account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  passkey_id INTEGER REFERENCES passkeys (id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions (account_id);

-- 비공개 자리의 항목. 로그인한 계정의 것만 서버가 내려 준다.
CREATE TABLE IF NOT EXISTS private_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  title      TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  body       TEXT    NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_account ON private_items (account_id);
