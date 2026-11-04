// 테스트용 가짜 기상청 응답. 모양은 공공데이터포털 단기예보·중기예보 API 활용가이드의 JSON 응답 그대로다
// (실제 기상청을 부르지 않는다 — AGENTS 5장).
import type { ShortItem } from './parse'

export type HourValues = Partial<Record<'TMP' | 'REH' | 'POP' | 'PTY' | 'SKY' | 'PCP' | 'SNO' | 'WSD', string>>

// 하루치 단기예보 항목. hours의 각 시각에 값을 채우고, 안 적은 칸은 맑고 비 없는 값으로 둔다
export function shortDayItems(args: {
  baseDate: string
  baseTime: string
  fcstDate: string
  hours: number[]
  values?: (hour: number) => HourValues
  tmx?: string
  tmn?: string
}): ShortItem[] {
  const items: ShortItem[] = []
  const base = { baseDate: args.baseDate, baseTime: args.baseTime, fcstDate: args.fcstDate }
  for (const hour of args.hours) {
    const fcstTime = `${String(hour).padStart(2, '0')}00`
    const values: HourValues = { TMP: '15', REH: '50', POP: '0', PTY: '0', SKY: '1', PCP: '강수없음', SNO: '적설없음', WSD: '2.0', ...args.values?.(hour) }
    for (const [category, fcstValue] of Object.entries(values)) items.push({ ...base, fcstTime, category, fcstValue })
  }
  if (args.tmx !== undefined) items.push({ ...base, fcstTime: '1500', category: 'TMX', fcstValue: args.tmx })
  if (args.tmn !== undefined) items.push({ ...base, fcstTime: '0600', category: 'TMN', fcstValue: args.tmn })
  return items
}

export const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)

export function kmaJson(items: unknown[], totalCount = items.length) {
  return {
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' },
      body: { dataType: 'JSON', items: { item: items }, pageNo: 1, numOfRows: items.length, totalCount },
    },
  }
}

export const KMA_NO_DATA = { response: { header: { resultCode: '03', resultMsg: 'NO_DATA' } } }

// 키를 등록하지 않았을 때 공공데이터포털이 JSON 대신 주는 XML
export const KMA_KEY_ERROR_XML =
  '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>'

// 2026-11-03 06시 발표 중기 육상예보 (대전, 세종, 충청남도)
export const MID_LAND_0600 = {
  regId: '11C20000',
  rnSt4Am: 30, rnSt4Pm: 60, rnSt5Am: 20, rnSt5Pm: 10, rnSt6Am: 70, rnSt6Pm: 80, rnSt7Am: 10, rnSt7Pm: 10,
  rnSt8: 20, rnSt9: 30, rnSt10: 40,
  wf4Am: '구름많음', wf4Pm: '흐리고 비', wf5Am: '맑음', wf5Pm: '맑음', wf6Am: '흐리고 비/눈', wf6Pm: '흐리고 눈',
  wf7Am: '맑음', wf7Pm: '구름많음', wf8: '맑음', wf9: '구름많고 소나기', wf10: '흐림',
}

// 같은 발표의 중기 기온 (대전)
export const MID_TA_0600 = {
  regId: '11C20401',
  taMin4: 6, taMax4: 14, taMin5: 4, taMax5: 15, taMin6: -1, taMax6: 3, taMin7: -3, taMax7: 6,
  taMin8: 0, taMax8: 9, taMin9: 2, taMax9: 11, taMin10: 3, taMax10: 12,
  taMin4Low: 0, taMin4High: 0, // 범위 칸은 쓰지 않는다
}
