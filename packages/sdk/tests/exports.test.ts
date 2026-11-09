import { describe, expect, it } from 'vitest'
import * as core from '@asterdoc/core'
import * as render from '@asterdoc/render'
import * as pdf from '@asterdoc/render/pdf'
import * as sdk from '../src/index'

describe('@asterdoc/sdk exports', () => {
  it('exports every @asterdoc/core export unchanged', () => {
    const differing = Object.keys(core).filter(
      (key) => (sdk as Record<string, unknown>)[key] !== (core as Record<string, unknown>)[key],
    )
    expect(Object.keys(core).length).toBeGreaterThan(100)
    expect(differing).toEqual([])
  })

  it("exports core's renderLayer and render's createLayerRenderer side by side", () => {
    expect(sdk.renderLayer).toBe(core.renderLayer)
    expect(sdk.createLayerRenderer).toBe(render.createLayerRenderer)
    expect(sdk.createLayerRenderer().id).toBe('render-layer')
  })

  it('exports the placement API from @asterdoc/render/pdf as the same functions', () => {
    expect(sdk.locate).toBe(pdf.locate)
    expect(sdk.extractFieldsFromPdf).toBe(pdf.extractFieldsFromPdf)
  })

  it("exports render's default formatter, which prints every phone style, and the phone provider", () => {
    expect(sdk.defaultFormatter).toBe(render.defaultFormatter)
    expect(sdk.defaultFormatter.formatPhone('+12125551234', { style: 'national' })).toBe('(212) 555-1234')
    expect(sdk.defaultFormatter.providers.phone).toBe(sdk.phoneProvider)
    expect(sdk.createFormatter().safeFormatPhone('+12125551234', { style: 'national' })).toMatchObject({ success: false, status: 'unsupported' })
  })

  it("exports the regions provider, which render's default formatter carries", () => {
    expect(sdk.defaultFormatter.providers.regions).toBe(sdk.regionsProvider)
    expect(sdk.regionsProvider.entryPoint).toBe('@asterdoc/format/regions')
    expect(sdk.createFormatter().providers.regions).toBeUndefined()
  })

  // The per-format wrappers dropped options (font, expressions) on the way to
  // createLayerRenderer. Callers use createLayerRenderer, the built-in default renderer, or the
  // @asterdoc/render subpaths.
  it.each(['textRenderer', 'pdfRenderer', 'docxRenderer', 'inspectAcroFormFields'])('does not export %s', (name) => {
    expect(name in sdk).toBe(false)
  })
})
