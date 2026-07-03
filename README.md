# subsidy-content
"숨은 지원금 찾기" 앱의 데이터 파이프라인. 보조금24 공공 API → Claude 태깅·쉬운말 요약 → 상황별 샤드 JSON.

- `scripts/fetch.mjs` — 공공데이터포털 수집 (DATA_GO_KR_KEY 필요)
- `scripts/process.mjs` — Claude(haiku) 증분 태깅 → `data/{상황}.json` + `data/index.json`
- 주간 자동 갱신: 화요일 06시 KST (GitHub Actions)
- 현재 `data/`는 **목업** (`index.json`의 `mock:true`) — API 키 등록 후 첫 실행 시 실데이터로 교체

## 시크릿
- `DATA_GO_KR_KEY`: data.go.kr "대한민국 공공서비스(혜택) 정보" 활용신청 후 발급 키 ← **등록 필요**
- `ANTHROPIC_API_KEY`: 등록됨
