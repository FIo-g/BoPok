// 여행자 건강 정보 (병·약 "종류"만). 담당: 김태형 (설계 4.4, 계약은 src/lib/contracts/health.ts).
// 민감정보라 여행자 표(trip_travelers)와 따로 둔다 — 따로 지우고, 따로 권한을 검사하고, 여행자 목록 API로 새지 않게.
import { pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import type { HealthCondition, MedicationClass } from '@/lib/contracts'
import { user } from './auth'
import { trips } from './trips'

export const tripTravelerHealth = pgTable(
  'trip_traveler_health',
  {
    // trips에만 cascade를 건다. trip_travelers에는 걸지 않는다 — 여행자 저장이 '다 지우고 다시 넣기'라서
    // 외래키를 걸면 저장할 때마다 건강 정보가 같이 지워진다. 빠진 여행자의 기록은 deleteHealthExcept가 지운다.
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    travelerId: text('traveler_id').notNull(), // 여행 안에서만 유일하다 (trip_travelers.id와 같은 값)
    conditions: text('conditions').array().$type<HealthCondition[]>().notNull().default([]),
    medicationClasses: text('medication_classes').array().$type<MedicationClass[]>().notNull().default([]),
    visibility: text('visibility', { enum: ['group', 'self'] }).notNull(),
    // 동의한 때. 서버 시각을 넣는다 (시간대를 붙여 저장해 ISO 문자열로 되돌릴 때 어긋나지 않게)
    consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
    // 처음 입력한 사람. 계정 없는 여행자의 "본인"이 된다. 계정이 지워지면 그 사람이 넣은 기록도 함께 지운다.
    enteredByUserId: text('entered_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  // 기본키가 trip_id로 시작해서 여행별 조회는 따로 인덱스가 필요 없다.
  table => [primaryKey({ columns: [table.tripId, table.travelerId] })],
)
