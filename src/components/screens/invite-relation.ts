// 초대로 참가할 때 고르는 "가족 안에서 나는 누구인지" (그룹 구성원 목록에 이름 옆에 보인다). 고르지 않아도 참가할 수 있다.
// 서버는 앞뒤 공백을 지운 1~20자만 받는다 (src/lib/contracts/group.ts 의 AcceptInviteRequestSchema)
export const RELATION_OPTIONS = ['엄마', '아빠', '딸', '아들', '배우자', '형제자매', '할머니', '할아버지'] as const
export const RELATION_MAX_LENGTH = 20

// 고른 칩이나 직접 쓴 글 → 서버에 보낼 값. 비어 있으면 undefined (본문 없이 보내 관계 없이 참가한다)
export function relationToSend(input: string | null | undefined): string | undefined {
  const text = (input ?? '').trim().slice(0, RELATION_MAX_LENGTH).trim()
  return text === '' ? undefined : text
}
