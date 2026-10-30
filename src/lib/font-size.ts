// 가/가+ 글자 크기. 루트(html)의 data-font 속성으로 정하고 localStorage 에 저장한다.
// 첫 화면이 깜빡이지 않게 같은 값을 읽어 그리는 짧은 스크립트(FONT_INIT_SCRIPT)를 <head>에 넣는다.
export type FontScale = 'normal' | 'large'

export const FONT_STORAGE_KEY = 'bopok-font'

// 렌더링 전에 실행되어 저장된 크기를 html 에 붙인다. 저장소를 못 쓰면 기본 크기로 둔다
export const FONT_INIT_SCRIPT = `try{var f=localStorage.getItem('${FONT_STORAGE_KEY}');if(f==='large'){document.documentElement.dataset.font='large'}}catch(e){}`

const listeners = new Set<() => void>()

export function getFontScale(): FontScale {
  return document.documentElement.dataset.font === 'large' ? 'large' : 'normal'
}

export function getServerFontScale(): FontScale {
  return 'normal'
}

export function subscribeFontScale(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setFontScale(scale: FontScale): void {
  if (scale === 'large') document.documentElement.dataset.font = 'large'
  else delete document.documentElement.dataset.font
  try {
    window.localStorage.setItem(FONT_STORAGE_KEY, scale)
  } catch {
    // 저장이 막혀도 이번 화면에서는 바뀐다
  }
  listeners.forEach(listener => listener())
}
