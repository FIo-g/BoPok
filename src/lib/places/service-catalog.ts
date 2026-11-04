import 'server-only'
import { z } from 'zod'
import { TOURAPI_SOURCE, TourApiClient, TourApiError, TourApiRecordSchema,
  type TourApiEndpoint, type TourApiPage, type TourApiRecord } from './tourapi'

const RawServicePlaceSchema = z.object({
  list: TourApiRecordSchema,
  common: z.array(TourApiRecordSchema), intro: z.array(TourApiRecordSchema),
  details: z.array(TourApiRecordSchema), images: z.array(TourApiRecordSchema),
  menuImages: z.array(TourApiRecordSchema), pet: z.array(TourApiRecordSchema),
}).strict()
export type RawServicePlace = z.infer<typeof RawServicePlaceSchema>
export type ServiceSource = { endpoint: TourApiEndpoint; retrievedAt: string; pageNo?: number }

function rawText(record: TourApiRecord, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value.trim() || null : typeof value === 'number' ? String(value) : null
}

function text(record: TourApiRecord, key: string): string | null {
  return rawText(record, key)?.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim() || null
}

function positiveInteger(value: string | null): number | null {
  if (!value || !/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) return null
  const parsed = Number(value.replaceAll(',', ''))
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function roomRate(record: TourApiRecord, key: string) {
  const value = rawText(record, key)
  // 공란·0·문의·가격 범위는 무료나 확정 요금으로 바꾸지 않는다.
  return { amountKrw: positiveInteger(value), rawText: value }
}

function room(record: TourApiRecord) {
  return {
    code: text(record, 'roomcode'), name: text(record, 'roomtitle'),
    baseGuests: positiveInteger(rawText(record, 'roombasecount')),
    maxGuests: positiveInteger(rawText(record, 'roommaxcount')),
    unit: 'room_per_night' as const, liveQuote: false as const,
    publishedRates: {
      offSeasonWeekday: roomRate(record, 'roomoffseasonminfee1'),
      offSeasonWeekend: roomRate(record, 'roomoffseasonminfee2'),
      peakSeasonWeekday: roomRate(record, 'roompeakseasonminfee1'),
      peakSeasonWeekend: roomRate(record, 'roompeakseasonminfee2'),
    },
    description: text(record, 'roomintro'),
  }
}

export function normalizeServicePlace(input: RawServicePlace, taxonomy: TourApiRecord[], sources: ServiceSource[], regionCode = '30') {
  const raw = RawServicePlaceSchema.parse(input)
  const id = rawText(raw.list, 'contentid')
  const contentTypeId = rawText(raw.list, 'contenttypeid')
  if (!id || !/^\d+$/.test(id) || !['12', '14', '32', '39'].includes(contentTypeId ?? '') ||
    rawText(raw.list, 'lDongRegnCd') !== regionCode || !sources.length ||
    sources.some(source => !z.iso.datetime().safeParse(source.retrievedAt).success)) {
    throw new TourApiError('invalid_response', '장소의 ID·분류·대전 지역·수집 날짜를 확인하지 못했습니다.')
  }
  for (const record of [...raw.common, ...raw.intro, ...raw.details, ...raw.images, ...raw.menuImages, ...raw.pet]) {
    if ((rawText(record, 'contentid') && rawText(record, 'contentid') !== id) ||
      (rawText(record, 'contenttypeid') && rawText(record, 'contenttypeid') !== contentTypeId) ||
      (rawText(record, 'lDongRegnCd') && rawText(record, 'lDongRegnCd') !== regionCode)) {
      throw new TourApiError('invalid_response', '목록과 상세 응답의 장소 ID·분류·지역이 다릅니다.')
    }
  }
  const summary: TourApiRecord = { ...raw.list }
  for (const record of raw.common) for (const [key, value] of Object.entries(record)) {
    if (value !== '' && value !== null) summary[key] = value
  }
  const name = text(summary, 'title')
  if (!name) throw new TourApiError('invalid_response', '장소 이름이 비어 있습니다.')
  const intro = Object.assign({}, ...raw.intro) as TourApiRecord
  const classification = taxonomy.find(row => rawText(row, 'lclsSystm3Cd') === rawText(summary, 'lclsSystm3') && rawText(row, 'lclsSystm3Cd'))
  const categoryNames = classification ? ['lclsSystm1Nm', 'lclsSystm2Nm', 'lclsSystm3Nm']
    .flatMap(key => text(classification, key) ? [text(classification, key)!] : []) : []
  const kind: 'attraction' | 'lodging' | 'cafe' | 'food' = ['12', '14'].includes(contentTypeId ?? '') ? 'attraction'
    : contentTypeId === '32' ? 'lodging'
    : categoryNames.some(label => /카페|커피|찻집/.test(label)) ? 'cafe' : 'food'
  const x = rawText(summary, 'mapx')
  const y = rawText(summary, 'mapy')
  const lng = x ? Number(x) : NaN
  const lat = y ? Number(y) : NaN
  const coord: [number, number] | null = Number.isFinite(lng) && Number.isFinite(lat) && lng !== 0 && lat !== 0 &&
    Math.abs(lng) <= 180 && Math.abs(lat) <= 90 ? [lng, lat] : null
  const food = contentTypeId === '39' ? {
    representativeMenuText: text(intro, 'firstmenu'), menusText: text(intro, 'treatmenu'),
    menuKeywords: [...new Set(['firstmenu', 'treatmenu'].flatMap(key =>
      (rawText(intro, key) ?? '').replace(/<br\s*\/?\s*>/gi, '\n').split(/[,/|;\n]/)
        .map(value => value.replace(/<[^>]*>/g, ' ').trim()).filter(Boolean)))],
    openingHoursText: text(intro, 'opentimefood'), closedDaysText: text(intro, 'restdatefood'),
    parkingText: text(intro, 'parkingfood'), reservationText: text(intro, 'reservationfood'),
    menuAndPriceNotes: raw.details.flatMap(record => {
      const label = text(record, 'infoname')
      const value = text(record, 'infotext')
      return label && value && /메뉴|가격|요금/.test(label) ? [{ label, text: value }] : []
    }),
  } : null
  const lodging = contentTypeId === '32' ? {
    checkInText: text(intro, 'checkintime'), checkOutText: text(intro, 'checkouttime'),
    roomTypesText: text(intro, 'roomtype'), parkingText: text(intro, 'parkinglodging'),
    reservationText: text(intro, 'reservationlodging'), reservationUrlText: text(intro, 'reservationurl'),
    facilitiesText: text(intro, 'subfacility'), refundPolicyText: text(intro, 'refundregulation'),
    rooms: raw.details.filter(record => rawText(record, 'roomcode') || rawText(record, 'roomtitle')).map(room),
  } : null
  // 추천용 텍스트는 원문에서만 만든다. 영양·알레르기·보행 판정·가격을 추론하지 않는다.
  const searchText = [name, ...categoryNames, text(summary, 'addr1'), text(summary, 'addr2'), text(summary, 'overview'),
    ...Object.keys(intro).sort().map(key => text(intro, key)),
    ...raw.details.flatMap(record => ['infoname', 'infotext', 'roomtitle', 'roomintro'].map(key => text(record, key))),
  ].filter(Boolean).join('\n')
  return {
    id: `tourapi-${contentTypeId}-${id}`, contentId: id, contentTypeId: contentTypeId as '12' | '14' | '32' | '39',
    name, kind, coord, categoryNames,
    classificationCodes: { first: text(summary, 'lclsSystm1'), second: text(summary, 'lclsSystm2'), third: text(summary, 'lclsSystm3') },
    address: [text(summary, 'addr1'), text(summary, 'addr2')].filter(Boolean).join(' ') || null,
    phone: text(summary, 'tel') ?? text(intro, contentTypeId === '39' ? 'infocenterfood' : 'infocenterlodging'),
    homepageText: rawText(summary, 'homepage'), description: text(summary, 'overview'),
    providerModifiedAt: text(summary, 'modifiedtime'),
    source: TOURAPI_SOURCE, checkedAt: sources.map(source => source.retrievedAt.slice(0, 10)).sort()[0],
    confidence: 'B' as const, sources, food, lodging, searchText, raw,
  }
}
export type ServiceCatalogEntry = ReturnType<typeof normalizeServicePlace>

function records(pages: TourApiPage[]) { return pages.flatMap(page => page.items) }
function provenance(pages: TourApiPage[]): ServiceSource[] {
  return pages.map(({ endpoint, retrievedAt, pageNo }) => ({ endpoint, retrievedAt, pageNo }))
}

export async function collectServiceCatalog(api: TourApiClient, options: {
  contentTypes?: Array<'12' | '14' | '32' | '39'>
  includePet?: boolean
  onEntry?: (entry: ServiceCatalogEntry) => Promise<void>
  onList?: (contentTypeId: '12' | '14' | '39' | '32', count: number) => Promise<void>
} = {}) {
  const contentTypes = z.array(z.enum(['12', '14', '32', '39'])).min(1).max(4).parse(options.contentTypes ?? ['32', '39'])
  if (new Set(contentTypes).size !== contentTypes.length) throw new TourApiError('invalid_options', '장소 분류가 중복되었습니다.')
  const regions = records(await api.all('ldongCode2', { lDongListYn: 'N' }))
  const daejeon = regions.find(row => ['대전', '대전광역시'].includes(text(row, 'name') ?? ''))
  const regionCode = daejeon ? rawText(daejeon, 'code') : null
  if (!regionCode || !/^\d+$/.test(regionCode)) throw new TourApiError('invalid_response', '법정동 코드에서 대전광역시를 찾지 못했습니다.')
  const taxonomy = records(await api.all('lclsSystmCode2', { lclsSystmListYn: 'Y' }))
  const counts: Record<'12' | '14' | '39' | '32', number> = { '12': 0, '14': 0, '39': 0, '32': 0 }
  const listings = new Map<'12' | '14' | '39' | '32', TourApiPage[]>()
  for (const contentTypeId of contentTypes) {
    const listing = await api.all('areaBasedList2', { contentTypeId, lDongRegnCd: regionCode, arrange: 'A' })
    listings.set(contentTypeId, listing)
    counts[contentTypeId] = records(listing).length
    await options.onList?.(contentTypeId, counts[contentTypeId])
  }
  for (const contentTypeId of contentTypes) {
    const listing = listings.get(contentTypeId)!
    const ids = new Set<string>()
    for (const page of listing) for (const list of page.items) {
      const contentId = rawText(list, 'contentid')
      if (!contentId || !/^\d+$/.test(contentId) || ids.has(contentId) || rawText(list, 'contenttypeid') !== contentTypeId) {
        throw new TourApiError('invalid_response', '장소 목록에 잘못된 ID·중복 ID·다른 분류가 있습니다.')
      }
      ids.add(contentId)
      const common = await api.all('detailCommon2', { contentId })
      const intro = await api.all('detailIntro2', { contentId, contentTypeId })
      const details = await api.all('detailInfo2', { contentId, contentTypeId })
      const images = await api.all('detailImage2', { contentId, imageYN: 'Y' })
      const menuImages = contentTypeId === '39' ? await api.all('detailImage2', { contentId, imageYN: 'N' }) : []
      const pet = options.includePet ? await api.all('detailPetTour2', { contentId }) : []
      const entry = normalizeServicePlace({ list, common: records(common), intro: records(intro), details: records(details),
        images: records(images), menuImages: records(menuImages), pet: records(pet) }, taxonomy,
      provenance([page, ...common, ...intro, ...details, ...images, ...menuImages, ...pet]), regionCode)
      await options.onEntry?.(entry)
    }
  }
  return { complete: true as const, regionCode, contentTypes, counts, requests: api.requests, cacheHits: api.cacheHits }
}
