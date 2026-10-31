// 후보 순위와 이름 맞추기의 순수 계산 검사. DB는 열지 않는다.
import { describe, expect, it } from 'vitest'
import type { PlaceSummary } from '@/lib/contracts'
import { findPlaceByName, normalizePlaceName, rankPlaces } from './search'

function place(id: string, name: string, styles: string[] = []): PlaceSummary {
  return {
    id, name, category: '테스트', styles, coord: [127.38, 36.36], seated: false, indoor: false,
    source: '테스트용', checkedAt: '2026-10-31', confidence: 'C',
  }
}

type WithAliases = PlaceSummary & { aliases?: string[] }
function aliased(id: string, name: string, aliases: string[]): WithAliases {
  return { ...place(id, name), aliases }
}

// listPlaces가 이름·id 순으로 돌려주는 모양 그대로
const ALL = [
  place('art', '대전시립미술관', ['문화·역사']),
  place('hanbat', '한밭수목원', ['자연·산책', '휴식·힐링']),
  place('leeungno', '이응노미술관', ['문화·역사']),
]
const NO_STAIRS = new Set<string>()
const ids = (rows: { id: string }[]) => rows.map(row => row.id)
function ranking(styles: string[], overrides: Partial<{ avoidStairs: boolean; limit: number }> = {}) {
  return { styles, avoidStairs: false, limit: 30, ...overrides }
}

describe('rankPlaces', () => {
  it('스타일이 맞는 곳을 앞에 두고 나머지도 뒤에 붙인다', () => {
    expect(ids(rankPlaces(ALL, ranking(['자연·산책', '휴식·힐링']), NO_STAIRS))).toEqual(['hanbat', 'art', 'leeungno'])
  })

  it('많이 맞는 곳이 먼저, 같으면 받은 순서(이름·id)', () => {
    // 한밭수목원은 두 가지가 맞고(2점), 두 미술관은 한 가지씩(1점)
    expect(ids(rankPlaces(ALL, ranking(['문화·역사', '자연·산책', '휴식·힐링']), NO_STAIRS))).toEqual(['hanbat', 'art', 'leeungno'])
  })

  it('스타일이 비어 있으면 받은 순서 그대로', () => {
    expect(ids(rankPlaces(ALL, ranking([]), NO_STAIRS))).toEqual(['art', 'hanbat', 'leeungno'])
  })

  it('DB에 없는 스타일(맛집·음식)만 골라도 후보가 비지 않는다', () => {
    expect(rankPlaces(ALL, ranking(['맛집·음식']), NO_STAIRS)).toHaveLength(3)
  })

  it('스타일 앞뒤 공백과 빈 문자열은 무시한다', () => {
    expect(ids(rankPlaces(ALL, ranking([' 자연·산책 ', '', '  ']), NO_STAIRS))).toEqual(['hanbat', 'art', 'leeungno'])
  })

  it('limit만큼만 자른다 (0이면 빈 목록)', () => {
    expect(ids(rankPlaces(ALL, ranking(['자연·산책'], { limit: 1 }), NO_STAIRS))).toEqual(['hanbat'])
    expect(rankPlaces(ALL, ranking([], { limit: 0 }), NO_STAIRS)).toEqual([])
  })

  it('받은 목록을 바꾸지 않는다', () => {
    const copy = [...ALL]
    rankPlaces(ALL, ranking(['자연·산책']), NO_STAIRS)
    expect(ALL).toEqual(copy)
  })

  it('계단 피하기면 계단이 있는 곳을 스타일 점수보다 우선해 뒤로 보낸다', () => {
    expect(ids(rankPlaces(ALL, ranking(['자연·산책'], { avoidStairs: true }), new Set(['hanbat'])))).toEqual(['art', 'leeungno', 'hanbat'])
  })

  it('계단 피하기가 아니면 계단 기록을 보지 않는다', () => {
    expect(ids(rankPlaces(ALL, ranking(['자연·산책']), new Set(['hanbat'])))).toEqual(['hanbat', 'art', 'leeungno'])
  })

  it('뒤로 보낸 무리 안에서도 스타일 점수, 받은 순서를 지킨다', () => {
    const ranked = rankPlaces(ALL, ranking(['문화·역사'], { avoidStairs: true }), new Set(['art', 'hanbat']))
    expect(ids(ranked)).toEqual(['leeungno', 'art', 'hanbat'])
  })

  it('계단을 뒤로 보낸 다음에 limit을 적용한다', () => {
    const ranked = rankPlaces(ALL, ranking(['자연·산책'], { avoidStairs: true, limit: 2 }), new Set(['hanbat']))
    expect(ids(ranked)).toEqual(['art', 'leeungno'])
  })
})

describe('normalizePlaceName', () => {
  it('공백·기호를 없애고 소문자로 맞춘다', () => {
    expect(normalizePlaceName(' 한밭-수목원! ')).toBe('한밭수목원')
    expect(normalizePlaceName('엑스포과학공원·한빛탑')).toBe('엑스포과학공원한빛탑')
    expect(normalizePlaceName('ABC Park')).toBe('abcpark')
    expect(normalizePlaceName('...')).toBe('')
  })
})

describe('findPlaceByName', () => {
  it('이름이 같으면 맞춘다 (공백·기호 무시)', () => {
    expect(findPlaceByName(ALL, '한밭수목원')?.id).toBe('hanbat')
    expect(findPlaceByName(ALL, ' 한밭 수목원 ')?.id).toBe('hanbat')
    expect(findPlaceByName(ALL, '한밭-수목원!')?.id).toBe('hanbat')
  })

  it('이름 가운데 기호가 있어도 기호 없이 쓴 입력과 맞춘다', () => {
    const expo = [place('expo', '엑스포과학공원·한빛탑')]
    expect(findPlaceByName(expo, '엑스포과학공원 한빛탑')?.id).toBe('expo')
  })

  it('입력 안에 장소 이름이 통째로 들어 있으면 맞춘다', () => {
    expect(findPlaceByName(ALL, '10시 한밭수목원 산책')?.id).toBe('hanbat')
    expect(findPlaceByName(ALL, '대전시립미술관에서 전시 관람')?.id).toBe('art')
  })

  it.each(['한밭수목원 근처 식당', '한밭수목원 앞', '한밭수목원 주변 카페', '한밭수목원 옆 공원', '한밭수목원인근', '한밭수목원 맞은편'])(
    '근처·앞·주변·옆 같은 말이 붙으면 그 장소로 맞추지 않는다: %s', input => {
      expect(findPlaceByName(ALL, input)).toBeNull()
    },
  )

  it('이름 자체에 그런 말이 들어 있으면 이름 그대로는 맞춘다', () => {
    const station = [place('st', '대전역 앞 광장')]
    expect(findPlaceByName(station, '대전역 앞 광장')?.id).toBe('st')
    expect(findPlaceByName(station, '대전역 앞 광장 산책')?.id).toBe('st')
    expect(findPlaceByName(station, '대전역 앞 광장 근처')).toBeNull()
  })

  it('입력이 장소 이름의 일부일 때("미술관")는 맞추지 않는다', () => {
    expect(findPlaceByName(ALL, '미술관')).toBeNull()
    expect(findPlaceByName(ALL, '수목원')).toBeNull()
  })

  it('DB에 없는 이름이나 빈 입력, 기호뿐인 입력은 null', () => {
    expect(findPlaceByName(ALL, '성심당 본점')).toBeNull()
    expect(findPlaceByName(ALL, '   ')).toBeNull()
    expect(findPlaceByName(ALL, '...')).toBeNull()
  })

  it('이름이 같은 장소가 둘이면 어느 쪽인지 알 수 없으므로 null', () => {
    const twins = [place('a1', '둘레길'), place('a2', '둘레길')]
    expect(findPlaceByName(twins, '둘레길')).toBeNull()
    expect(findPlaceByName(twins, '둘레길 걷기')).toBeNull()
  })

  it('입력에 들어 있는 장소 이름이 중첩이면 더 긴 이름을 고른다', () => {
    const nested = [place('c', '대전'), place('d', '대전시립미술관')]
    expect(findPlaceByName(nested, '대전시립미술관 관람')?.id).toBe('d')
  })

  it('서로 관계없는 장소 이름이 둘 다 들어 있으면 null', () => {
    expect(findPlaceByName(ALL, '대전시립미술관 다음 이응노미술관')).toBeNull()
    const sameLength = [place('e', '가나다라'), place('f', '마바사아')]
    expect(findPlaceByName(sameLength, '가나다라 다음 마바사아')).toBeNull()
  })

  it('한 글자 이름은 맞추지 않는다', () => {
    expect(findPlaceByName([place('x', '길')], '길')).toBeNull()
    expect(findPlaceByName([place('x', '길')], '길 따라 걷기')).toBeNull()
  })

  it('별칭이 있는 항목은 별칭으로도 맞춘다', () => {
    const science = [aliased('s1', '국립중앙과학관', ['국립과학관', '과학관'])]
    expect(findPlaceByName(science, '국립 과학관')?.id).toBe('s1')
    expect(findPlaceByName(science, '국립과학관 관람')?.id).toBe('s1')
    expect(findPlaceByName(science, '과학관 근처 식당')).toBeNull()
  })

  it('이름과 별칭이 같은 장소 하나에 겹쳐도 한 곳으로 센다', () => {
    const one = [aliased('p1', '한밭수목원', ['한밭 수목원'])]
    expect(findPlaceByName(one, '한밭수목원')?.id).toBe('p1')
  })

  it('다른 장소의 이름과 별칭이 같으면 어느 쪽인지 알 수 없으므로 null', () => {
    const clash = [aliased('p1', '한밭수목원', []), aliased('p2', '둔산공원', ['한밭수목원'])]
    expect(findPlaceByName(clash, '한밭수목원')).toBeNull()
  })

  it('별칭이 없는 항목만 있어도 동작한다', () => {
    expect(findPlaceByName([place('p', '한밭수목원')], '한밭수목원')?.id).toBe('p')
  })
})
