/**
 * Tests for code snippets in concepts/rendering.mdx (Layers & Rendering)
 */
import { describe, test, expect } from 'vitest'
import { a } from '@asterdoc/sdk'
import { UnregisteredLayerRendererError } from '@asterdoc/core'

describe('Rendering Concept', () => {
  // ============================================================================
  // What Layers Are
  // ============================================================================

  describe('what layers are', () => {
    const form = a
      .form()
      .name('invoice')
      .fields({
        customer: { type: 'text' },
        total: { type: 'money' },
      })
      .defaultLayer('markdown')
      .layers({
        markdown: a
          .layer()
          .inline()
          .mimeType('text/markdown')
          .text(
            `
# Invoice
Customer: {{fields.customer}}
Total: {{fields.total}}
    `,
          ),
        pdf: a.layer().file().mimeType('application/pdf').path('templates/invoice.pdf'),
      })
      .build()

    test('defines form with multiple layers', () => {
      expect(form.kind).toBe('form')
      expect(form.defaultLayer).toBe('markdown')
      expect(form.layers).toBeDefined()
      expect(Object.keys(form.layers!)).toEqual(['markdown', 'pdf'])
      expect(form.layers!.markdown.kind).toBe('inline')
      expect(form.layers!.pdf.kind).toBe('file')
    })
  })

  // ============================================================================
  // Templates and Bindings
  // ============================================================================

  describe('templates and bindings', () => {
    const form = a
      .form()
      .name('lease-with-bindings')
      .fields({
        tenant: { type: 'text' },
      })
      .layers({
        pdf: a
          .layer()
          .file()
          .mimeType('application/pdf')
          .path('templates/lease.pdf')
          .bindings({
            PDFFieldName: 'formFieldName',
          }),
      })
      .build()

    test('defines PDF layer with bindings', () => {
      expect(form.layers!.pdf.kind).toBe('file')
      const pdfLayer = form.layers!.pdf as { bindings?: Record<string, string> }
      expect(pdfLayer.bindings).toBeDefined()
      expect(pdfLayer.bindings!.PDFFieldName).toBe('formFieldName')
    })
  })

  // ============================================================================
  // Renderers
  // ============================================================================

  describe('renderers', () => {
    const form = a
      .form()
      .name('renderable-form')
      .fields({
        name: { type: 'text' },
      })
      .defaultLayer('markdown')
      .layers({
        markdown: a
          .layer()
          .inline()
          .mimeType('text/markdown')
          .text('Hello {{fields.name}}'),
      })
      .build()

    test('selects the renderer from the layer MIME type', async () => {
      const filled = form.fill({ fields: { name: 'World' } })
      const markdown = await filled.render()
      expect(markdown).toContain('Hello')
      expect(markdown).toContain('World')
    })
  })

  // ============================================================================
  // React Layers
  // ============================================================================

  describe('react layers', () => {
    const form = a
      .form()
      .name('invoice')
      .fields({ customer: { type: 'text' } })
      .layers({
        composition: a.layer().file().mimeType('text/tsx').path('./invoice.tsx'),
      })
      .build()

    test('accepts a React layer declared as a file layer', () => {
      expect(form.layers!.composition.kind).toBe('file')
      expect(form.layers!.composition.mimeType).toBe('text/tsx')
    })

    test.each(['text/tsx', 'text/jsx', 'TEXT/TSX'])('rejects an inline %s layer', (mimeType) => {
      expect(() =>
        a
          .form()
          .name('invoice')
          .layers({ composition: a.layer().inline().mimeType(mimeType).text('<Invoice />') })
          .build(),
      ).toThrow(/React layers must be file layers/)
    })

    test('refuses to render a React layer without a registered renderer', async () => {
      const filled = form.fill({ fields: { customer: 'Acme' } })
      await expect(filled.render({ layer: 'composition' })).rejects.toThrow(UnregisteredLayerRendererError)
    })
  })
})
