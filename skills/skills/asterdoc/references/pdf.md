---
name: pdf
description: PDF layers - read field names and coordinates with asterdoc inspect, write bindings, binding objects (format, parts) and templates for several values in one box, for fill and extract, place signature slots, pass the fit check, pick fonts, money and date formats, read a filled PDF back.
metadata:
  tags: pdf, acroform, bindings, parts, template, format, mask, inspect, extract, lossy, coordinates, fonts, fit
---

# PDF layers

**Contents:** [Inventory the PDF](#inventory-the-pdf) · [Bindings](#bindings) · [Binding values](#binding-values) · [Binding objects](#binding-objects) · [Template bindings](#template-bindings) · [Example: W-9](#example-w-9) · [Signature slots on a PDF](#signature-slots-on-a-pdf) · [Fit check](#fit-check) · [Fonts](#fonts) · [Money](#money) · [Dates](#dates) · [Read a filled PDF back](#read-a-filled-pdf-back) · [Flat PDFs](#flat-pdfs)

A PDF layer is a file layer with `"mimeType": "application/pdf"`. This file covers what only PDF layers have. For the layer shape, file paths, and the slot schema, load [layers.md](./layers.md). To convert a whole PDF form into an artifact, follow [workflow-author-form.md](./workflow-author-form.md).

## Inventory the PDF

`asterdoc inspect` is the source of truth for field names, types, and boxes. Copy every name from its output; the visible label differs from the field name.

For a dropdown or a radio group, `options` lists each option as `{ value, label }`: the value the PDF stores and the text it shows. Give the bound enum field the stored value as its `value` and the shown text as its `label`. A fill writes the value as it is, so an enum whose value is the shown text prints a value the PDF does not have.

```bash
npx asterdoc inspect form.pdf --summary                                       # counts by type
npx asterdoc inspect form.pdf --format json --include-signatures > fields.json
```

The JSON is an array with one entry per AcroForm field:

| Key | Meaning |
|-----|---------|
| `name` | Fully qualified field name, for example `topmostSubform[0].Page1[0].f1_01[0]`. Copy it exactly as the binding key. |
| `type` | `text`, `checkbox`, `radio`, `dropdown`; `signature` with `--include-signatures`; `button` with `--include-buttons`. |
| `page` | One-based page number. |
| `rect` | `[x1, y1, x2, y2]` in PDF points, origin at the **bottom-left** of the page. |
| `maxLen` | Character limit of the box. A comb field (one character per box) has one. `null` means none. |
| `multiline` | Text fields only: `true` when the box prints several lines. A template's line break needs one. |
| `value` | Current value, if the PDF is already filled. |

`--filter "<glob>"` narrows by name. An empty array `[]` means a flat PDF (see [Flat PDFs](#flat-pdfs)). The renderer reads AcroForm fields only; XFA-only forms have no fields to bind.

## Bindings

`bindings` maps each **PDF field name (key)** to an **Asterdoc path (value)**. Keys are at most 500 characters. Where `bindings` may appear and how `bindingsFrom` reuses them is in [layers.md § Bindings](./layers.md#bindings).

<!-- dep:C7 -->
`asterdoc validate` rejects a binding whose key is not a field in the PDF, or whose value is not a known path. An inverted map (Asterdoc id as key) fails validation. The round trip remains the final check.

Path rules:

| Path | Example | Notes |
|------|---------|-------|
| Field id | `businessName` | Write the bare id, as the essentials do. |
| Nested member | `mailingAddress.line1` | Fieldset members and composite parts. |
| List item | `dependents[0].name` or `dependents.0.name` | More list items than bound indices fails the render: `PDF bindings for "dependents" support 2 list items, but received 3`. |
| Party, `max: 1` | `parties.taxpayer.name` | An index is refused. |
| Party, `max > 1` | `parties.tenant[0].name` | The index is required and must be below `max`. |
| Computed value | `defs.totalDue` | Fill only. |

With no `bindings` at all, PDF fields whose names equal top-level field ids fill automatically (fieldsets are skipped). Extraction needs explicit bindings, so always write them.

## Binding values

One table for filling and for reading back. "Extract" is the status [extraction](#read-a-filled-pdf-back) reports.

| Form | Example value | PDF field | Fill | Extract |
|------|---------------|-----------|------|---------|
| Direct | `"businessName"` | text | Writes the formatted value. An enum or multiselect writes the option **value** (the code, such as `C` or `5`), never the label. Make the value the code the form asks for, in the form's case: an LLC tax classification box takes `C`, `S` or `P`, so the options are `C`, `S`, `P`, not `c`, `s`, `p`. Keep the label for the human-readable name. | `recovered`, parsed into the field type |
| Direct | `"hasForeignPartners"` | checkbox | Checked when the value is truthy. | `recovered` as a boolean |
| Direct | `"species"` | radio, dropdown | Selects the state named by the value. Each option `value` must equal the PDF export value exactly. | `recovered` from the selected export value |
| Option | `"taxClassification:llc"` | checkbox | Checked when an enum equals the option, or a multiselect contains it. One binding per box. | `recovered` from the checked box. Two checked for an enum is `unparseable`. A multiselect comes back as a list. |
| Split part | `"ssn:1"`, `"ssn:2"`, `"ssn:3"` | text | Writes the Nth `-`-separated part (1-based). On a [masked](./fields.md#text-masks) field, the Nth group of the mask: `45` for `###-##-####`. | `recovered` by joining the parts. Every part must be bound. |
| Template | `{ "template": "{{fields.mailingAddress.locality}}, {{fields.mailingAddress.region}} {{fields.mailingAddress.postalCode}}" }` | text | Prints the template with each value in its placeholder. See [Template bindings](#template-bindings). | `recovered` when the text splits into the values one way, else `not_recoverable` or `unparseable` |
| Whole composite | `"mailingAddress"` | text | Writes the formatted address in one box. | `not_recoverable`. Bind the parts instead. |
| Party or computed | `"parties.tenant[0]"`, `"defs.totalDue"` | text | Writes the formatted value. | `not_recoverable` |

Prefer bindings that read back. Use a template only when the PDF gives several values one box, as the W-9 does for city, state, and ZIP. A string is always one path: `"city, state"` is refused (see [Template bindings](#template-bindings)).

Fill, extraction, the fit check, and validation parse a binding value the same way:

- A path may carry the `fields.` prefix: `"fields.businessName"` is `"businessName"`.
- Space around `:` is ignored: `"status: married"` is `"status:married"`.
- A string with a comma is refused, with a message that names the template form. `"ssn:1, ssn:2"` fails validation.
- Every binding key must name a field of the template. Filling fails, naming the key, when one does not.

## Binding objects

A binding value can also be an object. `path` is the string the binding would be (a binding that prints several values holds `template` instead, see [Template bindings](#template-bindings)). `format` prints this one value its own way, merged over the layer's `format` ([formatting.md § Artifact formats](./formatting.md#artifact-formats)). `part` prints one piece of the value as plain digits, for a form with a box per piece.

```json schema=form
{
  "fields": {
    "signedOn": { "type": "date" },
    "dob": { "type": "date" },
    "phone": { "type": "phone" },
    "fee": { "type": "money", "currency": "USD" },
    "ssn": { "type": "text", "mask": "###-##-####", "sensitive": true }
  },
  "layers": {
    "pdf": {
      "kind": "file",
      "mimeType": "application/pdf",
      "path": "form.pdf",
      "format": { "date": { "pattern": "MM/DD/YYYY" } },
      "bindings": {
        "SignedOn": "signedOn",
        "FiledOn": { "path": "signedOn", "format": { "date": { "pattern": "YYYY-MM-DD" } } },
        "DobMonth": { "path": "dob", "part": "month" },
        "DobDay": { "path": "dob", "part": "day" },
        "DobYear": { "path": "dob", "part": "year" },
        "AreaCode": { "path": "phone", "part": "areaCode" },
        "PhoneNumber": { "path": "phone", "part": "subscriberNumber" },
        "Dollars": { "path": "fee", "part": "units" },
        "Cents": { "path": "fee", "part": "cents" },
        "SsnComb": { "path": "ssn", "format": { "text": { "mask": false } } }
      }
    }
  }
}
```

For June 15, 1990, `SignedOn` prints `06/15/1990` and `FiledOn` `1990-06-15`. `SsnComb` prints `123456789` into a comb field with a box per digit.

| Kind | Parts |
|------|-------|
| `date` | `year` (4 digits), `month`, `day` (2 digits) |
| `phone` | `countryCode`, `nationalNumber`, `extension`; for +1 numbers, `areaCode` and `subscriberNumber` |
| `money` | `units`, `cents` |

- A part is never formatted as a whole value. Money rounds half away from zero to two decimals, then splits: `1.999` prints `2` and `00`.
- At render, a negative amount, a currency without two minor digits, and `areaCode` or `subscriberNumber` on a number outside +1 fail with `unsupported_part`. Under a `phone.region`, every phone part but `extension` refuses a number from another plan with `phone_region_mismatch`. Phone parts need the phone provider, which the default formatter has ([formatting.md § Lookup providers](./formatting.md#lookup-providers)).
- Validation refuses a part the kind does not have (`Binding "dob" prints the part "cents" of fields.dob, a date value, whose parts are "year", "month", "day".`), a `format` or `part` on a split part such as `ssn:2`, a `format` on an option test such as `status:married`, and a `part` on a template (write it on the placeholder).
- Read-back joins the parts only when every part the value needs is bound: a date's year, month and day; money's units and cents, in the field's `currency`; a phone's country code and national number, or a +1 number's area code and subscriber number. Otherwise the path is `not_recoverable`. Parts that disagree make it `unparseable`.
- A layer that reuses bindings through `bindingsFrom` takes each binding with its `format` and `part`, but not the other layer's own `format`.

## Template bindings

A binding object holds `path` or `template`, never both. A `template` prints several values in one box, in the template language of text layers ([templates.md](./templates.md)): `{{ }}` placeholders with any expression and format modifiers, `{{#if}}`, `{{#unless}}`, `{{else}}` and `{{! comment }}`. It is 1 to 2000 characters.

```json schema=form
{
  "fields": {
    "address": { "type": "address", "label": "Address" },
    "dob": { "type": "date", "label": "Date of birth" }
  },
  "layers": {
    "pdf": {
      "kind": "file",
      "mimeType": "application/pdf",
      "path": "form.pdf",
      "bindings": {
        "Street": { "template": "{{fields.address.line1}}{{#if fields.address.line2 != null}}, {{fields.address.line2}}{{/if}}" },
        "CityLine": { "template": "{{fields.address.locality}}, {{fields.address.region}} {{fields.address.postalCode}}" },
        "Born": { "template": "{{fields.dob | part=\"month\"}}/{{fields.dob | part=\"day\"}}/{{fields.dob | part=\"year\"}}" }
      }
    }
  }
}
```

`CityLine` prints `Boston, MA 02110`. `Street` prints `2150 Market Street, Suite 300` with a unit and `2150 Market Street` without one.

- **Paths.** A placeholder reads the expression roots: `fields.x`, `parties.role.name`, a computed value by its name (`{{total}}`), a list row by its index (`{{fields.lines[0].amount}}`). Write `fields.` in a template: a bare name is read as a computed value, though a string binding takes the bare id.
- **Printing.** A placeholder prints as a path binding to the same path does: a choice prints its option **value**, not its label, unless `choice.display` says `label`; masks apply; then the layer `format`, the binding `format`, and the placeholder's own modifiers. The binding's `format.case` changes the whole box, the template's own text included. A layer's `case` changes the values only.
- **No `part` on the binding.** Write it on the placeholder: `{{fields.dob | part="year"}}`.
- **Empty.** When every placeholder the template reached prints nothing, the box stays empty, so `{{fields.city}}, {{fields.state}}` with both empty does not print `, `. A branch with only literal text prints that text.
- **Line breaks.** A line break in the template starts a new line in a multi-line box. In a single-line box `asterdoc validate` reports an error: `the template has a line break, and "<field>" is a single-line field in "<file>", which prints it as a space; a line break starts a new line only in a multi-line field.` Check `multiline` in `asterdoc inspect`. A template bound to a box that is not a text field is also an error.
- **Refused.** `{{#each}}`: a box prints a fixed text, so bind each list row to its own box (`fields.lines[0].amount`). Signing directives such as `signature(...)` and `initials(...)`: a PDF layer places signing marks through its signature slots.
- **Optional pieces.** Put a piece that may be missing inside `{{#if}}`, with the text that belongs to it, as `Street` does.
- **Comma join.** A string such as `"city, state"` is refused: `Binding "city, state" joins several paths with a comma, which a binding does not do; print several values in one field with a template, such as {"template":"{{fields.city}}, {{fields.state}}"}.` An artifact on an earlier schema version still loads: its upgrade step writes the template that prints the same text, and `npx asterdoc migrate <file>` rewrites the file the same way.

`validate()` and `asterdoc validate` check a template like a text layer's: every expression and format modifier against the form, with messages such as `Layer "pdf", binding "f1": Template error at line 1, column 23 in {{fields.owner}}: ...`. The fit check measures each text a template can print, one for each combination of its `{{#if}}` blocks; a template with a computed placeholder is not measured.

## Example: W-9

Trimmed from the `@asterdoc/essentials` W-9 (`w9.spec`). The enum keeps three of its seven options. The PDF field names come from `asterdoc inspect`.

```json schema=form
"parties": {
  "taxpayer": {
    "label": "Taxpayer",
    "partyType": "any",
    "min": 1,
    "max": 1,
    "signature": { "required": true }
  }
},
"fields": {
  "businessName": { "type": "text", "label": "Business name", "maxLength": 80 },
  "taxClassification": {
    "type": "enum",
    "label": "Federal tax classification",
    "required": true,
    "enum": [
      { "value": "individual_or_sole_proprietor", "label": "Individual or sole proprietor" },
      { "value": "c_corporation", "label": "C corporation" },
      { "value": "llc", "label": "Limited liability company" }
    ]
  },
  "mailingAddress": { "type": "address", "label": "Mailing address", "required": true },
  "ssn": { "type": "text", "label": "Social security number", "sensitive": true, "pattern": "^\\d{3}-\\d{2}-\\d{4}$" }
},
"layers": {
  "pdf": {
    "kind": "file",
    "mimeType": "application/pdf",
    "path": "w-9.pdf",
    "title": "IRS Form W-9",
    "bindings": {
      "topmostSubform[0].Page1[0].f1_01[0]": "parties.taxpayer.name",
      "topmostSubform[0].Page1[0].f1_02[0]": "businessName",
      "topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].c1_1[0]": "taxClassification:individual_or_sole_proprietor",
      "topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].c1_1[1]": "taxClassification:c_corporation",
      "topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].c1_1[5]": "taxClassification:llc",
      "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_07[0]": "mailingAddress.line1",
      "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_08[0]": { "template": "{{fields.mailingAddress.locality}}, {{fields.mailingAddress.region}} {{fields.mailingAddress.postalCode}}" },
      "topmostSubform[0].Page1[0].f1_11[0]": "ssn:1",
      "topmostSubform[0].Page1[0].f1_12[0]": "ssn:2",
      "topmostSubform[0].Page1[0].f1_13[0]": "ssn:3"
    },
    "signatures": {
      "taxpayerSignature": {
        "party": { "role": "taxpayer" },
        "type": "signature",
        "placement": { "page": 1, "x": 175, "y": 586, "width": 195, "height": 14 }
      },
      "taxpayerDate": {
        "party": { "role": "taxpayer" },
        "type": "date_signed",
        "placement": { "page": 1, "x": 410, "y": 586, "width": 80, "height": 14 }
      }
    }
  }
},
"defaultLayer": "pdf"
```

A round trip of this artifact reports every path `recovered`, the city line included, because `Portland, OR 97201` splits into the template's values one way. `mailingAddress.country` has no box, so it is not in `data`.

## Signature slots on a PDF

Declare slots in the layer's `signatures` map with absolute or anchor placement ([layers.md § Slot rules](./layers.md#slot-rules)).

Absolute placement is in PDF points with the origin at the **top-left**. `inspect` reports `rect` from the bottom-left, so convert:

| Slot key | From `rect: [x1, y1, x2, y2]` |
|----------|-------------------------------|
| `x` | `x1` |
| `y` | `pageHeight - y2` |
| `width` | `x2 - x1` |
| `height` | `y2 - y1` |

Get `pageHeight` from `inspectPdf()`. US Letter is 612 × 792 points.

```typescript
import { readFile } from "node:fs/promises";
import { inspectPdf, locate } from "@asterdoc/render/pdf";

const pdf = new Uint8Array(await readFile("w-9.pdf"));
const { pages } = await inspectPdf(pdf);
// [{ page: 1, width: 611.976, height: 791.968 }]
const [hit] = await locate(pdf, [{ id: "sig", kind: "anchor", text: "Signature of" }]);
// { id: "sig", page: 1, x: 76, y: 580.6, width: 39.4, height: 7 }, top-left origin
```

A PDF often has a printed "Sign here" label and no signature field. Use `locate()` to measure the label, or declare an anchor placement and let the seal find it: `{ "anchor": { "text": "Signature of", "offsetX": 100 }, "width": 195, "height": 14 }`. The anchor text must be unique unless you set `occurrence`.

## Fit check

`asterdoc validate` checks, before any data exists, that bound values fit their PDF text boxes. For each binding to a text field it lays out values at the bound field's length limit (`maxLength`, or the length `pattern` allows):

| Result | When |
|--------|------|
| Error | A typical value of that length cannot fit at 6 points. An enum option value cannot fit. A value or split part has more characters than a comb field has boxes. |
| Warning | Only the widest value (all `W`) overflows. Or the bound field has no `maxLength` or `pattern`. |

Real messages name the layer, PDF field, path, and limit:

```text
✗ Layer "pdf", PDF field "topmostSubform[0].Page1[0].f1_02[0]" (bound to fields.businessName): the typical value fields.businessName accepts under maxLength 400 (400 characters) does not fit the 517.4 × 14.001 pt box at the minimum size of 6 pt
⚠ Layer "pdf", PDF field "topmostSubform[0].Page1[0].f1_02[0]" (bound to fields.businessName): fields.businessName has no maxLength or pattern that bounds its length, so a long value can fail to fill the 517.4 × 14.001 pt box
```

Fix each by giving the field a `maxLength` its box can hold (use `maxLen` from `inspect`, or the box width), or a `pattern`. Use a multiline PDF field for free text.

At fill time the renderer honors each field's font size (auto when 0), alignment, color, comb boxes, and multiline wrapping. A value that does not fit shrinks to 6 points. Past that, the render fails with `PdfFieldFillError` (`field`, `reason`: `overflow` or `comb-length`, `limit`).

## Fonts

Each value uses the first font that can draw all of it: a font passed at render time, then the layer's `font`, then the form's own embedded font for the field, then Helvetica for Latin-1 text. Latin-1 data needs no font. For names in Latin Extended, Greek, Cyrillic, or CJK scripts, declare a TrueType font (`.ttf`, TrueType outlines). The resolver reads it like the PDF, and it is embedded in the output.

```json schema=layer
"path": "w-9.pdf",
"font": { "path": "fonts/NotoSans-Regular.ttf" }
```

Only PDF layers declare a `font`. A character no font can draw fails with `PdfFieldFillError` (`reason: "missing-glyph"`, `character`). The error names the PDF field (`field`) and the artifact paths it prints (`paths`):

```text
Cannot fill PDF field "form1[0].Page1[0].NativeName[0]" with fields.nameInNativeAlphabet: no available font can draw "王" (U+738B). Declare a font that has this character on the PDF layer of the artifact: "font": { "path": "<file>.ttf" }. The SDK can also take a font for one render: pdfRenderer({ font }).
```

Correct it with a `font` on the PDF layer that has the character. `asterdoc render` has no font option; only the SDK can pass a font at render time.

`asterdoc validate` finds this before the first render: it prints the values of each test in `tests` with the fonts of each PDF layer, and each value they cannot draw is an error that names the layer, the test, the PDF field and the path. When a form takes names in other scripts, write a test with such a name.

Scripts that need shaping (Arabic, Hebrew, Devanagari, Thai, and others) fail with `reason: "unsupported-script"`, whatever the font. For those documents, compose the output with the `asterdoc-react` skill. An unreadable or non-embeddable font fails with `PdfFontError`.

## Money

A money value prints with its currency symbol (`$1,250.50`). When the PDF pre-prints the symbol beside the box, declare `format` on the layer and `currency` on the field:

```json schema=form
"fields": { "fee": { "type": "money", "currency": "USD" } },
"layers": {
  "pdf": {
    "kind": "file",
    "mimeType": "application/pdf",
    "path": "invoice.pdf",
    "format": { "money": { "currencyDisplay": "none" } },
    "bindings": { "Amount": "fee" }
  }
}
```

The box then holds `1,250.50`, and extraction reads it back in the field's declared `currency`. Both forms round-trip. Without a field `currency`, bind `fee.amount` to a box that holds a bare number. `money` also takes `fractionDigits` (`0` or `2`) and `useGrouping`; every key is in [formatting.md § Artifact formats](./formatting.md#artifact-formats). For separate dollar and cent boxes, bind [parts](#binding-objects).

## Dates

A date prints as the formatter writes it (`Jun 5, 2021`). When the PDF asks for one numeric order, declare the pattern on the layer: `"format": { "date": { "pattern": "MM/DD/YYYY" } }`. The patterns are `MM/DD/YYYY`, `DD/MM/YYYY`, and `YYYY-MM-DD`. Every date field of the layer prints in it, and extraction reads it back by the same pattern. A layer can declare `money` and `date` together.

## XFA and foreign addresses

A filled PDF carries no XFA form: the fill removes it and writes the file whole, so no XFA bytes stay in it, and a template with XFA beside its AcroForm needs no preparation. An address in a country with no address layout prints in the generic layout, so a foreign address never stops a render.

## Read a filled PDF back

Extraction runs the bindings in reverse.

```bash
npx asterdoc data extract w-9.json filled.pdf --out extracted.json   # also takes a directory of PDFs; --layer when there are several PDF layers
```

```typescript
import { w9 } from "@asterdoc/essentials";

const draft = w9.fill({
  fields: {
    taxClassification: "individual_or_sole_proprietor",
    mailingAddress: { line1: "123 Main St", locality: "Portland", region: "OR", postalCode: "97201", country: "US" },
    ssn: "123-45-6789",
  },
  parties: { taxpayer: { id: "taxpayer-0", name: "Jane Q. Public", firstName: "Jane", lastName: "Public" } },
});
const pdf = await draft.render({ layer: "pdf" });
const { data, report } = await w9.extract(pdf, { layer: "pdf" });
// data: { fields: { taxClassification, mailingAddress: { line1, locality, region, postalCode }, ssn }, parties: { taxpayer: { name } } }

const refilled = w9.safeFill(data);
if (!refilled.success) console.error(refilled.error.message); // "Form data validation failed: Missing required field: fields.mailingAddress.country": no box holds the country, so ask for it
```

`data` holds only values recovered exactly, in the fill payload shape. Extraction does not validate: pass `data` to `safeFill()`. A partial structured value stays partial and fails there with the missing parts named. A template box gives all its values only when its text splits one way; `2150 Market Street, Suite 300` read with the optional-unit `Street` template above splits two ways, so `line1` and `line2` are `not_recoverable`. The CLI `data extract` and the `extract` AI tool ([ai-tools.md](./ai-tools.md)) return the same result.

`report.entries` has one entry per bound path: `{ path, status, sources: [{ field, value }], reason?, lossy? }`. Every `recovered` entry carries `lossy`: `true` when the format the box was printed with dropped detail, as `case: "upper"` drops the letter case and `money.fractionDigits: 0` drops the cents. The value is the person's answer but may differ from the one filled: confirm it with the person before you rely on it. A person printed `family-first` in one box is `not_recoverable`; bind the name parts to read them back.

| Status | Meaning |
|--------|---------|
| `recovered` | Read back exactly. |
| `empty` | The bound PDF fields hold no value. |
| `not_recoverable` | The binding cannot be reversed: a template whose text splits more than one way (`The field's text splits into the template's values in more than one way, and extraction does not guess.`) or that prints a computed value (`The template prints a computed value, which cannot be read back.`), whole composite, whole party, `defs.*`, `annexes.*`, or an unbound split part. `reason` says which. |
| `unparseable` | The PDF value does not parse into the field type, does not match the binding's template (`The field's text does not match the binding's template.`), two boxes are checked for one enum, or the fields that carry the path disagree. |

`report.unbound` lists filled PDF fields that no binding covers: `{ field, type, value }`.

A refused input throws `PdfExtractionError` with a `code`:

| `code` | Cause |
|--------|-------|
| `malformed_pdf` | Not a readable PDF. |
| `no_form_fields` | The PDF has no fillable AcroForm fields (flat, flattened, or scanned). |
| `not_matching` | A binding key has no PDF field (the message names them), or the layer has no bindings. |
| `no_pdf_layer` | The artifact has no PDF layer. |
| `layer_required` | Several PDF layers exist. Pass `layer`. |
| `layer_not_found` | `layer` names no layer. |
| `not_pdf_layer` | `layer` names a layer that is not a PDF. |
| `unknown_bindings_source` | The layer's `bindingsFrom` names no layer. |

An encrypted PDF throws `PdfEncryptedError` (`code` `encrypted_pdf`). Every `@asterdoc/render/pdf` function that reads or writes a PDF refuses one the same way.

## Flat PDFs

`inspect` returns `[]` for a flat or scanned PDF. There is nothing to bind.

- Keep a PDF file layer only when the PDF itself must be shown or signed. It renders unchanged and can carry `signatures` slots with absolute or anchor placement.
- Present the data in a text layer ([templates.md](./templates.md)).
- For a printable replica of the form, compose it with the `asterdoc-react` skill.
