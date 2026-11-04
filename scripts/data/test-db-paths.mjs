// Next 빌드는 .next를 정리한다. 검증 DB·백업은 빌드 캐시 밖의 별도 테스트 경로에 둔다.
import { resolve } from 'node:path'
// main의 건강 스키마를 포함해 마이그레이션을 재생성했으므로 이전 검증 DB와 분리한다.
export const TEST_DB_DIR = resolve('.pglite/daejeon-20261103-main-test')
export const TEST_BACKUP_DIR = resolve('.pglite/research-test-backups')
export const TEST_IMPORT_LOCK = resolve('.pglite/research-test.import.lock')
