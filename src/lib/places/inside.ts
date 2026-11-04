import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { PlaceDetailSchema, PlaceNodeSchema, PlaceSegmentSchema } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import { placeNodes, places, placeSegments } from '@/lib/db/schema/places'

export type FillPlaceInsideResult =
  | { placeId: string; nodes: number; segments: number; skipped?: undefined }
  | { placeId: string; skipped: 'already_has_inside' }

// 빈 장소에만 장소 안 지점·구간을 넣는다. 하나라도 있으면 아무것도 하지 않는다 (지우거나 고치지 않음).
// 관람 코스(courses)는 저장할 표가 없어 넣지 않는다. 판정 엔진은 구간 자체만 쓴다.
// Neon HTTP는 db.transaction()을 지원하지 않으므로 지점 → 구간 순서로 넣고,
// 구간 단계가 실패하면 방금 넣은 지점과 구간만 id로 골라 되돌린다.
export async function fillPlaceInside(db: Db, input: unknown): Promise<FillPlaceInsideResult> {
  const entry = PlaceDetailSchema.parse(input)
  const nodes = PlaceNodeSchema.array().parse(entry.nodes)
  const segments = PlaceSegmentSchema.array().parse(entry.segments)
  const placeId = entry.id

  const [place] = await db.select({ id: places.id }).from(places).where(eq(places.id, placeId)).limit(1)
  if (!place) throw new Error(`장소 ${placeId}가 DB에 없어 장소 안 지점을 넣지 않았습니다.`)

  const [nodeCount] = await db.select({ count: sql<number>`count(*)::int` }).from(placeNodes).where(eq(placeNodes.placeId, placeId))
  const [segmentCount] = await db.select({ count: sql<number>`count(*)::int` }).from(placeSegments).where(eq(placeSegments.placeId, placeId))
  if (Number(nodeCount?.count ?? 0) > 0 || Number(segmentCount?.count ?? 0) > 0) {
    return { placeId, skipped: 'already_has_inside' }
  }

  // 같은 장소 안에서 id는 하나여야 한다 (DB 기본키와 같은 조건을 먼저 확인해 오류 메시지를 낸다).
  if (new Set(nodes.map(node => node.id)).size !== nodes.length) throw new Error(`장소 ${placeId}의 지점 id가 중복되었습니다.`)
  if (new Set(segments.map(segment => segment.id)).size !== segments.length) throw new Error(`장소 ${placeId}의 구간 id가 중복되었습니다.`)
  for (const segment of segments) {
    if (segment.placeId !== placeId) throw new Error(`구간 ${segment.id}의 장소 ID가 ${placeId}와 다릅니다.`)
    // 출처·확인 날짜는 DB에서 비워 둘 수 없다. 계약에서는 생략 가능하므로 여기서 막는다.
    if (!segment.source || !segment.checkedAt) throw new Error(`구간 ${segment.id}에 출처나 확인 날짜가 없습니다.`)
  }

  const nodeRows = nodes.map(node => ({
    id: node.id, placeId, kind: node.kind, name: node.name, restType: node.restType,
    lng: node.coord[0], lat: node.coord[1],
  }))
  // 우회 구간은 원 구간을 가리키므로 원 구간을 먼저 넣는다.
  const segmentRows = segments.map(segment => ({
    id: segment.id, placeId, fromNodeId: segment.fromNodeId, toNodeId: segment.toNodeId,
    order: segment.order, distanceM: segment.distanceM, path: segment.path,
    stairsStatus: segment.stairsStatus, stairsCount: segment.stairsCount ?? null,
    slope: segment.slope, optional: segment.optional, detourOf: segment.detourOf ?? null,
    source: segment.source ?? '', checkedAt: segment.checkedAt ?? '', confidence: segment.confidence,
  }))
  const plainRows = segmentRows.filter(row => row.detourOf === null)
  const detourRows = segmentRows.filter(row => row.detourOf !== null)

  if (nodeRows.length) await db.insert(placeNodes).values(nodeRows)
  try {
    if (plainRows.length) await db.insert(placeSegments).values(plainRows)
    if (detourRows.length) await db.insert(placeSegments).values(detourRows)
  } catch (error) {
    // 이 호출이 넣은 id만 되돌린다. 기존 장소 데이터는 건드리지 않는다.
    const segmentIds = segmentRows.map(row => row.id)
    if (segmentIds.length) await db.delete(placeSegments).where(and(eq(placeSegments.placeId, placeId), inArray(placeSegments.id, segmentIds)))
    await db.delete(placeNodes).where(and(eq(placeNodes.placeId, placeId), inArray(placeNodes.id, nodeRows.map(row => row.id))))
    throw error
  }
  return { placeId, nodes: nodeRows.length, segments: segmentRows.length }
}
