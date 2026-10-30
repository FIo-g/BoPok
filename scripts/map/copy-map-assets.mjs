// maplibre-gl 워커를 public/map/ 으로 복사한다.
// 번들러(Turbopack)가 워커 경로를 깨뜨려서 "Worker failed to load" 가 나기 때문에, 고정된 주소에서 직접 불러온다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const src = path.join(root, 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs')
const dest = path.join(root, 'public/map/maplibre-gl-worker.mjs')
fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.copyFileSync(src, dest)
console.log(`copied ${path.relative(root, dest)}`)
