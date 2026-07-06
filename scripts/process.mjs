// raw/services.json → Claude 태깅·쉬운말 요약 → data/{상황}.json 샤드 + index.json
// 실행: ANTHROPIC_API_KEY=... node scripts/process.mjs
// 증분 처리: 이미 태깅된 서비스ID는 건너뛰고 신규·변경분만 Claude 호출 (비용 월 ~2천원)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('ANTHROPIC_API_KEY 필요'); process.exit(1); }

const MODEL = 'claude-haiku-4-5';
const SITUATIONS = ['임신출산', '육아아동', '청년', '취업창업', '주거', '중장년', '어르신', '장애인', '저소득', '소상공인', '농어민', '건강의료', '교육', '문화생활', '기타'];
const AGES = ['영유아', '아동청소년', '청년', '중장년', '노년', '전연령'];
const REGIONS = ['전국', '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];

const raw = JSON.parse(readFileSync('raw/services.json', 'utf8'));
const cachePath = 'data/_tagged.json';
const tagged = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};

// 필드명은 API 응답에 맞춰 유연하게 (스펙 드리프트 대비)
const F = (r, ...names) => { for (const n of names) if (r[n] != null && r[n] !== '') return String(r[n]); return ''; };
const norm = (r) => ({
  id: F(r, '서비스ID', 'svcId', 'serviceId'),
  name: F(r, '서비스명', 'svcNm', 'serviceName'),
  purpose: F(r, '서비스목적요약', '서비스목적', 'svcSmry'),
  target: F(r, '지원대상', 'sprtTrgtCn'),
  criteria: F(r, '선정기준', 'slctCritCn'),
  content: F(r, '지원내용', 'alwServCn'),
  type: F(r, '지원유형', 'srvPvsnNm'),
  how: F(r, '신청방법', 'aplyMtdNm').replace(/\|\|/g, ' · ').replace(/\s*,\s*/g, ' · '),
  deadline: F(r, '신청기한', 'aplyTermCn') || '상시',
  org: F(r, '소관기관명', '소관부처명', 'jurMnofNm'),
  url: F(r, '상세조회URL', 'svcDtlLink'),
  updated: F(r, '수정일시', '등록일시', 'lastModYmd'),
});

// 구·시·군 단위 추출 (예: "서울특별시 강서구" → "강서구") — 정밀 매칭·정렬용
function detectDistrict(org) {
  const m = org.match(/(?:특별시|광역시|특별자치시|특별자치도|도)\s+(\S+?(?:구|시|군))(?:\s|$)/);
  return m ? m[1] : '';
}

function detectRegion(org) {
  for (const rg of REGIONS.slice(1)) {
    if (org.includes(rg) || (rg === '경기' && org.includes('경기도')) ) return rg;
  }
  const wide = { 서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주', 대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종', 강원특별자치도: '강원', 전북특별자치도: '전북', 제주특별자치도: '제주' };
  for (const [full, short] of Object.entries(wide)) if (org.includes(full)) return short;
  return '전국';
}

async function tagBatch(items) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: `정부 지원금 정보를 분류·요약합니다. 각 항목에 대해 JSON으로만 답합니다.
- situations: ${SITUATIONS.join('|')} 중 해당하는 것 전부 (최소 1개, 애매하면 "기타")
- ages: ${AGES.join('|')} 중 해당 전부 (대상 연령 불명확하면 "전연령")
- summary: 공무원 문체를 일상어로 바꾼 한 줄 요약 (40자 이내, "~해줘요/~받을 수 있어요" 톤, 금액·혜택이 있으면 반드시 포함)`,
      messages: [{ role: 'user', content: `다음 지원금들을 분류해줘. [{"id","situations":[],"ages":[],"summary"}] 형식의 JSON 배열로만 답해.\n${JSON.stringify(items.map((s) => ({ id: s.id, name: s.name, target: s.target.slice(0, 200), content: s.content.slice(0, 200) })))}` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data.content.map((b) => b.text ?? '').join('');
  const m = text.match(/\[[\s\S]*\]/);
  return m ? JSON.parse(m[0]) : [];
}

async function main() {
  // 개인 대상 서비스만 (법인·시설·단체 전용 제외 — 태깅 비용·노이즈 절감)
  const personal = raw.filter((r) => String(r['사용자구분'] ?? '').includes('개인'));
  const services = personal.map(norm).filter((s) => s.id && s.name);
  console.log(`전체 ${raw.length}건 중 개인 대상 ${services.length}건`);

  // 신규·변경분만 태깅
  const todo = services.filter((s) => !tagged[s.id] || tagged[s.id].updated !== s.updated);
  console.log(`태깅 대상 ${todo.length}건 (캐시 ${Object.keys(tagged).length}건)`);
  for (let i = 0; i < todo.length; i += 40) {
    const batch = todo.slice(i, i + 40);
    try {
      const results = await tagBatch(batch);
      for (const r of results) {
        const src = batch.find((b) => b.id === r.id);
        if (!src) continue;
        tagged[r.id] = {
          situations: (r.situations ?? []).filter((x) => SITUATIONS.includes(x)),
          ages: (r.ages ?? []).filter((x) => AGES.includes(x)),
          summary: typeof r.summary === 'string' ? r.summary.slice(0, 60) : '',
          updated: src.updated,
        };
      }
      console.log(`태깅 ${Math.min(i + 40, todo.length)}/${todo.length}`);
      writeFileSync(cachePath, JSON.stringify(tagged)); // 중간 저장 (재실행 안전)
    } catch (e) {
      console.error(`배치 ${i} 실패:`, e.message);
    }
  }

  // 샤드 출력
  mkdirSync('data', { recursive: true });
  const now = new Date().toISOString().slice(0, 10);
  const shards = Object.fromEntries(SITUATIONS.map((s) => [s, []]));
  for (const s of services) {
    const t = tagged[s.id];
    if (!t) continue;
    const item = {
      id: s.id, name: s.name,
      summary: t.summary || s.purpose.slice(0, 60),
      type: s.type, how: s.how, deadline: s.deadline, org: s.org, url: s.url,
      region: detectRegion(s.org),
      district: detectDistrict(s.org),
      ages: t.ages.length ? t.ages : ['전연령'],
      updated: s.updated,
    };
    const situs = t.situations.length ? t.situations : ['기타'];
    for (const cat of situs) shards[cat].push(item);
  }
  const index = { updatedAt: now, total: services.length, shards: {} };
  for (const [cat, items] of Object.entries(shards)) {
    writeFileSync(`data/${cat}.json`, JSON.stringify(items));
    index.shards[cat] = items.length;
  }
  writeFileSync('data/index.json', JSON.stringify(index, null, 2));
  console.log('샤드 출력 완료:', JSON.stringify(index.shards));
}

main().catch((e) => { console.error(e); process.exit(1); });
