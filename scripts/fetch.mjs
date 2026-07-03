// 보조금24 공공서비스 수집 — 공공데이터포털 odcloud API
// 실행: DATA_GO_KR_KEY=... node scripts/fetch.mjs  → raw/services.json
// 개발계정 일 10,000건 제한: 전체(~7,500건)를 perPage 500 × ~15회로 수집 (여유 충분)
import { writeFileSync, mkdirSync } from 'node:fs';

const KEY = process.env.DATA_GO_KR_KEY;
if (!KEY) { console.error('DATA_GO_KR_KEY 필요 (data.go.kr 활용신청 후 발급)'); process.exit(1); }

const BASE = 'https://api.odcloud.kr/api/gov24/v3/serviceList';
const PER_PAGE = 500;

async function fetchPage(page) {
  const url = `${BASE}?page=${page}&perPage=${PER_PAGE}&serviceKey=${encodeURIComponent(KEY)}&returnType=JSON`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function main() {
  const first = await fetchPage(1);
  const total = first.totalCount ?? first.matchCount ?? 0;
  console.log(`총 ${total}건, 필드 샘플:`, Object.keys(first.data?.[0] ?? {}).join(', '));
  const all = [...(first.data ?? [])];
  const pages = Math.ceil(total / PER_PAGE);
  for (let p = 2; p <= pages; p++) {
    const r = await fetchPage(p);
    all.push(...(r.data ?? []));
    console.log(`page ${p}/${pages} (${all.length})`);
    await new Promise((s) => setTimeout(s, 300)); // 매너 딜레이
  }
  mkdirSync('raw', { recursive: true });
  writeFileSync('raw/services.json', JSON.stringify(all));
  console.log(`raw/services.json 저장 (${all.length}건)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
