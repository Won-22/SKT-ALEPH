// 시험용 "가짜 기기": 진짜 패스키 기기(Windows Hello 등)가 하는 일을 WebAuthn 규격대로 흉내 낸다.
// 개인키는 이 객체 안에만 있고, 서버로는 공개키와 서명만 나간다. 자동 검사와 증거 기록에서만 쓴다.
const enc = new TextEncoder();
export const b64u = (u8) => Buffer.from(u8).toString('base64url');
export const unb64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));
const sha256 = async (data) => new Uint8Array(await crypto.subtle.digest('SHA-256', data));

function head(major, n) {
  if (n < 24) return [(major << 5) | n];
  if (n < 256) return [(major << 5) | 24, n];
  return [(major << 5) | 25, n >> 8, n & 255];
}
function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (v instanceof Uint8Array) return [...head(2, v.length), ...v];
  if (typeof v === 'string') { const b = enc.encode(v); return [...head(3, b.length), ...b]; }
  if (v instanceof Map) { const o = [...head(5, v.size)]; for (const [k, x] of v) o.push(...cbor(k), ...cbor(x)); return o; }
  throw new Error('unsupported cbor');
}
function derFromRaw(raw) {
  const int = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); if (b[0] & 0x80) b = Uint8Array.from([0, ...b]); return [0x02, b.length, ...b]; };
  const r = int(raw.slice(0, 32)), s = int(raw.slice(32));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

export function createAuthenticator({ origin, rpId }) {
  const store = new Map(); // credentialId(b64u) -> { privateKey, counter }
  const clientData = (type, challenge) => enc.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return {
    origin, rpId, store,
    async register(options, { uv = true, wrongOrigin = false } = {}) {
      const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
      const credId = crypto.getRandomValues(new Uint8Array(32));
      const cose = new Uint8Array(cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, unb64u(jwk.x)], [-3, unb64u(jwk.y)]])));
      const rpHash = await sha256(enc.encode(rpId));
      const flags = 0x01 | (uv ? 0x04 : 0) | 0x40;
      const authData = Uint8Array.from([...rpHash, flags, ...u32(0), ...new Uint8Array(16), credId.length >> 8, credId.length & 255, ...credId, ...cose]);
      const attObj = new Uint8Array(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]])));
      store.set(b64u(credId), { privateKey: kp.privateKey, counter: 0 });
      const cd = wrongOrigin ? enc.encode(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: 'https://evil.example', crossOrigin: false })) : clientData('webauthn.create', options.challenge);
      return {
        id: b64u(credId), rawId: b64u(credId), type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
        response: { clientDataJSON: b64u(cd), attestationObject: b64u(attObj), transports: ['internal'] }
      };
    },
    // 서명할 수 있는 패스키가 이 기기에 없으면(지운 패스키는 기기에 남아 있어도 서버가 모른다) 여기서는 그대로 서명하고, 거절은 서버가 한다.
    async assert(options, { credentialId, uv = true, tamper = false, counter, origin: o } = {}) {
      const id = credentialId || [...store.keys()][0];
      const cred = store.get(id);
      if (!cred) throw new Error('이 기기에 그 패스키가 없음');
      cred.counter = counter !== undefined ? counter : cred.counter + 1;
      const rpHash = await sha256(enc.encode(rpId));
      const authData = Uint8Array.from([...rpHash, 0x01 | (uv ? 0x04 : 0), ...u32(cred.counter)]);
      const cd = o ? enc.encode(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: o, crossOrigin: false })) : clientData('webauthn.get', options.challenge);
      const signed = Uint8Array.from([...authData, ...(await sha256(cd))]);
      let sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cred.privateKey, signed));
      if (tamper) sig = Uint8Array.from(sig, (b, i) => (i === 10 ? b ^ 0xff : b)); // 일부러 틀린 서명
      return {
        id, rawId: id, type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
        response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(derFromRaw(sig)), userHandle: null }
      };
    }
  };
}
