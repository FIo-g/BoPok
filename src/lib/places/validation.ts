import 'server-only'
import { z } from 'zod'
import { BudgetSchema, PlaceDetailsRequestSchema, PlaceIdInputSchema, TransportSchema } from '@/lib/contracts'

// 기존 요청 계약에 서버의 크기 제한과 ID 검사를 더한다.
export const BoundedPlaceDetailsRequestSchema = PlaceDetailsRequestSchema.extend({
  ids: z.array(PlaceIdInputSchema).max(100),
}).strict()

// searchCandidates 입력. AI의 CandidateQuery(src/lib/ai/deps.ts)와 같은 모양이다.
// 예산·이동수단은 장소 데이터에 근거 칸이 없어 순위에 쓰지 않지만, 잘못된 값은 여기서 막는다.
export const PlaceCandidateQuerySchema = z.object({
  styles: z.array(z.string().max(100)).max(50),
  budget: BudgetSchema.optional(),
  transport: TransportSchema,
  avoidStairs: z.boolean(),
  limit: z.number().int().min(0).max(100),
})
export type PlaceCandidateQuery = z.infer<typeof PlaceCandidateQuerySchema>
