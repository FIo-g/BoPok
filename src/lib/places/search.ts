// 장소 검색 두 가지 — AI(김태형)용 후보 추리기와 이름 맞추기. 우리 장소 DB 안에서만 찾는다.
// 예산·이동수단은 장소 데이터에 근거 칸이 없어 순위에 쓰지 않고, 별칭 칸도 아직 없어 DB 함수는 이름만 본다.
// 숫자(걷는 시간·거리·계단 수)는 만들지 않는다 — 계단은 장소 구간에 기록된 상태(present)만 본다.
// index.ts가 이 파일을 다시 내보내면 순환 import가 되므로, 쓰는 쪽은 '@/lib/places/search'에서 가져온다.
import 'server-only'
import { eq } from 'drizzle-orm'
import type { PlaceSummary } from '@/lib/contracts'
import { getDb, type Db } from '@/lib/db/client'
import { placeSegments } from '@/lib/db/schema/places'
import { listPlaces } from './index'
import { PlaceCandidateQuerySchema, type PlaceCandidateQuery } from './validation'

// ---------- 후보 추리기 ----------

// 스타일이 맞는 장소를 앞에 둔다. 안 맞는 장소도 뒤에 붙인다(장소가 아직 적어서 거르면 후보가 비기 쉽다).
// 계단 피하기면 계단이 present로 기록된 장소를 맨 뒤 무리로 보낸다. unknown은 위반이 아니므로 그대로 둔다.
// 같은 점수끼리는 받은 순서(listPlaces의 이름, id 순)를 지킨다.
export function rankPlaces<T extends Pick<PlaceSummary, 'id' | 'styles'>>(
  all: readonly T[],
  query: Pick<PlaceCandidateQuery, 'styles' | 'avoidStairs' | 'limit'>,
  stairsPresentIds: ReadonlySet<string>,
): T[] {
  const wanted = new Set(query.styles.map(style => style.trim()).filter(style => style.length > 0))
  return all
    .map((place, index) => ({
      place,
      index,
      score: place.styles.filter(style => wanted.has(style)).length,
      stairs: query.avoidStairs && stairsPresentIds.has(place.id) ? 1 : 0,
    }))
    .sort((a, b) => a.stairs - b.stairs || b.score - a.score || a.index - b.index)
    .map(item => item.place)
    .slice(0, Math.max(0, query.limit))
}

// 구간 기록에 계단이 present인 구간이 하나라도 있는 장소의 id.
async function placeIdsWithStairs(db: Db): Promise<Set<string>> {
  const rows = await db.selectDistinct({ placeId: placeSegments.placeId }).from(placeSegments)
    .where(eq(placeSegments.stairsStatus, 'present'))
  return new Set(rows.map(row => row.placeId))
}

export async function searchCandidates(query: PlaceCandidateQuery, database?: Db): Promise<PlaceSummary[]> {
  const input = PlaceCandidateQuerySchema.parse(query)
  const db = database ?? getDb()
  // 장소가 수백 곳을 넘으면 DB에서 거르도록 바꾼다(지금은 시범 장소뿐). PGlite는 한 연결이라 조회를 순서대로 한다.
  const all = await listPlaces({}, db)
  const stairsPresentIds = input.avoidStairs ? await placeIdsWithStairs(db) : new Set<string>()
  return rankPlaces(all, input, stairsPresentIds)
}

// ---------- 이름 맞추기 ----------

export type NamedPlace = { name: string; aliases?: readonly string[] }

// 공백·기호·대소문자를 없앤다 ("한밭 수목원" = "한밭수목원", "엑스포과학공원·한빛탑" = "엑스포과학공원한빛탑").
export function normalizePlaceName(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

// "한밭수목원 근처 식당"처럼 다른 곳을 가리키는 말이 붙으면 그 장소로 맞추지 않는다.
const NEARBY_WORDS = ['근처', '앞', '주변', '옆', '인근', '부근', '맞은편', '건너편'] as const

function hasNearbyWord(rest: string): boolean {
  return NEARBY_WORDS.some(word => rest.includes(word))
}

// 이름(또는 별칭)이 같거나, 입력 안에 이름이 통째로 들어 있으면("한밭수목원 산책") 맞춘다.
// 비슷한 다른 장소로 잘못 맞추는 것보다 못 맞추는 편이 낫다(정보 없음으로 둔다) — 후보가 둘 이상이면 null.
// 입력이 이름의 일부일 때("미술관")와 두 글자 미만 이름은 맞추지 않는다.
export function findPlaceByName<T extends NamedPlace>(all: readonly T[], name: string): T | null {
  const input = normalizePlaceName(name)
  if (input.length === 0) return null

  const entries: { place: T; key: string }[] = []
  for (const place of all) {
    const keys = new Set([place.name, ...(place.aliases ?? [])].map(normalizePlaceName))
    for (const key of keys) {
      if (key.length >= 2) entries.push({ place, key })
    }
  }

  // 이름·별칭이 입력과 같은 장소. 같은 장소의 이름과 별칭이 겹쳐도 한 곳으로 센다.
  const exact = [...new Set(entries.filter(entry => entry.key === input).map(entry => entry.place))]
  if (exact.length > 0) return exact.length === 1 ? exact[0] : null

  // 입력에 이름이 통째로 들어 있는 장소. 장소마다 가장 긴 이름 하나만 본다.
  const longestByPlace = new Map<T, string>()
  for (const { place, key } of entries) {
    if (!input.includes(key)) continue
    if (hasNearbyWord(input.replace(key, ''))) continue
    const current = longestByPlace.get(place)
    if (current === undefined || key.length > current.length) longestByPlace.set(place, key)
  }
  const found = [...longestByPlace].map(([place, key]) => ({ place, key })).sort((a, b) => b.key.length - a.key.length)
  if (found.length === 0) return null
  const [top, ...others] = found
  // 다른 장소의 이름이 가장 긴 이름 안에 들어 있을 때("대전" ⊂ "대전시립미술관")만 긴 쪽으로 본다.
  // 길이가 같거나 서로 관계없는 이름이 둘 다 들어 있으면 어느 쪽인지 알 수 없다.
  if (others.some(other => other.key.length >= top.key.length || !top.key.includes(other.key))) return null
  return top.place
}

export async function matchPlaceByName(name: string, database?: Db): Promise<PlaceSummary | null> {
  if (normalizePlaceName(name).length === 0) return null
  const db = database ?? getDb()
  return findPlaceByName(await listPlaces({}, db), name)
}
