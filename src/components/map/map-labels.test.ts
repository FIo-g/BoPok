import { describe, expect, it } from 'vitest'
import { LABEL_LAYER_IDS, LABEL_SOURCE_ID, labelDotLayer, labelTextLayer, labelsGeoJSON } from './map-labels'

describe('이름표 레이어', () => {
  it('이름표 점과 글자 두 레이어가 같은 원본을 쓰고, 충돌하면 숨긴다', () => {
    expect(labelDotLayer.source).toBe(LABEL_SOURCE_ID)
    expect(labelTextLayer.source).toBe(LABEL_SOURCE_ID)
    expect(LABEL_LAYER_IDS).toEqual([labelDotLayer.id, labelTextLayer.id])
    expect(labelTextLayer.layout?.['text-allow-overlap']).toBe(false)
  })

  it('랜드마크가 먼저 배치되도록 정렬 키를 둔다', () => {
    expect(labelTextLayer.layout?.['symbol-sort-key']).toEqual(['match', ['get', 'emphasis'], 'landmark', 0, 1])
  })

  it('GeoJSON 은 [경도, 위도] 점과 id·이름·강조를 담는다', () => {
    const data = labelsGeoJSON([{ id: 'a', name: '가', coord: [127.3, 36.4], emphasis: 'place' }])
    expect(data.features).toEqual([
      { type: 'Feature', geometry: { type: 'Point', coordinates: [127.3, 36.4] }, properties: { id: 'a', name: '가', emphasis: 'place' } },
    ])
  })
})
