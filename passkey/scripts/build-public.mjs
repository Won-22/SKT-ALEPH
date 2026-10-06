// 1번 소개 페이지(저장소 루트의 index.html)를 그대로 가져와 "추가만" 해서 public/index.html 을 만든다.
// 추가한 블록은 <!-- passkey:begin … --> ~ <!-- passkey:end … --> 로 감싸 두어, 빼면 원본과 글자 하나까지 같다(scripts/check-public.mjs 가 확인).
// 인라인 <script> 는 해시를 계산해 _headers 의 CSP 에 허용한다(그 밖의 인라인 스크립트는 막힌다).
import fs from 'node:fs';
import crypto from 'node:crypto';

const root = new URL('../', import.meta.url);
const orig = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const block = (name, html) => `<!-- passkey:begin ${name} -->${html}<!-- passkey:end ${name} -->`;

const nav = block('nav', '\n          <li><a href="#private-area">나만의 자리</a></li>');
const banner = block('public-banner', `
    <p class="zone-banner zone-public" role="note"><span class="zone-dot" aria-hidden="true"></span>여기부터 <strong>공개 영역</strong> — 누구나 볼 수 있는 소개입니다.</p>
    `);
const area = block('private', `

    <section id="private-area" class="zone-section wrap" aria-labelledby="private-title">
      <p class="zone-banner zone-private" role="note"><span class="zone-dot" aria-hidden="true"></span>여기부터 <strong>비공개 영역</strong> — 패스키로 잠겨 있습니다. 패스키로 들어가기 전에는 내용이 서버에서 내려오지 않습니다.</p>
      <h2 id="private-title">나만의 자리</h2>
      <div id="private-view" aria-live="polite"><p class="pv-muted">불러오는 중…</p></div>
    </section>
`);
const css = block('css', '\n<link rel="stylesheet" href="passkey.css">\n');
const js = block('js', '\n  <script src="passkey.js" defer></script>\n');

function insertOnce(html, anchor, text, where) {
  const i = html.indexOf(anchor);
  if (i < 0 || html.indexOf(anchor, i + 1) >= 0) throw new Error('anchor not unique: ' + anchor);
  return where === 'after' ? html.slice(0, i + anchor.length) + text + html.slice(i + anchor.length) : html.slice(0, i) + text + html.slice(i);
}
let out = orig;
out = insertOnce(out, '<li><a href="#connect">연결</a></li>', nav, 'after');
out = insertOnce(out, '<main id="main">', banner, 'after');
out = insertOnce(out, '  </main>', area, 'before');
out = insertOnce(out, '</head>', css, 'before');
out = insertOnce(out, '</body>', js, 'before');
fs.writeFileSync(new URL('public/index.html', root), out);

// 인라인 스크립트 해시 → CSP
const hashes = [...orig.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
const csp = [
  "default-src 'self'", `script-src 'self' ${hashes.join(' ')}`.trim(), "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
  "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"
].join('; ');
fs.writeFileSync(new URL('public/_headers', root), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Content-Security-Policy: ${csp}\n`);
console.log(`built public/index.html (+${out.length - orig.length} bytes), inline script hashes: ${hashes.length}`);
