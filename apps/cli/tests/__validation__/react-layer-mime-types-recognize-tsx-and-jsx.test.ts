import { describe, expect, it } from 'vitest'
import { getMimeType, isKnownMimeType } from '../../src/utils/mime.js'

describe('React layer MIME types recognize TSX and JSX', () => {
  it('recognizes TSX and JSX', () => {
    expect(getMimeType('.tsx')).toBe('text/tsx')
    expect(getMimeType('.jsx')).toBe('text/jsx')
    expect(isKnownMimeType('.tsx')).toBe(true)
  })
})
