import 'server-only'

export type GeoErrorKind = 'invalid_request' | 'unsupported_mode' | 'missing_key' | 'upstream' | 'timeout'

export class GeoError extends Error {
  constructor(readonly kind: GeoErrorKind, message: string) {
    super(message)
    this.name = 'GeoError'
  }
}
