// 랜드마크 3D 모형(glb)을 three.js 로 그리는 maplibre 커스텀 레이어. 나무 레이어(treesLayer.ts)와 같은 방식이다.
// 모형마다 자기 위치를 원점으로 쓴다: 대전 전체 좌표(0.8 정도)를 GPU float32 로 계산하면 오차가 수 m 라서
// 원점 이동·축소는 CPU(배정밀도)에서 투영 행렬에 합친다.
// 푸른빛 강조: 파스텔 푸른 재질 + 은은한 emissive(숨쉬기) + 가장자리 프레넬 림 라이트 + 바닥 글로우.
// three·GLTFLoader 는 크기가 커서 레이어를 만들 때 불러온다(지도 화면 안에서만 쓰이는 파일).
import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl'
import { MercatorCoordinate } from 'maplibre-gl'
import {
  LANDMARKS_LAYER_ID, LANDMARK_FADE_ZOOM, LANDMARK_FALLBACK_COLOR, LANDMARK_GLASS_OPACITY, LANDMARK_MATERIAL_COLORS, LANDMARK_MODEL_DIR, LANDMARK_STYLE,
  landmarkCenter, landmarkFade, type Landmark,
} from './landmarks'

export type LandmarksLayer = CustomLayerInterface & {
  // 2D 보기에서는 모형을 그리지 않는다
  setVisible: (visible: boolean) => void
  // 화면 좌표(지도 캔버스 기준 px)에서 눌린 모형. 없으면 null
  pick: (point: { x: number; y: number }) => Landmark | null
  // 마우스를 올린/선택한 모형의 id (빛이 강해지고 바닥 글로우가 진해진다). null 이면 없음
  setHover: (id: string | null) => void
  setSelected: (id: string | null) => void
}

// 지도와 같은 빛 방향: style 의 light(position [1.5, 210, 30] = 남서쪽 위)에서 오는 약한 방향광 + 고른 주변광
const LIGHT = { ambient: 0.58, hemisphere: 0.14, directional: 0.62, position: [-0.29, 0.5, 1] as const }

export type LandmarksLayerOptions = {
  // landing: [시작 줌, 끝 줌]. 주면 줌이 이 구간을 지나는 동안 모형이 땅에서 솟는다(건물이 솟는 것과 같은 구간, S1 연출)
  riseZoom?: [number, number]
  // 휴대폰: 바닥 글로우와 림 라이트만 쓴다(emissive·숨쉬기 없음)
  compact?: boolean
  // ?debug=landmarks: 모형을 반투명(0.5)으로. &lmopacity=1 처럼 값을 주면 그 값으로
  opacity?: number
}

export async function createLandmarksLayer(landmarks: Landmark[], opts: LandmarksLayerOptions = {}): Promise<LandmarksLayer> {
  const THREE = await import('three')
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  // 지도와 같은 색을 그대로 내보낸다(색 변환 없이)
  THREE.ColorManagement.enabled = false

  const loader = new GLTFLoader()
  const disposables: { dispose(): void }[] = []
  const style = LANDMARK_STYLE
  const baseOpacity = opts.opacity ?? 1

  type Item = {
    landmark: Landmark
    scene: InstanceType<typeof THREE.Scene>
    group: InstanceType<typeof THREE.Group>
    solids: InstanceType<typeof THREE.MeshLambertMaterial>[]
    glasses: InstanceType<typeof THREE.MeshLambertMaterial>[]
    glowMaterial: InstanceType<typeof THREE.MeshBasicMaterial>
    rim: { uEye: { value: InstanceType<typeof THREE.Vector3> } }
    origin: MercatorCoordinate
    unit: number
    // 마지막으로 그린 투영 행렬(눌림 판정·시선 방향 계산용)
    proj: InstanceType<typeof THREE.Matrix4>
    drawn: boolean
    // 호버·선택 강조 정도 0~1 (부드럽게 따라간다)
    level: number
  }

  // GLB 는 Y 가 위, 긴 변이 X, 앞이 +Z(남쪽). 지도 장면은 x 동쪽·y 남쪽·z 위라서 (X, Y, Z) → (X, Z, Y) 로 바꾼 뒤
  // 북 기준 시계 방향 bearing 만큼 돌린다(모형 +X 가 처음 동쪽 = 방위 90°). 방향이 뒤집히는 변환이라 면의 앞뒤는 가리지 않고(DoubleSide) 그린다
  const orient = (bearingDeg: number, scale: number, heightScale: number) => {
    const phi = ((bearingDeg - 90) * Math.PI) / 180
    const c = Math.cos(phi)
    const s = Math.sin(phi)
    const swap = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1)
    const rotate = new THREE.Matrix4().set(c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
    return rotate.multiply(swap).multiply(new THREE.Matrix4().makeScale(scale, scale * heightScale, scale))
  }

  // 가장자리 발광(프레넬): 시선과 면이 비스듬할수록 밝다. 커스텀 카메라라 시선 위치(uEye)를 투영 행렬에서 직접 구해 넣는다
  const addRim = (material: InstanceType<typeof THREE.MeshLambertMaterial>, rim: Item['rim']) => {
    material.onBeforeCompile = shader => {
      shader.uniforms.uEye = rim.uEye
      shader.uniforms.uRimColor = { value: new THREE.Color(style.rimColor) }
      shader.uniforms.uRimStrength = { value: style.rimStrength }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWorldNormal = normalize(normalMatrix * objectNormal);')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uEye;\nuniform vec3 uRimColor;\nuniform float uRimStrength;\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;')
        .replace(
          '#include <opaque_fragment>',
          'float rimFacing = abs(dot(normalize(vWorldNormal), normalize(uEye - vWorldPos)));\noutgoingLight += uRimColor * pow(1.0 - clamp(rimFacing, 0.0, 1.0), 2.4) * uRimStrength;\n#include <opaque_fragment>',
        )
    }
    material.customProgramCacheKey = () => 'landmark-rim'
  }

  // 바닥 글로우용 원형 그라디언트(중심 불투명 → 가장자리 투명)
  const glowTexture = (() => {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(0.55, 'rgba(255,255,255,0.45)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, size, size)
    }
    const texture = new THREE.CanvasTexture(canvas)
    disposables.push(texture)
    return texture
  })()

  const items: Item[] = []
  for (const landmark of landmarks) {
    const gltf = await loader.loadAsync(`${LANDMARK_MODEL_DIR}${landmark.model}`)
    const rim = { uEye: { value: new THREE.Vector3() } }
    const solids: Item['solids'] = []
    const glasses: Item['glasses'] = []
    // 재질 이름(벽·지붕·유리…)별로 푸른 톤을 입힌다. 투톤 구분은 그대로이고 유리만 약간 투명
    const swapped = new Map<unknown, InstanceType<typeof THREE.MeshLambertMaterial>>()
    gltf.scene.traverse(obj => {
      const mesh = obj as InstanceType<typeof THREE.Mesh>
      if (!mesh.isMesh) return
      const source = mesh.material as InstanceType<typeof THREE.MeshStandardMaterial>
      let material = swapped.get(source)
      if (!material) {
        const isGlass = source.name === 'glass'
        material = new THREE.MeshLambertMaterial({
          color: new THREE.Color(LANDMARK_MATERIAL_COLORS[source.name] ?? LANDMARK_FALLBACK_COLOR),
          emissive: new THREE.Color(style.emissive),
          emissiveIntensity: style.emissiveFixed,
          side: THREE.DoubleSide,
        })
        addRim(material, rim)
        swapped.set(source, material)
        ;(isGlass ? glasses : solids).push(material)
        disposables.push(material, source)
      }
      mesh.material = material
      mesh.frustumCulled = false
      disposables.push(mesh.geometry)
    })
    const group = new THREE.Group()
    group.add(gltf.scene)
    group.matrixAutoUpdate = false
    group.matrix.copy(orient(landmark.bearingDeg, landmark.scale, landmark.heightScale))
    const scene = new THREE.Scene()
    scene.add(group)
    scene.add(new THREE.AmbientLight(0xffffff, LIGHT.ambient * Math.PI))
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2e0, LIGHT.hemisphere * Math.PI))
    const sun = new THREE.DirectionalLight(0xffffff, LIGHT.directional * Math.PI)
    sun.position.set(...LIGHT.position)
    scene.add(sun)

    // 바닥 글로우: 건물 아래 지면에 깐다. 반지름 = footprint 긴 변 × 0.75. 중심은 보정 전 기준 좌표(원래 건물 자리)
    const radius = landmark.footprintLongM * style.glowRadiusRatio
    const glowMaterial = new THREE.MeshBasicMaterial({ map: glowTexture, color: new THREE.Color(style.glowColor), transparent: true, depthWrite: false, opacity: 0 })
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), glowMaterial)
    // 장면은 x 동쪽·y 남쪽·z 위(원점은 offsetM 이 반영된 모형 중심)라서 기준 좌표는 반대로 옮긴다
    glow.position.set(-landmark.offsetM[0], landmark.offsetM[1], 0.3)
    glow.renderOrder = -1
    glow.frustumCulled = false
    disposables.push(glow.geometry, glowMaterial)
    scene.add(glow)

    const [lng, lat] = landmarkCenter(landmark)
    const origin = MercatorCoordinate.fromLngLat([lng, lat], 0)
    items.push({ landmark, scene, group, solids, glasses, glowMaterial, rim, origin, unit: origin.meterInMercatorCoordinateUnits(), proj: new THREE.Matrix4(), drawn: false, level: 0 })
  }

  let renderer: InstanceType<typeof THREE.WebGLRenderer> | null = null
  let map: MapLibreMap | null = null
  let visible = true
  let hoverId: string | null = null
  let selectedId: string | null = null
  const camera = new THREE.Camera()
  const main = new THREE.Matrix4()
  const toMercator = new THREE.Matrix4()
  const inverse = new THREE.Matrix4()
  const eye = new THREE.Vector4()
  const raycaster = new THREE.Raycaster()
  const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const layer: LandmarksLayer = {
    id: LANDMARKS_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    setVisible(v) {
      visible = v
      map?.triggerRepaint()
    },
    setHover(id) {
      if (id === hoverId) return
      hoverId = id
      map?.triggerRepaint()
    },
    setSelected(id) {
      if (id === selectedId) return
      selectedId = id
      map?.triggerRepaint()
    },
    onAdd(mapInstance, gl) {
      map = mapInstance
      renderer = new THREE.WebGLRenderer({ canvas: mapInstance.getCanvas(), context: gl, antialias: true })
      renderer.autoClear = false
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    },
    render(_gl, args) {
      if (!renderer || !map) return
      const zoom = map.getZoom()
      const fade = landmarkFade(zoom, LANDMARK_FADE_ZOOM)
      main.fromArray(args.defaultProjectionData.mainMatrix as unknown as number[])
      // 높이 방향 배율: 건물이 솟는 것과 같은 줌 구간(S1 연출). 그 밖(일정 화면 등)은 항상 1
      let grow = 1
      if (opts.riseZoom) grow = Math.min(1, Math.max(0, (zoom - opts.riseZoom[0]) / (opts.riseZoom[1] - opts.riseZoom[0])))
      // 숨쉬기: 움직임 줄이기·휴대폰은 고정값
      const breathing = !opts.compact && !reducedMotion()
      const breath = breathing
        ? style.emissiveMin + ((style.emissiveMax - style.emissiveMin) * (1 + Math.sin((performance.now() / style.breathMs) * Math.PI * 2))) / 2
        : style.emissiveFixed
      let animating = false
      renderer.resetState()
      for (const item of items) {
        item.drawn = visible && fade > 0.001 && grow > 0.001
        if (!item.drawn) continue
        // 호버·선택 강조(부드럽게)
        const target = item.landmark.id === hoverId || item.landmark.id === selectedId ? 1 : 0
        item.level += (target - item.level) * 0.25
        if (Math.abs(target - item.level) < 0.01) item.level = target
        else animating = true
        const emissive = opts.compact ? 0 : breath + (style.emissiveActive - breath) * item.level
        for (const material of item.solids) {
          material.emissiveIntensity = emissive
          material.opacity = fade * baseOpacity
          material.transparent = material.opacity < 0.999
        }
        for (const material of item.glasses) {
          material.emissiveIntensity = emissive
          material.opacity = fade * baseOpacity * LANDMARK_GLASS_OPACITY
          material.transparent = true
        }
        // 바닥 글로우도 같은 구간에서 같이 나타난다
        item.glowMaterial.opacity = fade * (style.glowAlpha + (style.glowAlphaActive - style.glowAlpha) * item.level)
        toMercator.makeTranslation(item.origin.x, item.origin.y, item.origin.z).scale(new THREE.Vector3(item.unit, item.unit, item.unit * grow))
        item.proj.copy(main).multiply(toMercator)
        // 시선 위치(장면 좌표): 투영 행렬에서 x=y=w=0 이 되는 점. 림 라이트 방향 계산용
        inverse.copy(item.proj).invert()
        eye.set(0, 0, 1, 0).applyMatrix4(inverse)
        if (Math.abs(eye.w) > 1e-12) item.rim.uEye.value.set(eye.x / eye.w, eye.y / eye.w, eye.z / eye.w)
        camera.projectionMatrix.copy(item.proj)
        renderer.render(item.scene, camera)
      }
      // 숨쉬기·강조 전환이 끊기지 않게 계속 다시 그린다(안 보일 때는 멈춘다)
      if (items.some(i => i.drawn) && (breathing || animating)) map.triggerRepaint()
    },
    pick(point) {
      const canvas = map?.getCanvas()
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      const ndcX = (point.x / rect.width) * 2 - 1
      const ndcY = 1 - (point.y / rect.height) * 2
      let best: { landmark: Landmark; distance: number } | null = null
      for (const item of items) {
        if (!item.drawn) continue
        const inv = item.proj.clone().invert()
        const near = new THREE.Vector3(ndcX, ndcY, -1).applyMatrix4(inv)
        const far = new THREE.Vector3(ndcX, ndcY, 1).applyMatrix4(inv)
        raycaster.set(near, far.sub(near).normalize())
        // 바닥 글로우는 눌림 대상이 아니고 모형(group)만 맞춘다. 모형 어디를 눌러도 장소로 이어진다
        const hit = raycaster.intersectObject(item.group, true)[0]
        if (hit && (!best || hit.distance < best.distance)) best = { landmark: item.landmark, distance: hit.distance }
      }
      return best?.landmark ?? null
    },
    onRemove() {
      for (const d of disposables) d.dispose()
      renderer?.dispose()
      renderer = null
      map = null
    },
  }
  return layer
}
