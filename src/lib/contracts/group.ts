// 그룹·구성원·초대와 로그인한 사람. 주인: 김경선. 화면(오하연)이 필요해서 추가한 초안 — 바꾸면 프론트와 함께 리뷰 (AGENTS.md 3장).
import { z } from 'zod'

// 로그인한 사람 (Better Auth 세션에서 화면이 쓰는 값만)
export const UserSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  email: z.string(),
})
export type User = z.infer<typeof UserSchema>

export const GroupRoleSchema = z.enum(['owner', 'member'])
export type GroupRole = z.infer<typeof GroupRoleSchema>

export const GroupSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(40),
  ownerId: z.string(),
  createdAt: z.string(),
})
export type Group = z.infer<typeof GroupSchema>

// GET /api/groups — 내 그룹 목록. role은 이 그룹에서 '나'의 역할
export const GroupSummarySchema = GroupSchema.extend({
  memberCount: z.number().int().min(1),
  role: GroupRoleSchema,
})
export type GroupSummary = z.infer<typeof GroupSummarySchema>

export const GroupMemberSchema = z.object({
  userId: z.string(),
  name: z.string().min(1),
  role: GroupRoleSchema,
  relation: z.string().nullish(), // 엄마, 아빠, 나 … (선택)
  joinedAt: z.string(),
})
export type GroupMember = z.infer<typeof GroupMemberSchema>

// GET /api/groups/:id
export const GroupDetailSchema = GroupSchema.extend({ members: z.array(GroupMemberSchema) })
export type GroupDetail = z.infer<typeof GroupDetailSchema>

// POST /api/groups 요청 본문
export const CreateGroupRequestSchema = z.object({ name: z.string().trim().min(1).max(40) })
export type CreateGroupRequest = z.infer<typeof CreateGroupRequestSchema>

// POST /api/groups/:id/invites 응답. token으로 /invite/[token] 주소를 만든다
export const InviteSchema = z.object({
  token: z.string().min(1),
  groupId: z.string(),
  expiresAt: z.string(),
})
export type Invite = z.infer<typeof InviteSchema>

// GET /api/invites/:token — 그룹 이름 미리보기 (만료면 410, code 'expired')
export const InvitePreviewSchema = z.object({ groupName: z.string(), expiresAt: z.string() })
export type InvitePreview = z.infer<typeof InvitePreviewSchema>

// POST /api/invites/:token/accept 응답 — 참가한 그룹으로 이동하려고 id를 돌려준다
export const AcceptInviteResponseSchema = z.object({ groupId: z.string() })
export type AcceptInviteResponse = z.infer<typeof AcceptInviteResponseSchema>
