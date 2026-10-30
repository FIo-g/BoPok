// 화면 공통 부품. 큰 글씨·큰 버튼·쉬운 말(설계 3장). 상태는 항상 색과 글자(와 기호)를 함께 보여 준다.
import Link from 'next/link'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import type { Verdict } from '@/lib/contracts'

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

type Tone = 'brand' | 'ok' | 'warn' | 'info' | 'neutral'

const TONE_CLASS: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand-strong',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  info: 'bg-info-soft text-info',
  neutral: 'bg-white text-muted border border-line',
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-strong disabled:bg-[#b9c2d6]',
  secondary: 'bg-white text-brand-strong border border-brand hover:bg-brand-soft disabled:text-[#8a94a8] disabled:border-[#c9ced6]',
  ghost: 'bg-transparent text-muted hover:bg-black/5 disabled:opacity-50',
  danger: 'bg-white text-warn border border-warn hover:bg-warn-soft disabled:opacity-50',
}

const buttonBase = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 font-bold transition-colors disabled:cursor-not-allowed'

export function Button({ variant = 'primary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type="button" className={cx(buttonBase, BUTTON_CLASS[variant], className)} {...props} />
}

export function ButtonLink({ href, variant = 'primary', className, children }: { href: string; variant?: ButtonVariant; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cx(buttonBase, BUTTON_CLASS[variant], className)}>
      {children}
    </Link>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-2xl border border-line bg-surface p-5', className)}>{children}</div>
}

export function Badge({ tone = 'neutral', className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold', TONE_CLASS[tone], className)}>{children}</span>
}

const VERDICT_VIEW: Record<Verdict, { tone: Tone; label: string; mark: string }> = {
  ok: { tone: 'ok', label: '조건 충족', mark: '✓' },
  adjust: { tone: 'warn', label: '조정 필요', mark: '!' },
  info: { tone: 'info', label: '정보 부족', mark: '?' },
}

export const verdictView = (verdict: Verdict) => VERDICT_VIEW[verdict]

export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  const view = VERDICT_VIEW[verdict]
  return (
    <Badge tone={view.tone} className={className}>
      <span aria-hidden="true">{view.mark}</span>
      {view.label}
    </Badge>
  )
}

export function Notice({ tone = 'info', className, children }: { tone?: Exclude<Tone, 'neutral'>; className?: string; children: ReactNode }) {
  return (
    <div role={tone === 'warn' ? 'alert' : 'status'} className={cx('rounded-xl px-4 py-3 text-base', TONE_CLASS[tone], className)}>
      {children}
    </div>
  )
}

export function Spinner({ label = '불러오는 중이에요' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-muted">
      <span className="size-5 animate-spin rounded-full border-2 border-line border-t-brand" aria-hidden="true" />
      {label}
    </div>
  )
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl bg-warn-soft p-4 text-warn">
      <p className="font-bold">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          다시 시도
        </Button>
      )}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-bold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-sm text-muted">{hint}</span>}
    </label>
  )
}

const inputClass = 'min-h-12 w-full rounded-xl border border-line bg-white px-4 text-base placeholder:text-[#8a94a8] focus:border-brand'

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputClass, className)} {...props} />
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputClass, 'py-3 leading-relaxed', className)} {...props} />
}

// 고르는 버튼(칩). 눌린 상태는 색뿐 아니라 ✓ 로도 보여 준다
export function Chip({ selected, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(
        'inline-flex min-h-12 items-center gap-1 rounded-full border px-4 font-semibold transition-colors',
        selected ? 'border-brand bg-brand-soft text-brand-strong' : 'border-line bg-white text-ink hover:border-brand',
        className,
      )}
      {...props}
    >
      {selected && <span aria-hidden="true">✓</span>}
      {children}
    </button>
  )
}

export function PageShell({ className, children }: { className?: string; children: ReactNode }) {
  return <main className={cx('mx-auto w-full max-w-5xl px-5 py-8', className)}>{children}</main>
}

export function PageTitle({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-3xl font-extrabold leading-tight">{title}</h1>
        {sub && <p className="mt-1 text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

// 겹쳐 뜨는 창(버전 비교, 장소 고르기). Esc 와 바깥 눌러서 닫는다
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      onClick={onClose}
      onKeyDown={event => event.key === 'Escape' && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-surface p-6 sm:rounded-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-extrabold">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="닫기">
            닫기
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}
