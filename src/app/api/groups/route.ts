// 그룹 만들기·내 그룹 목록. 담당: 김경선.
import { handle, readJson, requireUser } from '@/lib/auth'
import { CreateGroupRequestSchema } from '@/lib/contracts'
import { createGroup, listMyGroups } from '@/lib/groups'

// 로그인한 사람 누구나. 만든 사람이 그룹장이 된다.
export async function POST(request: Request) {
  return handle(async () => {
    const me = await requireUser(request)
    const body = await readJson(request, CreateGroupRequestSchema)
    return createGroup({ name: body.name, userId: me.userId })
  })
}

// 내가 속한 그룹만. 남의 그룹은 결과에 담기지 않는다.
// 화면(api-client)이 배열을 그대로 기대하므로 { groups: [...] }로 감싸지 않는다.
export async function GET(request: Request) {
  return handle(async () => {
    const me = await requireUser(request)
    return listMyGroups(me.userId)
  })
}
