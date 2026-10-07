// 나만의 자리 — 패스키 API (Cloudflare Workers + D1). 비밀번호가 아예 없다.
// 서버가 하는 일: 일회용 질문(challenge)을 만들어 2분만 보관 → 기기가 개인키로 서명해 돌려주면 공개키로 확인 → 통과하면 세션 쿠키 발급.
// 코드에 비밀값이 없다: D1 은 바인딩(env.DB)으로만 연결되고, 세션 값은 요청마다 무작위로 만들어 DB 에 SHA-256 만 남긴다.
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';

const RP_NAME = '전원 · 나만의 자리';
// 패스키는 "이 사이트 주소(rpID)"에 묶인다. 허용한 주소 밖의 요청(Host 위조 등)은 받지 않는다.
const RP_HOSTS = ['localhost', 'pds-passkey.pds-diary.workers.dev'];
const ALGS = [-7, -257]; // ES256, RS256 (Windows Hello·Google 비밀번호 관리자가 쓰는 것)
const CHALLENGE_TTL_MS = 120000;
const SESSION_DAYS = 7;
const SESSION_MS = SESSION_DAYS * 86400e3;
const COOKIE = 'sid';
const LIMITS = { accounts: 50, passkeys: 10, items: 50 };
const MAX_BODY = 20000;
const HANDLE_RE = /^[a-z0-9_.-]{3,30}$/;
const NOT_LOGGED_IN = '로그인이 필요합니다.';
const REG_FAILED = '패스키 등록을 확인하지 못했습니다. 처음부터 다시 시도해 주세요.';
const LOGIN_FAILED = '패스키 확인에 실패했습니다.'; // 이유(없는 패스키·틀린 서명·쓴 질문·만료)를 구분해 알려 주지 않는다

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra }
  });
const nowISO = () => new Date().toISOString();
const iso = (ms) => new Date(ms).toISOString();

const enc = new TextEncoder();
const toB64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const toHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256hex = async (s) => toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));

function reqStr(v, name, min, max) {
  if (typeof v !== 'string') throw bad(`${name}은(는) 글자로 입력해야 합니다.`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw bad(`${name}은(는) ${min}~${max}자여야 합니다.`);
  return s;
}
function idParam(s) {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) throw bad('ID가 올바르지 않습니다.');
  return n;
}
async function readBody(req) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) throw new HttpError(413, '요청이 너무 큽니다.');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, '요청이 너무 큽니다.');
  if (text && !/^application\/json\b/i.test(req.headers.get('content-type') || '')) throw new HttpError(415, '요청은 JSON(application/json)이어야 합니다.');
  try {
    const data = JSON.parse(text || '{}');
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw bad('JSON 형식이 올바르지 않습니다.');
  }
}
function rp(url) {
  if (!RP_HOSTS.includes(url.hostname)) throw bad('허용되지 않은 주소입니다.');
  return { rpID: url.hostname, origin: url.origin };
}
const one = async (db, sql, ...p) => db.prepare(sql).bind(...p).first();

// ---------- 일회용 질문(challenge) ----------
async function saveChallenge(db, challenge, f) {
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM challenges WHERE expires_at <= ?').bind(iso(now)),
    db
      .prepare('INSERT INTO challenges (challenge, purpose, handle, user_handle, account_id, passkey_name, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(challenge, f.purpose, f.handle ?? null, f.user_handle ?? null, f.account_id ?? null, f.passkey_name ?? null, iso(now), iso(now + CHALLENGE_TTL_MS))
  ]);
}
// 기기가 서명해 돌려준 clientDataJSON 안의 질문 값으로 찾아, 확인 결과와 상관없이 즉시 지운다(한 번만 쓸 수 있다).
async function takeChallenge(db, response, purposes) {
  let challenge;
  try { challenge = JSON.parse(new TextDecoder().decode(fromB64u(response.response.clientDataJSON))).challenge; } catch { return null; }
  if (typeof challenge !== 'string') return null;
  const row = await one(db, 'SELECT * FROM challenges WHERE challenge = ?', challenge);
  if (!row) return null;
  const del = await db.prepare('DELETE FROM challenges WHERE id = ?').bind(row.id).run();
  if (del.meta.changes !== 1) return null; // 같은 질문을 동시에 두 번 쓰려던 요청
  if (row.expires_at <= nowISO() || !purposes.includes(row.purpose)) return null;
  return row;
}

// ---------- 로그인 상태(세션) ----------
const cookieHeader = (value, url, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${url.protocol === 'https:' ? '; Secure' : ''}`;
function tokenFrom(req) {
  for (const part of (req.headers.get('cookie') || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === COOKIE) return part.slice(i + 1);
  }
  return null;
}
async function startSession(db, accountId, passkeyId, url) {
  const token = toB64u(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(iso(now)),
    db.prepare('INSERT INTO sessions (token_hash, account_id, passkey_id, created_at, expires_at) VALUES (?,?,?,?,?)').bind(await sha256hex(token), accountId, passkeyId, iso(now), iso(now + SESSION_MS))
  ]);
  return { cookie: cookieHeader(token, url, SESSION_MS / 1000), expires_at: iso(now + SESSION_MS) };
}
async function currentAccount(db, req) {
  const token = tokenFrom(req);
  if (!token) return null;
  const row = await one(db,
    'SELECT s.id AS session_id, s.expires_at, s.passkey_id, a.id, a.handle, a.user_handle, a.created_at FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?',
    await sha256hex(token));
  if (!row) return null;
  if (row.expires_at <= nowISO()) {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(row.session_id).run();
    return null;
  }
  return row;
}
const respond = (body, cookie, status = 200) => ({ __respond: true, status, body, headers: cookie ? { 'set-cookie': cookie } : {} });

// ---------- 패스키 등록 ----------
function passkeyName(v) {
  return v === undefined || v === null || String(v).trim() === '' ? '내 패스키' : reqStr(v, '패스키 이름', 1, 30);
}
async function registerOptions(db, req, url) {
  const b = await readBody(req);
  const { rpID } = rp(url);
  const handle = typeof b.handle === 'string' ? b.handle.trim().toLowerCase() : '';
  if (!HANDLE_RE.test(handle)) throw bad('자리 이름은 영문 소문자·숫자·._- 로 3~30자여야 합니다.');
  const name = passkeyName(b.passkey_name);
  if ((await one(db, 'SELECT COUNT(*) AS n FROM accounts')).n >= LIMITS.accounts) throw bad('지금은 더 만들 수 없습니다.');
  if (await one(db, 'SELECT 1 AS x FROM accounts WHERE handle = ?', handle)) throw new HttpError(409, '이미 있는 자리 이름입니다.');
  const userHandle = toB64u(crypto.getRandomValues(new Uint8Array(16)));
  const opts = await generateRegistrationOptions({
    rpName: RP_NAME, rpID, userName: handle, userDisplayName: handle, userID: fromB64u(userHandle),
    attestationType: 'none', supportedAlgorithmIDs: ALGS,
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
  });
  await saveChallenge(db, opts.challenge, { purpose: 'register', handle, user_handle: userHandle, passkey_name: name });
  return opts;
}
async function verifyNewPasskey(b, row, url) {
  const { rpID, origin } = rp(url);
  if (!b.response || typeof b.response !== 'object') throw bad(REG_FAILED);
  let v;
  try {
    v = await verifyRegistrationResponse({ response: b.response, expectedChallenge: row.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true, supportedAlgorithmIDs: ALGS });
  } catch { throw bad(REG_FAILED); }
  if (!v.verified) throw bad(REG_FAILED);
  return v.registrationInfo;
}
const passkeyInsert = (db, info, name, accountSql, accountParams) =>
  db
    .prepare(`INSERT INTO passkeys (account_id, credential_id, public_key, counter, transports, device_type, backed_up, name, created_at) VALUES (${accountSql},?,?,?,?,?,?,?,?)`)
    .bind(...accountParams, info.credential.id, toB64u(info.credential.publicKey), info.credential.counter, JSON.stringify(info.credential.transports || []), info.credentialDeviceType, info.credentialBackedUp ? 1 : 0, name, nowISO());
async function registerVerify(db, req, url) {
  const b = await readBody(req);
  const row = await takeChallenge(db, b.response || {}, ['register']);
  if (!row) throw bad(REG_FAILED);
  const info = await verifyNewPasskey(b, row, url);
  if (await one(db, 'SELECT 1 AS x FROM accounts WHERE handle = ?', row.handle)) throw new HttpError(409, '이미 있는 자리 이름입니다.');
  let res;
  try {
    res = await db.batch([
      db.prepare('INSERT INTO accounts (handle, user_handle, created_at) VALUES (?,?,?)').bind(row.handle, row.user_handle, nowISO()),
      passkeyInsert(db, info, row.passkey_name || '내 패스키', 'last_insert_rowid()', [])
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) throw new HttpError(409, '이미 등록된 패스키이거나 이미 있는 자리 이름입니다.');
    throw e;
  }
  const s = await startSession(db, res[0].meta.last_row_id, res[1].meta.last_row_id, url);
  return respond({ account: { handle: row.handle }, passkey: { name: row.passkey_name || '내 패스키' }, session_expires_at: s.expires_at }, s.cookie, 201);
}

// ---------- 패스키 로그인 ----------
async function loginOptions(db, url) {
  const { rpID } = rp(url);
  const opts = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
  await saveChallenge(db, opts.challenge, { purpose: 'login' });
  return opts;
}
async function loginVerify(db, req, url) {
  const b = await readBody(req);
  const { rpID, origin } = rp(url);
  const r = b.response;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string') throw new HttpError(401, LOGIN_FAILED);
  const row = await takeChallenge(db, r, ['login']);
  if (!row) throw new HttpError(401, LOGIN_FAILED);
  const pk = await one(db, 'SELECT * FROM passkeys WHERE credential_id = ?', r.id);
  if (!pk) throw new HttpError(401, LOGIN_FAILED);
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: r, expectedChallenge: row.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: pk.credential_id, publicKey: fromB64u(pk.public_key), counter: pk.counter, transports: JSON.parse(pk.transports || '[]') }
    });
  } catch { throw new HttpError(401, LOGIN_FAILED); }
  if (!v.verified) throw new HttpError(401, LOGIN_FAILED);
  await db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').bind(v.authenticationInfo.newCounter, nowISO(), pk.id).run();
  const s = await startSession(db, pk.account_id, pk.id, url);
  const acc = await one(db, 'SELECT handle FROM accounts WHERE id = ?', pk.account_id);
  return respond({ account: { handle: acc.handle }, session_expires_at: s.expires_at }, s.cookie);
}
async function logout(db, req, url) {
  const token = tokenFrom(req);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256hex(token)).run();
  return respond({ ok: true }, cookieHeader('', url, 0));
}
async function sessionInfo(db, req) {
  const a = await currentAccount(db, req);
  if (!a) return { account: null };
  return { account: { handle: a.handle, created_at: a.created_at }, session: { expires_at: a.expires_at, ttl_days: SESSION_DAYS, passkey_id: a.passkey_id } };
}

// ---------- 로그인한 계정의 패스키 관리 ----------
// 주인 확인: 남의 것과 없는 것을 구분하지 않고 같은 404 로 거절한다. 모든 자료·패스키 접근이 여기를 지난다.
async function ownedPasskey(db, accountId, id) {
  const p = await one(db, 'SELECT * FROM passkeys WHERE id = ? AND account_id = ?', id, accountId);
  if (!p) throw new HttpError(404, '패스키를 찾을 수 없습니다.');
  return p;
}
async function ownedItem(db, accountId, id) {
  const r = await one(db, 'SELECT * FROM private_items WHERE id = ? AND account_id = ?', id, accountId);
  if (!r) throw new HttpError(404, '항목을 찾을 수 없습니다.');
  return r;
}
async function listPasskeys(db, acc) {
  const { results } = await db.prepare('SELECT id, credential_id, public_key, counter, transports, device_type, backed_up, name, created_at, last_used_at FROM passkeys WHERE account_id = ? ORDER BY id').bind(acc.id).all();
  return { rows: results.map((p) => ({ ...p, transports: JSON.parse(p.transports || '[]'), backed_up: !!p.backed_up, is_current: p.id === acc.passkey_id })) };
}
async function addOptions(db, acc, req, url) {
  const b = await readBody(req);
  const { rpID } = rp(url);
  const name = passkeyName(b.passkey_name);
  const { results } = await db.prepare('SELECT credential_id, transports FROM passkeys WHERE account_id = ?').bind(acc.id).all();
  if (results.length >= LIMITS.passkeys) throw bad(`패스키는 ${LIMITS.passkeys}개까지 등록할 수 있습니다.`);
  const opts = await generateRegistrationOptions({
    rpName: RP_NAME, rpID, userName: acc.handle, userDisplayName: acc.handle, userID: fromB64u(acc.user_handle),
    attestationType: 'none', supportedAlgorithmIDs: ALGS,
    // 이미 등록한 기기는 제외해 달라고 브라우저에 알린다(같은 기기에 같은 패스키가 두 번 등록되지 않게)
    excludeCredentials: results.map((p) => ({ id: p.credential_id, transports: JSON.parse(p.transports || '[]') })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
  });
  await saveChallenge(db, opts.challenge, { purpose: 'add', account_id: acc.id, passkey_name: name });
  return opts;
}
async function addVerify(db, acc, req, url) {
  const b = await readBody(req);
  const row = await takeChallenge(db, b.response || {}, ['add']);
  if (!row || row.account_id !== acc.id) throw bad(REG_FAILED);
  const info = await verifyNewPasskey(b, row, url);
  try {
    await passkeyInsert(db, info, row.passkey_name || '내 패스키', '?', [acc.id]).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) throw new HttpError(409, '이미 등록된 패스키입니다.');
    throw e;
  }
  return listPasskeys(db, acc);
}
async function deletePasskey(db, acc, id) {
  await ownedPasskey(db, acc.id, id);
  const n = (await one(db, 'SELECT COUNT(*) AS n FROM passkeys WHERE account_id = ?', acc.id)).n;
  if (n <= 1) throw new HttpError(409, '마지막 패스키는 지울 수 없습니다. 하나도 없으면 이 자리에 다시 들어올 방법이 없습니다. 먼저 다른 패스키를 하나 더 등록하세요.');
  await db.prepare('DELETE FROM passkeys WHERE id = ?').bind(id).run(); // 이 패스키로 연 세션도 함께 지워진다
  return { deleted: id, remaining: n - 1 };
}

// ---------- 비공개 자리의 항목 ----------
async function listItems(db, acc) {
  const { results } = await db.prepare('SELECT id, title, body, created_at FROM private_items WHERE account_id = ? ORDER BY id').bind(acc.id).all();
  return { rows: results };
}
async function createItem(db, acc, req) {
  const b = await readBody(req);
  const title = reqStr(b.title, '제목', 1, 100), body = reqStr(b.body, '내용', 1, 1000);
  if ((await one(db, 'SELECT COUNT(*) AS n FROM private_items WHERE account_id = ?', acc.id)).n >= LIMITS.items) throw bad(`항목은 ${LIMITS.items}개까지 넣을 수 있습니다.`);
  const res = await db.prepare('INSERT INTO private_items (account_id, title, body, created_at) VALUES (?,?,?,?)').bind(acc.id, title, body, nowISO()).run();
  return one(db, 'SELECT id, title, body, created_at FROM private_items WHERE id = ? AND account_id = ?', res.meta.last_row_id, acc.id);
}
async function deleteItem(db, acc, id) {
  await ownedItem(db, acc.id, id);
  await db.prepare('DELETE FROM private_items WHERE id = ?').bind(id).run();
  return { deleted: id };
}

// ---------- 라우터 ----------
async function route(req, env, url) {
  const db = env.DB;
  const path = url.pathname.replace(/\/+$/, '');
  const m = req.method;
  let x;

  // 로그인 없이 쓸 수 있는 것: 내 상태 확인, 패스키로 새 자리 만들기, 패스키로 들어가기, 로그아웃
  if (path === '/api/session' && m === 'GET') return sessionInfo(db, req);
  if (path === '/api/register/options' && m === 'POST') return registerOptions(db, req, url);
  if (path === '/api/register/verify' && m === 'POST') return registerVerify(db, req, url);
  if (path === '/api/login/options' && m === 'POST') return loginOptions(db, url);
  if (path === '/api/login/verify' && m === 'POST') return loginVerify(db, req, url);
  if (path === '/api/logout' && m === 'POST') return logout(db, req, url);

  // 그 밖의 모든 /api 는 로그인한 사람만. 여기서 acc 를 정하고, 아래 모든 접근이 acc.id 로 걸러진다.
  const acc = await currentAccount(db, req);
  if (!acc) throw new HttpError(401, NOT_LOGGED_IN);

  if (path === '/api/private/items') {
    if (m === 'GET') return listItems(db, acc);
    if (m === 'POST') return createItem(db, acc, req);
  }
  if ((x = path.match(/^\/api\/private\/items\/(\d+)$/)) && m === 'DELETE') return deleteItem(db, acc, idParam(x[1]));
  if (path === '/api/passkeys' && m === 'GET') return listPasskeys(db, acc);
  if (path === '/api/passkeys/options' && m === 'POST') return addOptions(db, acc, req, url);
  if (path === '/api/passkeys/verify' && m === 'POST') return addVerify(db, acc, req, url);
  if ((x = path.match(/^\/api\/passkeys\/(\d+)$/)) && m === 'DELETE') return deletePasskey(db, acc, idParam(x[1]));

  throw new HttpError(404, '찾을 수 없는 주소입니다.');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    try {
      // 다른 사이트에서 온 쓰기 요청은 쿠키가 있어도 거절한다(SameSite=Strict 와 함께 쓰는 이중 방어).
      if (!['GET', 'HEAD'].includes(req.method)) {
        const origin = req.headers.get('origin');
        let host = null;
        try { host = origin ? new URL(origin).host : url.host; } catch { /* 잘못된 Origin */ }
        if (host !== url.host) throw new HttpError(403, '허용되지 않은 출처의 요청입니다.');
      }
      const out = await route(req, env, url);
      if (out && out.__respond) return json(out.body, out.status, out.headers);
      return json(out);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error('unhandled', e && e.message);
      return json({ error: '서버 오류가 발생했습니다.' }, 500);
    }
  }
};
