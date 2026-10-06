// public/index.html 이 1번 소개 페이지에 "추가만" 한 것인지 확인한다: 추가 블록을 빼면 원본과 완전히 같아야 한다. node scripts/check-public.mjs
import fs from 'node:fs';

const orig = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const built = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const stripped = built.replace(/<!-- passkey:begin ([\w-]+) -->[\s\S]*?<!-- passkey:end \1 -->/g, '');
const blocks = [...built.matchAll(/<!-- passkey:begin ([\w-]+) -->/g)].map((m) => m[1]);
if (stripped !== orig) {
  const a = stripped.split('\n'), b = orig.split('\n');
  const i = a.findIndex((l, k) => l !== b[k]);
  console.log(`FAIL  추가 블록을 빼도 1번 페이지와 다름 (첫 차이: ${i + 1}번째 줄)\n  나: ${a[i]}\n  1번: ${b[i]}`);
  process.exit(1);
}
console.log(`PASS  public/index.html = 1번 소개 페이지(${orig.length}자) + 추가 블록 ${blocks.length}개(${blocks.join(', ')}) — 블록을 빼면 글자 하나까지 같음`);
