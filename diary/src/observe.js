// 5일 관찰: 순수 계산만 담는다(DB·시간 접근 없음). 화면에 보이는 합계·평균은 전부 여기서 나온다.
export const METRICS = {
  run_minutes: { label: '하루 동안 실제로 한 시간 (실행 기록의 걸린 시간 합계)', unit: '분' },
  done_count: { label: '하루 동안 완료한 할 일 수', unit: '개' }
};

export const MAX_RUN_MINUTES = 720;

export const POLICY = {
  day_boundary: '하루의 경계는 서울(Asia/Seoul) 자정입니다. 실행 기록은 시작 시각의 서울 날짜, 완료는 완료 시각의 서울 날짜에 셉니다. 자정을 넘긴 기록도 시작한 날에 통째로 셉니다.',
  missing: '기록이 없는 날은 0으로 채우지 않고 "기록 없음"으로 둡니다. 합계와 평균의 일수에서도 뺍니다.',
  duplicate: `같은 할 일을 같은 시작 시각으로 두 번 넣으면 두 번째는 저장하지 않습니다(같은 할 일의 완료도 한 번만 남습니다). 그래서 중복은 집계에 들어오지 않습니다.`,
  outlier: `한 번에 ${MAX_RUN_MINUTES}분(12시간)을 넘는 실행 기록은 입력 착오로 보고 저장하지 않습니다. 그보다 작은 값(0분 포함)은 그대로 셉니다.`,
  rounding: '합계는 정수입니다. 평균은 소수 둘째 자리에서 반올림(0.05 이상이면 올림)해 소수 첫째 자리까지 보여 줍니다.',
  week_start: '한 주는 월요일에 시작합니다. 표의 "주 시작"은 그날이 속한 주의 월요일 날짜입니다.',
  order: '입력한 순서와 상관없이, 기록에 적힌 시각의 서울 날짜로 모읍니다(나중에 입력한 지난 기록도 그날로 들어갑니다).'
};

export const kstDate = (iso) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);

export function weekStartMon(ymd) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const addDays = (ymd, n) => {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// 평균 = 합계 ÷ 일수, 소수 둘째 자리에서 반올림(정수 계산이라 부동소수 오차 없음)
export function summarize(values) {
  const n = values.length;
  const total = values.reduce((a, b) => a + b, 0);
  if (!n) return { days: 0, total: 0, avg: null, formula: '기록 있는 날이 없습니다.' };
  const tenths = Math.floor((total * 20 + n) / (2 * n));
  const avg = tenths / 10;
  return { days: n, total, avg, formula: `${values.join(' + ')} = ${total} → ${total} ÷ ${n}일 = ${avg.toFixed(1)}` };
}

// dayMap: { 'YYYY-MM-DD': { value, records } } (관찰 시작일 이후, 기록 있는 날만)
export function buildObservation({ setup, rules, dayMap, today }) {
  const dataDates = Object.keys(dayMap).sort();
  const change = rules.find((r) => r.version === 2) || null;
  const days = [];
  if (setup) {
    for (let d = setup.locked_on, i = 0; d <= today && i < 62; d = addDays(d, 1), i++) {
      const x = dayMap[d];
      days.push({
        date: d,
        week_start: weekStartMon(d),
        value: x ? x.value : null,
        records: x ? x.records : 0,
        group: !x ? null : change ? (d < change.changed_on ? 'before' : 'after') : 'before'
      });
    }
  }
  const valuesOf = (g) => dataDates.filter((d) => days.find((x) => x.date === d)?.group === g).map((d) => dayMap[d].value);
  const overall = summarize(dataDates.map((d) => dayMap[d].value));
  return {
    days,
    data_days: dataDates.length,
    overall,
    groups: change ? { before: summarize(valuesOf('before')), after: summarize(valuesOf('after')) } : null
  };
}
