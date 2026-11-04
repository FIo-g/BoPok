import { handle, readJson, HttpError } from '@/lib/auth'
import { CostDaySchema, SaveCostPlanSchema } from '@/lib/contracts'
import { getCostPlan, requireTripMember, saveCostPlan } from '@/lib/trips'

type Context = { params: Promise<{ id: string; vid: string }> }
export async function GET(request: Request, { params }: Context) {
  return handle(async () => {
    const { id, vid } = await params
    await requireTripMember(request, id)
    const day = CostDaySchema.safeParse(new URL(request.url).searchParams.get('day'))
    if (!day.success) throw new HttpError(400, 'invalid_request', '날짜를 확인해 주세요')
    return getCostPlan({ tripId: id, versionId: vid, day: day.data })
  })
}
export async function PUT(request: Request, { params }: Context) {
  return handle(async () => {
    const { id, vid } = await params
    const me = await requireTripMember(request, id)
    return saveCostPlan({ tripId: id, versionId: vid }, await readJson(request, SaveCostPlanSchema), me)
  })
}
