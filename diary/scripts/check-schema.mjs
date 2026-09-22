// contracts/pds-schema-v2.json 이 schema.sql 이 만드는 실제 표·항목·관계와 같은지 검사한다: node scripts/check-schema.mjs
import fs from 'node:fs';
import { createD1 } from './d1-shim.mjs';

const root = new URL('../', import.meta.url);
const doc = JSON.parse(fs.readFileSync(new URL('contracts/pds-schema-v2.json', root), 'utf8'));
const db = createD1(':memory:', fs.readFileSync(new URL('schema.sql', root), 'utf8')).raw;
const errors = [];
const bad = (m) => errors.push(m);
const strip = (v) => (v === null || v === undefined ? null : String(v).replace(/^'(.*)'$/, '$1'));

const realTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const docTables = doc.tables.map((t) => t.name).sort();
if (JSON.stringify(realTables) !== JSON.stringify(docTables)) bad(`표 목록이 다름: 실제 ${realTables} / 문서 ${docTables}`);

for (const t of doc.tables) {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
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
  const fks = db.prepare(`PRAGMA foreign_key_list(${t.name})`).all().map((f) => `${f.from}->${f.table}.${f.to}:${f.on_delete}`).sort();
  const docFks = (t.foreign_keys || []).map((f) => `${f.column}->${f.references}:${f.on_delete}`).sort();
  if (JSON.stringify(fks) !== JSON.stringify(docFks)) bad(`${t.name}: 외래키가 다름: 실제 ${fks} / 문서 ${docFks}`);
  const uniques = db.prepare(`PRAGMA index_list(${t.name})`).all().filter((i) => i.unique && i.origin === 'u')
    .map((i) => db.prepare(`PRAGMA index_info(${i.name})`).all().map((c) => c.name).join(',')).sort();
  const docU = (t.unique || []).map((u) => u.join(',')).sort();
  if (JSON.stringify(uniques) !== JSON.stringify(docU)) bad(`${t.name}: UNIQUE 가 다름: 실제 ${uniques} / 문서 ${docU}`);
}
for (const v of doc.views) {
  const real = db.prepare(`PRAGMA table_info(${v.name})`).all().map((c) => c.name);
  if (JSON.stringify(real) !== JSON.stringify(v.columns)) bad(`뷰 ${v.name}: 항목이 다름: 실제 ${real} / 문서 ${v.columns}`);
}

if (errors.length) { console.log('FAIL\n- ' + errors.join('\n- ')); process.exit(1); }
console.log(`PASS  contracts/pds-schema-v2.json 이 schema.sql 과 일치 (표 ${doc.tables.length}개, 뷰 ${doc.views.length}개)`);
