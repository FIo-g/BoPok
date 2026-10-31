// 장소별 반응·한 줄 의견 — 보기와 남기기. 그 여행 그룹의 구성원만 (설계 5장, 10.4).
import { handle, readJson } from '@/lib/auth'
import { OpinionInputSchema } from '@/lib/contracts'
import { addOpinion, getOpinions, requireVersionMember } from '@/lib/trips'

export async function GET(request: Request, { params }: { params: Promise<{ vid: string }> }) {
  return handle(async () => {
    const { vid } = await params
    await requireVersionMember(request, vid)
    return getOpinions(vid)
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ vid: string }> }) {
  return handle(async () => {
    const { vid } = await params
    const me = await requireVersionMember(request, vid)
    // 반응도 글도 없는 빈 의견은 계약(OpinionInputSchema)이 막는다.
    const input = await readJson(request, OpinionInputSchema)
    // 이름은 세션에서 채운다 — 클라이언트가 보낸 이름을 쓰지 않는다.
    return addOpinion({ versionId: vid, userId: me.userId, userName: me.userName, input })
  })
}
