// 초대 링크 만들기·미리보기·참가. 담당: 김경선 (설계 10.3, 역할 문서 2단계).
import 'server-only'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { AcceptInviteResponse, CreateInviteResponse, InvitePreviewResponse } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { groupInvites, groupMembers, groups } from '@/lib/db/schema'
import { findMembership } from '@/lib/auth/members'
import { HttpError } from '@/lib/auth/http'

const TOKEN_BYTES = 32 // base64url로 43글자. 링크에 그대로 붙여도 깨지지 않는 글자만 나온다
export const INVITE_DAYS = 7

function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000)
}

// 그룹장만 부른다 (route에서 requireOwner). 여러 번 만들면 링크가 여러 개 생기고
// 예전 링크도 만료 전까지 살아 있다 — '취소'는 MVP에 없다.
export async function createInvite(
  args: { groupId: string; userId: string; now?: Date },
  db: Db = getDb(),
): Promise<CreateInviteResponse> {
  const now = args.now ?? new Date()
  const expiresAt = expiryFrom(now)
  const [row] = await db
    .insert(groupInvites)
    .values({ groupId: args.groupId, token: newToken(), createdBy: args.userId, expiresAt })
    .returning({ token: groupInvites.token, expiresAt: groupInvites.expiresAt })

  // 전체 주소는 프론트가 만든다: location.origin + '/invite/' + token
  return { token: row.token, expiresAt: row.expiresAt.toISOString() }
}

// 토큰으로 초대를 찾고 만료를 본다. 없으면 404, 지났으면 410 — 화면이 다른 안내를 띄울 수 있게 나눈다.
async function findLiveInvite(token: string, now: Date, db: Db) {
  const [invite] = await db
    .select({
      groupId: groupInvites.groupId,
      expiresAt: groupInvites.expiresAt,
      groupName: groups.name,
    })
    .from(groupInvites)
    .innerJoin(groups, eq(groups.id, groupInvites.groupId))
    .where(eq(groupInvites.token, token))
    .limit(1)
  if (!invite) throw new HttpError(404, 'not_found', '초대 링크를 찾을 수 없어요')
  if (invite.expiresAt.getTime() <= now.getTime()) {
    throw new HttpError(410, 'expired', '초대 링크가 만료됐어요. 그룹장에게 새 링크를 요청해 주세요')
  }
  return invite
}

// 로그인 전에도 보여줘야 하므로 권한 검사가 없다 → 그룹 이름만 돌려준다.
// 구성원 목록·여행은 절대 담지 않는다 (설계 10.4).
export async function previewInvite(
  args: { token: string; now?: Date },
  db: Db = getDb(),
): Promise<InvitePreviewResponse> {
  const invite = await findLiveInvite(args.token, args.now ?? new Date(), db)
  return { groupName: invite.groupName, expiresAt: invite.expiresAt.toISOString() }
}

// 참가. 이미 구성원이면 그대로 성공(200)이고 role·relation을 덮어쓰지 않는다 —
// 그룹장이 자기 링크를 다시 눌러도 member로 떨어지면 안 된다.
export async function acceptInvite(
  args: { token: string; userId: string; relation?: string | null; now?: Date },
  db: Db = getDb(),
): Promise<AcceptInviteResponse> {
  const invite = await findLiveInvite(args.token, args.now ?? new Date(), db)

  const existing = await findMembership(invite.groupId, args.userId, db)
  if (existing) return { groupId: invite.groupId, alreadyMember: true }

  await db.insert(groupMembers).values({
    groupId: invite.groupId,
    userId: args.userId,
    role: 'member',
    relation: args.relation ?? null,
  })
  return { groupId: invite.groupId, alreadyMember: false }
}
