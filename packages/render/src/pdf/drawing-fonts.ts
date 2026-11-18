import { zlibSync } from 'fflate'
import { PdfFieldFillError, type DrawingFont } from './field-appearance'
import { standardFonts, type StandardFontName } from './standard-font'
import { type PdfDict, type PdfModel, type PdfRef, type PdfValue } from './syntax'
import { FontProgramError, parseTrueType, subsetTrueType, type FontProgramProblem, type TrueTypeFont } from './truetype'
import { winAnsiCodes, winAnsiText } from './win-ansi'

/** A font program supplied to the PDF renderer, and the name its errors use for it. */
export interface PdfFont {
  /** A TrueType-outline font program (.ttf, or .otf with TrueType outlines). */
  bytes: Uint8Array
  /** Where the font came from, such as its path. Errors name the font by this. */
  source: string
}

/** Thrown when a supplied font cannot be used, naming its source. */
export class PdfFontError extends Error {
  readonly source: string
  readonly problem: FontProgramProblem

  constructor(source: string, problem: FontProgramProblem, detail: string) {
    super(`Cannot use font "${source}": ${detail}`)
    this.name = 'PdfFontError'
    this.source = source
    this.problem = problem
  }
}

/**
 * Scripts that need glyph shaping or right-to-left ordering. Filling draws one
 * glyph per character, left to right, so it cannot draw these faithfully.
 */
const SHAPED_SCRIPTS = [
  'Arabic', 'Hebrew', 'Syriac', 'Thaana', 'Nko', 'Adlam', 'Mandaic', 'Samaritan',
  'Devanagari', 'Bengali', 'Gurmukhi', 'Gujarati', 'Oriya', 'Tamil', 'Telugu', 'Kannada',
  'Malayalam', 'Sinhala', 'Thai', 'Lao', 'Tibetan', 'Myanmar', 'Khmer', 'Mongolian',
].map((script) => ({ script, pattern: new RegExp(`\\p{Script=${script}}`, 'u') }))

const LINE_BREAK = /[\r\n]/u
const WHITESPACE = /\s/u

/** The first script in `text` that needs shaping, or `undefined` when there is none. */
export function shapedScript(text: string): string | undefined {
  return shapedCharacter(text)?.script
}

/** The first character of `text` in a script that needs shaping, with its script. */
function shapedCharacter(text: string): { script: string; character: string } | undefined {
  for (const character of text) {
    const found = SHAPED_SCRIPTS.find(({ pattern }) => pattern.test(character))
    if (found) return { script: found.script, character }
  }
  return undefined
}

const hex4 = (value: number) => value.toString(16).padStart(4, '0').toUpperCase()

/** What one font of a chain measures: which characters it draws, and how wide each is. */
export interface FontFace {
  /** Height above the baseline, in 1000ths of the font size. */
  readonly ascent: number
  /** Depth below the baseline (negative), in 1000ths of the font size. */
  readonly descent: number
  /** True when the character has a glyph that paints. */
  covers(character: string): boolean
  /** The character's advance, in 1000ths of the font size. */
  advance(character: string): number
}

/** A font of a chain that can also draw: its resource name, its encoding, and its font dictionary. */
interface DrawFace extends FontFace {
  readonly resourceName: string
  encode(text: string): string
  reference(): PdfRef
  finish(): void
}

function programCovers(program: TrueTypeFont, character: string): boolean {
  const glyph = program.glyphFor(character.codePointAt(0)!)
  return glyph !== 0 && (WHITESPACE.test(character) || program.hasOutline(glyph))
}

/** A face measured from its TrueType program. */
class ProgramFace implements FontFace {
  readonly ascent: number
  readonly descent: number
  protected readonly scale: number

  constructor(protected readonly program: TrueTypeFont) {
    this.scale = 1000 / program.unitsPerEm
    this.ascent = program.ascent * this.scale
    this.descent = program.descent * this.scale
  }

  covers(character: string): boolean {
    return programCovers(this.program, character)
  }

  advance(character: string): number {
    return this.program.advance(this.program.glyphFor(character.codePointAt(0)!)) * this.scale
  }
}

function winAnsiCovers(character: string): boolean {
  try {
    winAnsiCodes(character)
    return true
  } catch {
    return false
  }
}

/** A standard PDF font as validation measures it: the WinAnsi characters, with the standard widths. */
function standardFace(name: StandardFontName): FontFace {
  const metrics = standardFonts[name]
  return { ascent: metrics.ascent, descent: metrics.descent, covers: winAnsiCovers, advance: (character) => metrics.width(character) }
}

/** A standard PDF font as filling draws it: a Type1 font with WinAnsi encoding, which every viewer has, so nothing is embedded. */
class StandardFont implements DrawFace {
  readonly resourceName: string
  readonly ascent: number
  readonly descent: number
  private readonly face: FontFace
  private ref?: PdfRef

  constructor(private readonly model: PdfModel, private readonly name: StandardFontName) {
    this.face = standardFace(name)
    this.resourceName = `PdrFont${name.replace('-', '')}`
    this.ascent = this.face.ascent
    this.descent = this.face.descent
  }

  covers(character: string): boolean {
    return this.face.covers(character)
  }

  advance(character: string): number {
    return this.face.advance(character)
  }

  encode(text: string): string {
    return `(${winAnsiText(text)})`
  }

  reference(): PdfRef {
    this.ref ??= this.model.addObject({
      kind: 'dict',
      entries: new Map<string, PdfValue>([
        ['Type', { kind: 'name', value: 'Font' }],
        ['Subtype', { kind: 'name', value: 'Type1' }],
        ['BaseFont', { kind: 'name', value: this.name }],
        ['Encoding', { kind: 'name', value: 'WinAnsiEncoding' }],
      ]),
    })
    return this.ref
  }

  finish(): void {}
}

/**
 * A TrueType program drawn through a Type0 font with Identity-H encoding, so
 * each character is shown by its glyph index. A supplied program is embedded
 * as a subset of the glyphs drawn; the form's own program is used by reference.
 */
class EmbeddedTrueType extends ProgramFace implements DrawFace {
  private readonly used = new Map<number, string>()
  private font?: PdfRef
  private fontFile?: PdfRef
  private descendant?: PdfDict
  private type0?: PdfDict

  constructor(
    private readonly model: PdfModel,
    program: TrueTypeFont,
    readonly resourceName: string,
    private readonly file: Uint8Array | PdfRef,
  ) {
    super(program)
  }

  encode(text: string): string {
    let hex = ''
    for (const character of text) {
      if (LINE_BREAK.test(character)) continue
      const glyph = this.program.glyphFor(character.codePointAt(0)!)
      if (!this.used.has(glyph)) this.used.set(glyph, character)
      hex += hex4(glyph)
    }
    return `<${hex}>`
  }

  reference(): PdfRef {
    if (this.font) return this.font
    const { program, model } = this
    if (this.file instanceof Uint8Array) this.fontFile = model.addObject({ kind: 'dict', entries: new Map<string, PdfValue>() }, new Uint8Array())
    const name = { kind: 'name' as const, value: program.postScriptName }
    const descriptor = model.addObject({
      kind: 'dict',
      entries: new Map<string, PdfValue>([
        ['Type', { kind: 'name', value: 'FontDescriptor' }],
        ['FontName', name],
        // Symbolic: the glyphs are addressed by index, not by a standard encoding.
        ['Flags', 4 | (program.fixedPitch ? 1 : 0)],
        ['FontBBox', program.bbox.map((value) => Math.round(value * this.scale))],
        ['ItalicAngle', program.italicAngle],
        ['Ascent', Math.round(this.ascent)],
        ['Descent', Math.round(this.descent)],
        ['CapHeight', Math.round(program.capHeight * this.scale)],
        ['StemV', 80],
        ['FontFile2', this.fontFile ?? (this.file as PdfRef)],
      ]),
    })
    this.descendant = {
      kind: 'dict',
      entries: new Map<string, PdfValue>([
        ['Type', { kind: 'name', value: 'Font' }],
        ['Subtype', { kind: 'name', value: 'CIDFontType2' }],
        ['BaseFont', name],
        ['CIDSystemInfo', {
          kind: 'dict',
          entries: new Map<string, PdfValue>([['Registry', 'Adobe'], ['Ordering', 'Identity'], ['Supplement', 0]]),
        }],
        ['FontDescriptor', descriptor],
        ['CIDToGIDMap', { kind: 'name', value: 'Identity' }],
        ['DW', Math.round(program.advance(0) * this.scale)],
      ]),
    }
    this.type0 = {
      kind: 'dict',
      entries: new Map<string, PdfValue>([
        ['Type', { kind: 'name', value: 'Font' }],
        ['Subtype', { kind: 'name', value: 'Type0' }],
        ['BaseFont', name],
        ['Encoding', { kind: 'name', value: 'Identity-H' }],
        ['DescendantFonts', [model.addObject(this.descendant)]],
      ]),
    }
    this.font = model.addObject(this.type0)
    return this.font
  }

  finish(): void {
    if (!this.descendant || !this.type0) return
    const glyphs = [...this.used.keys()].sort((left, right) => left - right)
    if (this.fontFile && this.file instanceof Uint8Array) {
      const subset = subsetTrueType(this.file, glyphs)
      const record = this.model.record(this.fontFile)!
      record.value = {
        kind: 'dict',
        entries: new Map<string, PdfValue>([
          ['Filter', { kind: 'name', value: 'FlateDecode' }],
          ['Length1', subset.length],
        ]),
      }
      record.stream = zlibSync(subset)
    }
    this.descendant.entries.set('W', glyphs.flatMap((glyph) => [
      glyph,
      [Math.round(this.program.advance(glyph) * this.scale)],
    ]))
    const entries = glyphs.map((glyph) => {
      const text = this.used.get(glyph)!
      let units = ''
      for (let index = 0; index < text.length; index++) units += hex4(text.charCodeAt(index))
      return `<${hex4(glyph)}> <${units}>`
    })
    const blocks: string[] = []
    for (let start = 0; start < entries.length; start += 100) {
      const block = entries.slice(start, start + 100)
      blocks.push(`${block.length} beginbfchar\n${block.join('\n')}\nendbfchar`)
    }
    const cmap = [
      '/CIDInit /ProcSet findresource begin',
      '12 dict begin',
      'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /Adobe-Identity-UCS def',
      '/CMapType 2 def',
      '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange',
      ...blocks,
      'endcmap',
      'CMapName currentdict /CMap defineresource pop',
      'end',
      'end',
    ].join('\n')
    this.type0.entries.set('ToUnicode', this.model.addObject({ kind: 'dict', entries: new Map() }, new TextEncoder().encode(cmap)))
  }
}

/** Read a supplied font program, failing with its source named. */
export function parseSupplied(font: PdfFont): TrueTypeFont {
  try {
    return parseTrueType(font.bytes)
  } catch (error) {
    if (error instanceof FontProgramError) throw new PdfFontError(font.source, error.problem, error.message)
    throw error
  }
}

/**
 * Refuse text no chain of faces can draw: a script that needs shaping, or a
 * character no face has.
 *
 * @throws {PdfFieldFillError} naming `subject`.
 */
export function refuseUndrawable(subject: string, text: string, faces: readonly FontFace[], standard: StandardFontName): void {
  const shaped = shapedCharacter(text)
  if (shaped) {
    throw new PdfFieldFillError(
      subject,
      'unsupported-script',
      { script: shaped.script, character: shaped.character },
      `the value contains ${shaped.script} script ("${shaped.character}", U+${hex4(shaped.character.codePointAt(0)!)}), which needs glyph shaping that PDF form filling and overlays do not do, whatever the font. ` +
        'Render documents in this script from a React composition layer.',
    )
  }
  for (const character of text) {
    if (LINE_BREAK.test(character) || faces.some((face) => face.covers(character))) continue
    throw new PdfFieldFillError(
      subject,
      'missing-glyph',
      { character },
      `no available font can draw "${character}" (U+${hex4(character.codePointAt(0)!)}). The field draws in ${standard}, a standard PDF font with the Windows Latin 1 characters only. To print this character, declare a TrueType font that has it on the PDF layer of the artifact: "font": { "path": "<file>.ttf" }.`,
    )
  }
}

/**
 * Text drawn in a chain of faces: each character in the first face that has
 * it. The ascent and descent are the largest of the faces the value uses.
 */
export class FaceRuns<F extends FontFace> {
  readonly ascent: number
  readonly descent: number

  constructor(protected readonly faces: readonly F[], text: string) {
    const used = new Set<F>()
    for (const character of text) if (!LINE_BREAK.test(character)) used.add(this.face(character))
    const measured = used.size > 0 ? [...used] : [faces[0]!]
    this.ascent = Math.max(...measured.map((face) => face.ascent))
    this.descent = Math.min(...measured.map((face) => face.descent))
  }

  /** The face that draws a character: the first that has it. */
  face(character: string): F {
    return this.faces.find((face) => face.covers(character)) ?? this.faces[0]!
  }

  covers(text: string): boolean {
    return [...text].every((character) => LINE_BREAK.test(character) || this.faces.some((face) => face.covers(character)))
  }

  width(text: string): number {
    let total = 0
    for (const character of text) if (!LINE_BREAK.test(character)) total += this.face(character).advance(character)
    return total
  }

  /** The text split into runs, each drawn by one face. */
  runs(text: string): Array<{ face: F; text: string }> {
    const runs: Array<{ face: F; text: string }> = []
    for (const character of text) {
      if (LINE_BREAK.test(character)) continue
      const face = this.face(character)
      const last = runs.at(-1)
      if (last?.face === face) last.text += character
      else runs.push({ face, text: character })
    }
    return runs
  }
}

/** Runs measured from faces that cannot draw: `show` gives no operators. */
class MeasuredRuns extends FaceRuns<FontFace> implements DrawingFont {
  show(): string {
    return ''
  }
}

/** Runs that draw: each run in its own font, every font named in `resources()`. */
class DrawnRuns extends FaceRuns<DrawFace> implements DrawingFont {
  constructor(faces: readonly DrawFace[], text: string, private readonly drawn: Set<DrawFace>) {
    super(faces, text)
  }

  show(text: string, size: string, names?: ReadonlyMap<string, string>): string {
    return this.runs(text).map(({ face, text: run }) => {
      this.drawn.add(face)
      return `/${names?.get(face.resourceName) ?? face.resourceName} ${size} Tf\n${face.encode(run)} Tj`
    }).join('\n')
  }

  /** The font resources the runs of `text` name. */
  resources(text: string): Array<[string, PdfRef]> {
    const faces = new Set(this.runs(text).map((run) => run.face))
    return [...faces].map((face) => [face.resourceName, face.reference()])
  }
}

/** Options that decide which fonts a render may draw with. */
export interface PdfFontOptions {
  /** The TrueType font the artifact's PDF layer declares. */
  layerFont?: PdfFont
  /** The standard font the artifact's PDF layer declares. */
  standard?: StandardFontName
  /** The standard font a binding declares, by the AcroForm field it fills. */
  fieldFonts?: ReadonlyMap<string, StandardFontName>
}

/** The standard font a field draws in: its binding's, else the layer's, else Helvetica, whatever font the PDF field itself names. */
function fieldStandard(subject: string, choice: { standard?: StandardFontName; fieldFonts?: ReadonlyMap<string, StandardFontName> }): StandardFontName {
  return choice.fieldFonts?.get(subject) ?? choice.standard ?? 'Helvetica'
}

/**
 * The fonts one render may draw with. Each character of a value is drawn in
 * the first of these that has it: an overlay's own font, the layer's
 * declared TrueType font, then the field's standard font: the binding's, the
 * layer's, or Helvetica.
 */
export class PdfFontSet {
  private readonly standardFonts = new Map<StandardFontName, StandardFont>()
  private readonly overlayFonts = new Map<Uint8Array, EmbeddedTrueType>()
  private readonly drawn = new Set<DrawFace>()

  private constructor(
    private readonly model: PdfModel,
    private readonly layer: EmbeddedTrueType | undefined,
    private readonly options: PdfFontOptions,
  ) {}

  /** Read the supplied fonts, failing now, naming its source, on one that cannot be used. */
  static create(model: PdfModel, options: PdfFontOptions = {}): PdfFontSet {
    const layer = options.layerFont && new EmbeddedTrueType(model, parseSupplied(options.layerFont), 'PdrFontLayer', options.layerFont.bytes)
    return new PdfFontSet(model, layer, options)
  }

  private standardFont(name: StandardFontName): StandardFont {
    let font = this.standardFonts.get(name)
    if (!font) {
      font = new StandardFont(this.model, name)
      this.standardFonts.set(name, font)
    }
    return font
  }

  /** A font one overlay names, read on first use and embedded once however many overlays name it. */
  private overlayFont(font: PdfFont): EmbeddedTrueType {
    let embedded = this.overlayFonts.get(font.bytes)
    if (!embedded) {
      embedded = new EmbeddedTrueType(this.model, parseSupplied(font), `PdrFontOverlay${this.overlayFonts.size}`, font.bytes)
      this.overlayFonts.set(font.bytes, embedded)
    }
    return embedded
  }

  /**
   * The fonts that draw `text`, each character in the first font that has it.
   *
   * @param subject - The field or overlay, named in errors.
   * @param overlayFont - The font a text overlay names; it is tried first.
   * @throws {PdfFieldFillError} for a script that needs shaping, or a character no font can draw.
   * @throws {PdfFontError} when `overlayFont` cannot be used.
   */
  select(subject: string, text: string, overlayFont?: PdfFont): DrawnRuns {
    const standard = fieldStandard(subject, this.options)
    const faces: DrawFace[] = [
      ...(overlayFont ? [this.overlayFont(overlayFont)] : []),
      ...(this.layer ? [this.layer] : []),
      this.standardFont(standard),
    ]
    refuseUndrawable(subject, text, faces, standard)
    return new DrawnRuns(faces, text, this.drawn)
  }

  /** Write widths, Unicode maps and font subsets for every font this render drew with. */
  finish(): void {
    for (const font of this.drawn) font.finish()
  }
}

/** The fonts validation measures a field's value with, in the order rendering tries them. */
export interface MeasuringFaces {
  /** The layer's declared TrueType font. */
  layer?: FontFace
  /** The layer's declared standard font. */
  standard?: StandardFontName
  /** The standard font a binding declares, by the AcroForm field it fills. */
  fieldFonts: ReadonlyMap<string, StandardFontName>
}

/** The fonts a print profile measures with. */
export function measuringFaces(options: { layer?: TrueTypeFont; standard?: StandardFontName; fieldFonts?: ReadonlyMap<string, StandardFontName> }): MeasuringFaces {
  return {
    ...(options.layer && { layer: new ProgramFace(options.layer) }),
    ...(options.standard && { standard: options.standard }),
    fieldFonts: options.fieldFonts ?? new Map(),
  }
}

/**
 * Measure `text` as rendering draws it in the field `subject`, without
 * drawing.
 *
 * @throws {PdfFieldFillError} for a script that needs shaping, or a character no font can draw.
 */
export function measureRuns(subject: string, text: string, faces: MeasuringFaces): DrawingFont & { covers(text: string): boolean } {
  const standard = fieldStandard(subject, faces)
  const chain: FontFace[] = [...(faces.layer ? [faces.layer] : []), standardFace(standard)]
  refuseUndrawable(subject, text, chain, standard)
  return new MeasuredRuns(chain, text)
}

/** Measures text in a supplied font, the way filling and overlays draw it. */
export interface PdfFontMetrics {
  /**
   * True when filling or an overlay can draw every character of `text` in
   * this font: each has a glyph that paints, and none is in a script that
   * needs shaping.
   */
  canDraw(text: string): boolean
  /** The width of `text` in points at `size`, ignoring line breaks. */
  width(text: string, size: number): number
}

/**
 * Metrics for a supplied font, so a caller can wrap or fall back before it
 * draws overlay text with that font.
 *
 * @throws {PdfFontError} when the font cannot be used, naming its source.
 */
export function pdfFontMetrics(font: PdfFont): PdfFontMetrics {
  const face = new ProgramFace(parseSupplied(font))
  return {
    canDraw: (text) => shapedScript(text) === undefined && [...text].every((character) => LINE_BREAK.test(character) || face.covers(character)),
    width: (text, size) => {
      let units = 0
      for (const character of text) if (!LINE_BREAK.test(character)) units += face.advance(character)
      return units * size / 1000
    },
  }
}
