import { describe, expect, it } from 'vitest'
import { parseBinding, PdfBindingSyntaxError, resolveLayerBindings } from '../src/index'
import { splitPartIndex } from '../src/layer-bindings'

describe('resolveLayerBindings', () => {
  const pdf = 'application/pdf'
  const layers = {
    copyA: { mimeType: pdf, bindings: { Name: 'name' }, format: { money: { currencyDisplay: 'none' } } },
    copyB: { mimeType: pdf, bindingsFrom: 'copyA' },
    copyC: { mimeType: pdf, bindingsFrom: 'copyB' },
    own: { mimeType: pdf, bindings: { Own: 'own' }, bindingsFrom: 'copyA' },
    plain: { mimeType: pdf },
    dangling: { mimeType: pdf, bindingsFrom: 'missing' },
    markdown: { mimeType: 'text/markdown', bindings: { alias: 'fields.name' } },
    markdownFrom: { mimeType: 'text/markdown', bindingsFrom: 'copyA' },
    fromMarkdown: { mimeType: 'APPLICATION/PDF', bindingsFrom: 'markdown' },
  }

  it('returns the layer own bindings', () => {
    expect(resolveLayerBindings(layers, layers.copyA)).toEqual({ Name: 'name' })
  })

  it('resolves through bindingsFrom to the named layer bindings, and only the bindings', () => {
    const resolved = resolveLayerBindings(layers, layers.copyB)
    expect(resolved).toBe(layers.copyA.bindings)
    expect(resolved).not.toHaveProperty('money')
  })

  it('prefers own bindings over bindingsFrom', () => {
    expect(resolveLayerBindings(layers, layers.own)).toEqual({ Own: 'own' })
  })

  it('follows one hop only: a source with no own bindings gives none', () => {
    expect(resolveLayerBindings(layers, layers.copyC)).toBeUndefined()
  })

  it('returns undefined for a layer with neither bindings nor bindingsFrom', () => {
    expect(resolveLayerBindings(layers, layers.plain)).toBeUndefined()
  })

  it('throws, naming the available layers, when bindingsFrom names no layer', () => {
    expect(() => resolveLayerBindings(layers, layers.dangling)).toThrow(
      'bindingsFrom "missing" references unknown layer. Available: copyA, copyB, copyC, own, plain, dangling, markdown, markdownFrom, fromMarkdown',
    )
  })

  it('gives a layer that is not a PDF no bindings, its own or reused', () => {
    expect(resolveLayerBindings(layers, layers.markdown)).toBeUndefined()
    expect(resolveLayerBindings(layers, layers.markdownFrom)).toBeUndefined()
  })

  it('reuses only a PDF layer: a source that is not a PDF gives none', () => {
    expect(resolveLayerBindings(layers, layers.fromMarkdown)).toBeUndefined()
  })
})

describe('parseBinding', () => {
  it('reads one path, with or without the fields. prefix', () => {
    expect(parseBinding('name').parts).toEqual([{ source: 'name', path: 'name' }])
    expect(parseBinding(' fields.name ').parts).toEqual([{ source: 'fields.name', path: 'name' }])
    expect(parseBinding('parties.buyer.name').parts).toEqual([{ source: 'parties.buyer.name', path: 'parties.buyer.name' }])
  })

  it('trims a qualifier and the path before it', () => {
    expect(parseBinding('fields.status : married').parts).toEqual([{ source: 'fields.status', path: 'status', qualifier: 'married' }])
    expect(parseBinding('ssn:2').parts).toEqual([{ source: 'ssn', path: 'ssn', qualifier: '2' }])
  })

  it('refuses several paths joined with a comma, naming the template to write', () => {
    expect(() => parseBinding('fields.city, state ,zip')).toThrow(
      'Binding "fields.city, state ,zip" joins several paths with a comma, which a binding does not do; print several values in one field with a template, such as {"template":"{{fields.city}}, {{fields.state}}, {{fields.zip}}"}.',
    )
    expect(() => parseBinding({ path: 'lines.0.name, total' })).toThrow('{"template":"{{fields.lines[0].name}}, {{fields.total}}"}')
    expect(() => parseBinding('city,,zip')).toThrow('{"template":"{{fields.city}}, {{fields.state}}"}')
    expect(() => parseBinding('ssn:1, ssn:2')).toThrow(PdfBindingSyntaxError)
  })

  it('refuses an empty path or qualifier, naming the binding', () => {
    expect(() => parseBinding('')).toThrow(PdfBindingSyntaxError)
    expect(() => parseBinding(':married')).toThrow('has an empty path')
    expect(() => parseBinding('status: ')).toThrow('Binding "status: " has an empty qualifier after "status:".')
  })
})

describe('parseBinding on a template', () => {
  it('reads the template, its format, and each path its placeholders read', () => {
    const parsed = parseBinding({ template: '{{fields.city}}, {{fields.state}} {{fields.zip}}', format: { case: 'upper' } })
    expect(parsed.path).toBe('{{fields.city}}, {{fields.state}} {{fields.zip}}')
    expect(parsed.format).toEqual({ case: 'upper' })
    expect(parsed.part).toBeUndefined()
    expect(parsed.parts).toEqual([
      { source: 'fields.city', path: 'city' },
      { source: 'fields.state', path: 'state' },
      { source: 'fields.zip', path: 'zip' },
    ])
    expect(parsed.template?.lineBreak).toBe(false)
  })

  it('reads a path once however often it prints, a list row by its index, and a computed value under defs', () => {
    const parsed = parseBinding({ template: '{{fields.lines[1].name}} {{fields.lines[1].name}} {{parties.buyer.name}} {{total}} {{upper(fields.note)}}' })
    expect(parsed.parts).toEqual([
      { source: 'fields.lines.1.name', path: 'lines.1.name' },
      { source: 'parties.buyer.name', path: 'parties.buyer.name' },
      { source: 'defs.total', path: 'defs.total' },
      { source: 'fields.note', path: 'note' },
    ])
  })

  it('reads the paths placeholders print, not those a condition only tests', () => {
    const parsed = parseBinding({ template: '{{fields.line1}}{{#if fields.kind == "suite"}}, {{fields.line2}}{{/if}}' })
    expect(parsed.parts.map((part) => part.path)).toEqual(['line1', 'line2'])
  })

  it('gives each text the blocks can print, with the placeholders in it', () => {
    const { template } = parseBinding({ template: '{{fields.line1}}{{#if fields.line2 != null}}, {{fields.line2 | case="upper"}}{{else}} (no unit){{/if}}' })
    expect(template?.variants).toEqual([
      [{ slot: { source: 'fields.line1', segments: ['fields', 'line1'] } }, { text: ', ' }, { slot: { source: 'fields.line2', segments: ['fields', 'line2'], format: { case: 'upper' } } }],
      [{ slot: { source: 'fields.line1', segments: ['fields', 'line1'] } }, { text: ' (no unit)' }],
    ])
  })

  it('names the part a placeholder prints and leaves a computed placeholder without a path', () => {
    const { template } = parseBinding({ template: '{{fields.dob | part="year"}}-{{fields.a + fields.b}}' })
    expect(template?.variants).toEqual([[
      { slot: { source: 'fields.dob', segments: ['fields', 'dob'], part: 'year' } },
      { text: '-' },
      { slot: { source: 'fields.a + fields.b' } },
    ]])
  })

  it('says when the template holds a line break of its own', () => {
    expect(parseBinding({ template: '{{fields.name}}\n{{fields.street}}' }).template?.lineBreak).toBe(true)
    expect(parseBinding({ template: '{{#if fields.a != null}}a\r\nb{{/if}}' }).template?.lineBreak).toBe(true)
  })

  it('gives no texts for a template with more block combinations than it expands', () => {
    const blocks = Array.from({ length: 7 }, (_, index) => `{{#if fields.f${index} != null}}{{fields.f${index}}}{{/if}}`).join('')
    const parsed = parseBinding({ template: blocks })
    expect(parsed.template?.variants).toBeUndefined()
    expect(parsed.parts).toHaveLength(7)
    expect(parseBinding({ template: blocks.slice(0, blocks.length / 7 * 6) }).template?.variants).toHaveLength(64)
  })

  it('refuses an {{#each}} loop, at any depth', () => {
    expect(() => parseBinding({ template: '{{#each fields.lines}}{{item.name}}{{/each}}' })).toThrow(
      'has a template with an {{#each}} loop; a PDF field prints a fixed text, so bind each list row to its own field, such as fields.lines[0].amount.',
    )
    expect(() => parseBinding({ template: '{{#if fields.a != null}}{{#each fields.lines}}x{{/each}}{{/if}}' })).toThrow(PdfBindingSyntaxError)
  })

  it('refuses a signing directive', () => {
    expect(() => parseBinding({ template: 'Signed: {{signature(parties.tenant, "sign")}}' })).toThrow(
      'has a template with the signing directive signature(); a PDF layer places signing marks through its signature slots.',
    )
    expect(() => parseBinding({ template: '{{#unless fields.a}}{{initials(parties.tenant, "i")}}{{/unless}}' })).toThrow('initials()')
  })

  it('refuses markers that do not pair, with where', () => {
    expect(() => parseBinding({ template: '{{fields.a}}{{#if fields.b != null}}, {{fields.b}}' })).toThrow(
      'has a template that does not parse at line 1, column 13: Unclosed block {{#if}}.',
    )
    expect(() => parseBinding({ template: '{{/if}}' })).toThrow('Unexpected closing block {{/if}}')
  })

  it('keeps an expression that does not parse for the check and the render to report', () => {
    const parsed = parseBinding({ template: '{{fields.a +}}' })
    expect(parsed.parts).toEqual([])
    expect(parsed.template?.variants).toEqual([[{ slot: { source: 'fields.a +' } }]])
  })

  it('refuses a binding object with both a path and a template, or with neither', () => {
    expect(() => parseBinding({ path: 'city', template: '{{fields.city}}' } as never)).toThrow('holds both a path and a template; a binding object holds one of them.')
    expect(() => parseBinding({ format: {} } as never)).toThrow('is neither a path string nor a binding object with a string path or template.')
    expect(() => parseBinding({ template: 7 } as never)).toThrow(PdfBindingSyntaxError)
  })

  it('refuses a part on a template, naming the placeholder form', () => {
    expect(() => parseBinding({ template: '{{fields.dob}}', part: 'year' } as never)).toThrow(
      'sets a part on a template; write it on a placeholder, such as {{fields.dob | part="year"}}.',
    )
  })
})

describe('splitPartIndex', () => {
  it('reads a positive whole number as a zero-based part', () => {
    expect(splitPartIndex('1')).toBe(0)
    expect(splitPartIndex('12')).toBe(11)
  })

  it('reads anything else as no part', () => {
    for (const qualifier of ['0', '2x', '-1', '1.5', 'married', '01']) expect(splitPartIndex(qualifier)).toBeUndefined()
  })
})
