// 그룹 채팅 — 보기와 쓰기. 그 여행 그룹의 구성원만 (설계 2026-11-02 4.5).
import { HttpError, handle, readJson } from '@/lib/auth'
import { ChatListQuerySchema, ChatPostRequestSchema } from '@/lib/contracts'
import { listChatMessages, postChatMessage, requireTripMember } from '@/lib/trips'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    await requireTripMember(request, id)
    const query = ChatListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!query.success) throw new HttpError(400, 'invalid_request', '요청 내용이 형식에 맞지 않아요')
    return { messages: await listChatMessages({ tripId: id, ...query.data }) }
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const me = await requireTripMember(request, id)
    const { text } = await readJson(request, ChatPostRequestSchema)
    return postChatMessage({ tripId: id, userId: me.userId, userName: me.userName, text })
  })
}
