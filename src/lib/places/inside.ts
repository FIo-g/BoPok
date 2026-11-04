import 'server-only'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { PlaceCourseSchema, PlaceDetailSchema, PlaceIdInputSchema, PlaceNodeSchema, PlaceSegmentSchema } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import { placeNodes, places, placeSegments } from '@/lib/db/schema/places'

// 장소 안 데이터 입력. 시범 장소 파일(전체 장소 계약)이나 장소 안 전용 파일({ placeId, nodes, segments, courses })을 받는다.
export type PlaceInside = {
  placeId: string
  nodes: z.infer<typeof PlaceNodeSchema>[]
  segments: z.infer<typeof PlaceSegmentSchema>[]
}
const PlaceInsideFileSchema = z.object({
  placeId: PlaceIdInputSchema,
  nodes: PlaceNodeSchema.array(),
  segments: PlaceSegmentSchema.array(),
  courses: PlaceCourseSchema.array().optional(),
})
export function readPlaceInside(input: unknown): PlaceInside {
  // 전용 파일은 placeId를 가진다. 시범 장소 파일은 장소 기본 칸과 함께 id를 가진다.
  if (typeof input === 'object' && input !== null && 'placeId' in input) {
    const file = PlaceInsideFileSchema.parse(input)
    return { placeId: file.placeId, nodes: file.nodes, segments: file.segments }
  }
  const entry = PlaceDetailSchema.parse(input)
  return { placeId: entry.id, nodes: entry.nodes, segments: entry.segments }
}

export type FillPlaceInsideResult =
  | { placeId: string; nodes: number; segments: number; skipped?: undefined }
  | { placeId: string; skipped: 'already_has_inside' }

// 빈 장소에만 장소 안 지점·구간을 넣는다. 하나라도 있으면 아무것도 하지 않는다 (지우거나 고치지 않음).
// 관람 코스(courses)는 저장할 표가 없어 넣지 않는다. 판정 엔진은 구간 자체만 쓴다.
// Neon HTTP는 db.transaction()을 지원하지 않으므로 지점 → 구간 순서로 넣고,
// 구간 단계가 실패하면 방금 넣은 지점과 구간만 id로 골라 되돌린다.
export async function fillPlaceInside(db: Db, input: unknown): Promise<FillPlaceInsideResult> {
  const { placeId, nodes, segments } = readPlaceInside(input)

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
    lng: node.coord[0], lat: node.coord[1], floor: node.floor ?? null, guideNo: node.guideNo ?? null,
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

export type NodeLabelConflict = { nodeId: string; field: 'floor' | 'guideNo'; db: number; file: number }
export type SyncNodeLabelsResult = {
  placeId: string
  // 이번에 DB에 채운(또는 채울 예정인) 칸 수
  filled: number
  // 이미 파일과 같은 값이 있어 건드리지 않은 칸 수
  alreadySame: number
  // DB 값이 있고 파일과 다른 칸. 바꾸지 않고 알린다.
  conflicts: NodeLabelConflict[]
  // 파일에는 있지만 DB에 같은 id의 지점이 없는 지점 (넣지 않는다)
  notInDb: string[]
  dryRun: boolean
}

// 이미 들어간 장소의 지점에 안내도 번호·층을 채운다. 다른 칸(이름·좌표·구간)은 건드리지 않는다.
// DB 값이 null인 칸만 파일 값으로 채우고(업데이트 조건에도 null을 다시 확인한다), 값이 있으면 바꾸지 않는다.
// 마이그레이션 0007 적용 전이면 칸이 없으므로 먼저 안내한다.
export async function syncNodeLabels(db: Db, input: unknown, options: { dryRun?: boolean } = {}): Promise<SyncNodeLabelsResult> {
  const { placeId, nodes } = readPlaceInside(input)
  const dryRun = options.dryRun ?? false

  const [place] = await db.select({ id: places.id }).from(places).where(eq(places.id, placeId)).limit(1)
  if (!place) throw new Error(`장소 ${placeId}가 DB에 없어 지점 번호를 채우지 않았습니다.`)

  const [ready] = await db.select({
    guideNo: sql<boolean>`exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'place_nodes' and column_name = 'guide_no')`,
    floor: sql<boolean>`exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'place_nodes' and column_name = 'floor')`,
  }).from(places).limit(1)
  if (!ready?.guideNo || !ready.floor) {
    throw new Error('place_nodes에 guide_no·floor 칸이 없습니다. 마이그레이션 0007(pnpm db:migrate, main 머지 후)을 먼저 적용해 주세요.')
  }

  const dbNodes = await db.select({ id: placeNodes.id, floor: placeNodes.floor, guideNo: placeNodes.guideNo })
    .from(placeNodes).where(eq(placeNodes.placeId, placeId))
  const dbById = new Map(dbNodes.map(node => [node.id, node]))

  const result: SyncNodeLabelsResult = { placeId, filled: 0, alreadySame: 0, conflicts: [], notInDb: [], dryRun }
  for (const node of nodes) {
    const current = dbById.get(node.id)
    if (!current) {
      result.notInDb.push(node.id)
      continue
    }
    // 이 지점에서 실제로 채울 칸만 모은다. 업데이트 조건에도 같은 칸의 null을 다시 건다.
    const toFill: { floor?: number; guideNo?: number } = {}
    for (const field of ['floor', 'guideNo'] as const) {
      const fileValue = node[field]
      if (fileValue === undefined) continue
      const dbValue = current[field]
      if (dbValue === null) {
        toFill[field] = fileValue
        result.filled += 1
      } else if (dbValue === fileValue) {
        result.alreadySame += 1
      } else {
        result.conflicts.push({ nodeId: node.id, field, db: dbValue, file: fileValue })
      }
    }
    if (!dryRun && Object.keys(toFill).length) {
      const guards = [
        ...(toFill.floor !== undefined ? [isNull(placeNodes.floor)] : []),
        ...(toFill.guideNo !== undefined ? [isNull(placeNodes.guideNo)] : []),
      ]
      await db.update(placeNodes).set(toFill).where(and(eq(placeNodes.placeId, placeId), eq(placeNodes.id, node.id), ...guards))
    }
  }
  return result
}
