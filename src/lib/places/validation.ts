import 'server-only'
import { z } from 'zod'
import { PlaceDetailsRequestSchema, PlaceIdInputSchema } from '@/lib/contracts'

// 기존 요청 계약에 서버의 크기 제한과 ID 검사를 더한다.
export const BoundedPlaceDetailsRequestSchema = PlaceDetailsRequestSchema.extend({
  ids: z.array(PlaceIdInputSchema).max(100),
}).strict()
