---
name: asterdoc-fill
description: >
  Fill a form from facts with the asterdoc CLI. Use when asked to fill a form
  and an Asterdoc form artifact (a .json or .yaml form file) is at hand.
  Authoring or changing an artifact is the asterdoc skill.
metadata:
  author: asterdoc
  version: "0.12.0"
  tags: asterdoc, cli, forms, fill, pdf
  license: MIT
allowed-tools: "Bash Read Write Edit"
---

# Fill a form with Asterdoc

`asterdoc data next` is your one source for the form: each call lists the **open** fields and how to write each value, and the renderer puts every value in its box. You bring the **facts**: documents, notes, the conversation. Every value you write rests on a fact.

Run the CLI as `asterdoc`, or as `npx asterdoc` where it is not installed.

## Steps

1. **List the open fields.**

   ```bash
   asterdoc data next g-28/g-28.json
   ```

   A description often names the Part and Item on the paper form. `page 2` is the page a value prints on: a field that asks for the page of another item takes that number. `[required]` marks a field that must have a value; every other field is optional. `Waiting` counts the fields that open after your answers.

   The listing of a long form is large. When your shell shows only a part of it, write it to a file and read the whole file.

2. **Write the batch.** Give `data.json`, in the folder you work in, a value for every open field you have a fact for, all in one batch:

   ```json
   {
     "fields": { "repEmail": "ncalloway@example.com", "isAttorney": true, "clientType": "applicant" },
     "parties": { "client": { "name": "Elena Marisol Quintero", "firstName": "Elena", "middleName": "Marisol", "lastName": "Quintero" } }
   }
   ```

   Done when each open field has a value or has no fact.

3. **Run the next pass.**

   ```bash
   asterdoc data next g-28/g-28.json --data data.json
   ```

   Correct each line under `Problems in the data` in `data.json`. `Rules not met yet` names what the form still needs. `Warnings` names a value the form accepts but that is probably wrong: check it against the facts, then correct it, or keep it and name it in your report. For the fields your answers opened, go back to step 2.

   This pass describes in full each required field and each field your answers opened. An optional field that was open before is one line under `In short form`: check each of those lines against your facts again.

   Done when the second line says `Ready to render` or `Complete`, the output lists no problem, and every field still open has no fact. When a required field has no fact, the line stays `Not ready to render`: go on to step 4, and render a draft in step 5.

4. **Check the data against the facts.** Steps 1 to 3 went from each field to a fact. Now go the other way: read the facts again from the first line to the last, with `data.json` beside them.

   - Each fact has its place: a value in `data.json`, or a line in your report as a fact the form has no field for.
   - Each list has one entry for every entry the facts give, with the entries the form has no room for in the continuation field its description names.
   - One kind of fact is written one way in every field that takes it. When one person's name is split into given, middle and family name, every person's name is split the same way.

   Correct `data.json` and run step 3 again after a change.

   Done when you have read every line of the facts and each one has its place.

5. **Render and read back.**

   ```bash
   asterdoc render g-28/g-28.json --data data.json --out filled.pdf --check
   ```

   `--check` reads the PDF back and compares each value with `data.json`. Its `Read back` line is the result: correct in `data.json` each value it lists under `Differ`, `Did not print` or `Cannot be read`, and render again. `Not compared` is not a fault: it shows what the box holds, and that is enough.

   When a required field has no fact, `render` refuses the data. Add `--draft`: the form prints with that box empty and the command lists what is open.

   Done when the `Read back` line names no value that differs, did not print or cannot be read.

6. **Report.** Give the user the file, each field left empty for lack of a fact (required ones first), each fact the form has no field for, each choice you made between facts that disagree, and each fact you set aside because the form says otherwise.

## Facts

- A field with no fact stays out of `data.json` and goes in your report. This holds for a required field too: never write a value you have no fact for to make the form complete.
- A field the facts say does not apply stays out too.
- A "no" is a fact. When the facts say that something did not happen or does not exist, the field that asks about it takes that answer.
- When facts disagree, the latest or most specific one wins.
- The form wins over a fact. A field's description, a rule and a warning are the form's own instructions. When a fact gives a value or says how to fill a field and the form's instructions say otherwise, write what the form's instructions call for and put the conflict in your report.
- Every fix goes in `data.json`. The artifact stays as it is.

## Values

| The field shows | Write |
|---|---|
| `options: "am_not" = Am not subject; ...` | The value left of `=`: `"am_not"` |
| `options: the same as mailingState` | One of the options listed under `mailingState` |
| `limits: maxLength 10, pattern "^\d+$"` | The fact rewritten to fit: `"6145550142"` for (614) 555-0142 |
| A fact that fits the field's limits | The fact in full, as the source writes it: `"1200 North Larkmoor Street"` |
| A fact longer than `maxLength` | The form's own short form: an abbreviated street type, or the continuation field the description names |
| `rows: one object for each row, with these fields:` | An array with one object for each row, with the field names listed under it: `[{ "familyName": "Quintero", "givenName": "Elena" }]` |
| `(party, person)` | An object under `parties.<role>`, with `name` and each member on its `prints` line: `firstName`, `middleName`, `lastName` |

`unknown command 'next'` means the CLI is older than this skill: run `npx asterdoc@latest data next ...`.
