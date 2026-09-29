// contracts/pds-schema-v2.json 이 schema.sql 이 만드는 실제 표·항목·관계·색인과 같은지,
// 그리고 migrations/ 를 차례로 적용한 DB 가 schema.sql 로 만든 DB 와 같은 모양인지 검사한다: node scripts/check-schema.mjs
import fs from 'node:fs';
import { createD1 } from './d1-shim.mjs';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const doc = JSON.parse(read('contracts/pds-schema-v2.json'));
const db = createD1(':memory:', read('schema.sql')).raw;
const errors = [];
const bad = (m) => errors.push(m);
const strip = (v) => (v === null || v === undefined ? null : String(v).replace(/^'(.*)'$/, '$1'));
const list = (d, sql, ...p) => d.prepare(sql).all(...p);

// 한 DB 의 모양을 글자로 요약한다(표·항목·외래키·색인·뷰 항목)
function shape(d) {
  const out = [];
  for (const { name } of list(d, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")) {
    out.push(`T ${name}`);
    for (const c of list(d, `PRAGMA table_info(${name})`)) out.push(`  c ${c.name} ${c.type} nn=${c.notnull} d=${c.dflt_value} pk=${c.pk}`);
    for (const f of list(d, `PRAGMA foreign_key_list(${name})`)) out.push(`  f ${f.from}->${f.table}.${f.to} ${f.on_delete}`);
    for (const i of list(d, `PRAGMA index_list(${name})`).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(`  i ${i.origin === 'c' ? i.name : '(auto)'} u=${i.unique} ${list(d, `PRAGMA index_info(${i.name})`).map((x) => x.name).join(',')}`);
    }
  }
  for (const { name } of list(d, "SELECT name FROM sqlite_master WHERE type='view' ORDER BY name")) {
    out.push(`V ${name} ${list(d, `PRAGMA table_info(${name})`).map((c) => c.name).join(',')}`);
  }
  return out.join('\n');
}

const realTables = list(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => r.name);
const docTables = doc.tables.map((t) => t.name).sort();
if (JSON.stringify(realTables) !== JSON.stringify(docTables)) bad(`표 목록이 다름: 실제 ${realTables} / 문서 ${docTables}`);

for (const t of doc.tables) {
  const cols = list(db, `PRAGMA table_info(${t.name})`);
  const real = cols.map((c) => c.name);
  const docCols = t.columns.map((c) => c.name);
  if (JSON.stringify(real) !== JSON.stringify(docCols)) bad(`${t.name}: 항목 목록/순서가 다름: 실제 ${real} / 문서 ${docCols}`);
  for (const c of t.columns) {
    const r = cols.find((x) => x.name === c.name);
    if (!r) continue;
    if (r.type !== c.type) bad(`${t.name}.${c.name}: 타입 ${r.type} ≠ ${c.type}`);
    const isPk = r.pk > 0;
    if (!isPk && (r.notnull === 0) !== c.nullable) bad(`${t.name}.${c.name}: NULL 허용 여부가 다름`);
    if (strip(r.dflt_value) !== (c.default === undefined ? null : c.default)) bad(`${t.name}.${c.name}: 기본값 ${strip(r.dflt_value)} ≠ ${c.default ?? null}`);
  }
  const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  if (JSON.stringify(pk) !== JSON.stringify(t.primary_key)) bad(`${t.name}: 기본키가 다름: 실제 ${pk} / 문서 ${t.primary_key}`);
  const fks = list(db, `PRAGMA foreign_key_list(${t.name})`).map((f) => `${f.from}->${f.table}.${f.to}:${f.on_delete}`).sort();
  const docFks = (t.foreign_keys || []).map((f) => `${f.column}->${f.references}:${f.on_delete}`).sort();
  if (JSON.stringify(fks) !== JSON.stringify(docFks)) bad(`${t.name}: 외래키가 다름: 실제 ${fks} / 문서 ${docFks}`);
  const idx = list(db, `PRAGMA index_list(${t.name})`);
  const cols_ = (i) => list(db, `PRAGMA index_info(${i.name})`).map((c) => c.name).join(',');
  const uniques = idx.filter((i) => i.unique && i.origin === 'u').map(cols_).sort();
  const docU = (t.unique || []).map((u) => u.join(',')).sort();
  if (JSON.stringify(uniques) !== JSON.stringify(docU)) bad(`${t.name}: UNIQUE 가 다름: 실제 ${uniques} / 문서 ${docU}`);
  const named = idx.filter((i) => i.origin === 'c').map((i) => `${i.name}|${i.unique ? 'u' : ''}|${cols_(i)}`).sort();
  const docI = (t.indexes || []).map((i) => `${i.name}|${i.unique ? 'u' : ''}|${i.columns.join(',')}`).sort();
  if (JSON.stringify(named) !== JSON.stringify(docI)) bad(`${t.name}: 색인이 다름: 실제 ${named} / 문서 ${docI}`);
}
for (const v of doc.views) {
  const real = list(db, `PRAGMA table_info(${v.name})`).map((c) => c.name);
  if (JSON.stringify(real) !== JSON.stringify(v.columns)) bad(`뷰 ${v.name}: 항목이 다름: 실제 ${real} / 문서 ${v.columns}`);
}

// migrations/ 를 차례로 적용한 DB(= 이미 배포된 DB 가 가게 되는 모양)가 schema.sql 과 같은지
const migrated = createD1(':memory:').raw;
const files = fs.readdirSync(new URL('migrations/', root)).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) migrated.exec(read('migrations/' + f));
if (shape(migrated) !== shape(db)) {
  const a = shape(migrated).split('\n'), b = shape(db).split('\n');
  bad(`migrations(${files.join(', ')}) 로 만든 DB 와 schema.sql 이 다름: ${a.filter((x) => !b.includes(x)).concat(b.filter((x) => !a.includes(x))).slice(0, 6).join(' | ')}`);
}

if (errors.length) { console.log('FAIL\n- ' + errors.join('\n- ')); process.exit(1); }
console.log(`PASS  contracts/pds-schema-v2.json 이 schema.sql 과 일치 (표 ${doc.tables.length}개, 뷰 ${doc.views.length}개) · migrations ${files.length}개를 적용한 DB 도 같은 모양`);
