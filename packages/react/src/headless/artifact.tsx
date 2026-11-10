import { evaluateFormDefs } from "@asterdoc/core/compose";
import { mergeFormats, type ModifierTarget } from "@asterdoc/render";
import type { Attachment, Form, FormAnnex, FormField, Formatter, ValueFormat, Party } from "@asterdoc/types";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  annexSlot,
  CompositeFieldPathError,
  itemField,
  readAnnex,
  readValue,
  resolveAnnex,
  resolveField,
  UnknownFieldPathError,
} from "../lib/fields";
import {
  ArtifactFieldFormatError,
  canonicalFormatKey,
  createValueFormatter,
  ElementFormatError,
  elementFormatProblems,
  formatByType,
  type DocumentFormatter,
  type FormatOptions,
} from "../lib/format";
import { useUnresolvedPathCollector, type UnresolvedPathCollector } from "../components/check-context";
import { FormatterProvider, useArtifactFormatting } from "../components/formatter-context";
import { annexTargets, definitionTargets, fieldTargets } from "../lib/format-targets";
import { usePartialValues } from "../components/partial-context";
import { DRAWABLE_IMAGE_MEDIA_TYPES } from "../lib/image";

/** The data one composed document renders. */
export interface DocumentData {
  fields: Record<string, unknown>;
  parties: Record<string, Party | Party[]>;
  annexes?: Record<string, Attachment>;
  defs?: Record<string, unknown>;
}

export class MissingArtifactProviderError extends Error {
  constructor() {
    super("This hook must be rendered inside an <ArtifactProvider>.");
    this.name = "MissingArtifactProviderError";
  }
}

export class UnknownDefinitionError extends Error {
  constructor(readonly name: string, readonly formName: string) {
    super(`The form "${formName}" declares no computed definition named "${name}".`);
    this.name = "UnknownDefinitionError";
  }
}

export class InvalidListValueError extends Error {
  constructor(readonly path: string, value: unknown) {
    super(`The list field at path "${path}" requires an array value; received ${value === null ? "null" : typeof value}.`);
    this.name = "InvalidListValueError";
  }
}

export class UnknownPartyRoleError extends Error {
  constructor(readonly role: string, readonly formName: string) {
    super(`The form "${formName}" declares no party role "${role}".`);
    this.name = "UnknownPartyRoleError";
  }
}

interface ArtifactSnapshot {
  artifact: Form;
  data: DocumentData;
  defs: Map<string, unknown>;
  definitionIssues: Map<string, string>;
  formatting: DocumentFormatter;
  collector?: UnresolvedPathCollector;
}

interface ArtifactStore {
  getSnapshot(): ArtifactSnapshot;
  setSnapshot(snapshot: ArtifactSnapshot): boolean;
  subscribe(listener: () => void): () => void;
  emit(): void;
}

function createStore(initial: ArtifactSnapshot): ArtifactStore {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    setSnapshot(next) {
      if (snapshot === next) return false;
      snapshot = next;
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit() {
      for (const listener of listeners) listener();
    },
  };
}

const ArtifactContext = createContext<ArtifactStore | null>(null);
const useStoreLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface ArtifactProviderProps {
  artifact: Form;
  data: DocumentData;
  format?: FormatOptions;
  children: ReactNode;
}

function definitionIssuePath(path: readonly unknown[]): string {
  return path.length > 0 ? path.map(String).join(".") : "defs";
}

function snapshotOf(artifact: Form, data: DocumentData, formatting: DocumentFormatter, collector?: UnresolvedPathCollector): ArtifactSnapshot {
  if (data.defs !== undefined) {
    return { artifact, data, defs: new Map(Object.entries(data.defs)), definitionIssues: new Map(), formatting, collector };
  }
  const evaluated = evaluateFormDefs(artifact, { fields: data.fields, parties: data.parties });
  const issues = ("value" in evaluated && evaluated.value ? evaluated.value.issues : evaluated.issues) ?? [];
  const definitionIssues = new Map(issues.map((issue) => [definitionIssuePath(issue.path ?? []), issue.message]));
  return {
    artifact,
    data,
    defs: "value" in evaluated && evaluated.value ? evaluated.value.defsValues : new Map(),
    definitionIssues,
    formatting,
    collector,
  };
}

interface Keyed<T> {
  key: string;
  value: T | undefined;
}

/**
 * `value` kept as one object for as long as its canonical serialization is
 * unchanged, so an inline format literal neither re-renders nor re-selects.
 */
function useKeyed<T extends object>(value: T | undefined): Keyed<T> {
  const key = value === undefined ? "" : canonicalFormatKey(value);
  const ref = useRef<Keyed<T> | undefined>(undefined);
  if (ref.current?.key !== key) ref.current = { key, value };
  return ref.current;
}

/** A selection key with an element format's own key, when it has one. */
function keyed(key: string, element: Keyed<object>): string {
  return element.key === "" ? key : `${key}\u0000format:${element.key}`;
}

/** Supplies artifact data to headless hooks without rendering a DOM element. */
export function ArtifactProvider({ artifact, data, format, children }: ArtifactProviderProps) {
  const inheritedPartial = usePartialValues();
  const inheritedFormatting = useArtifactFormatting();
  const collector = useUnresolvedPathCollector();
  const formatterOption = format?.formatter ?? inheritedFormatting.formatter;
  const blank = format?.blank;
  const partial = format?.partial ?? inheritedPartial;
  const progressive = format?.progressive ?? inheritedFormatting.progressive;
  const presentation = useKeyed(mergeFormats(inheritedFormatting.presentation, format?.presentation));
  const formatting = useMemo(
    () => createValueFormatter({ formatter: formatterOption, blank, partial, progressive, presentation: presentation.value }),
    [formatterOption, blank, partial, progressive, presentation]
  );
  const snapshot = useMemo(() => snapshotOf(artifact, data, formatting, collector), [artifact, data, formatting, collector]);
  const storeRef = useRef<ArtifactStore | undefined>(undefined);
  const changedRef = useRef(false);
  if (!storeRef.current) storeRef.current = createStore(snapshot);
  changedRef.current = storeRef.current.setSnapshot(snapshot) || changedRef.current;
  useStoreLayoutEffect(() => {
    if (changedRef.current) {
      changedRef.current = false;
      storeRef.current?.emit();
    }
  }, [snapshot]);
  const provided = <ArtifactContext.Provider value={storeRef.current}>{children}</ArtifactContext.Provider>;
  if (presentation.value === undefined) return provided;
  return (
    <FormatterProvider
      formatter={inheritedFormatting.formatter}
      progressive={inheritedFormatting.progressive}
      presentation={presentation.value}
    >
      {provided}
    </FormatterProvider>
  );
}

function useStore(): ArtifactStore {
  const store = useContext(ArtifactContext);
  if (!store) throw new MissingArtifactProviderError();
  return store;
}

function useSelection<T>(key: string, select: (snapshot: ArtifactSnapshot) => T, equal: (a: T, b: T) => boolean): T {
  const store = useStore();
  const selectRef = useRef(select);
  selectRef.current = select;
  const selectedRef = useRef<{ key: string; snapshot: ArtifactSnapshot; value: T } | undefined>(undefined);
  const getSnapshot = useMemo(
    () => () => {
      const snapshot = store.getSnapshot();
      const previous = selectedRef.current;
      if (previous?.key === key && previous.snapshot === snapshot) return previous.value;
      const value = selectRef.current(snapshot);
      if (previous?.key === key && equal(previous.value, value)) {
        selectedRef.current = { key, snapshot, value: previous.value };
        return previous.value;
      }
      selectedRef.current = { key, snapshot, value };
      return value;
    },
    [store, key, equal]
  );
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

const same = <T,>(a: T, b: T) => Object.is(a, b);

/** Reads the current artifact. Prefer a focused hook when only one output is needed. */
export function useArtifact(): Form {
  return useSelection("artifact", (snapshot) => snapshot.artifact, same);
}

/**
 * Runs `attempt`, reporting a composite path to a check's collector rather
 * than throwing, so one bad binding does not stop the walk. Outside check mode
 * the refusal reaches the caller, which is what a render wants.
 */
function formatOrReport(snapshot: ArtifactSnapshot, path: string, attempt: () => string): string {
  if (!snapshot.collector) return attempt();
  try {
    return attempt();
  } catch (error) {
    if (
      error instanceof ArtifactFieldFormatError ||
      error instanceof CompositeFieldPathError ||
      error instanceof UnknownFieldPathError
    ) {
      snapshot.collector.report(error.path || path);
      return snapshot.formatting.blank;
    }
    throw error;
  }
}

export interface FieldBinding {
  field: FormField;
  value: unknown;
  text: string;
  /**
   * True when `text` came out as the document's blank placeholder.
   *
   * Which is not the same question as whether `value` is nullish: a composite
   * a serializer rejects because one member of it is unanswered — a money
   * amount with its currency and no number — is a value that prints blank. A
   * component drawing something else in place of a blank asks this because the
   * placeholder is the document's choice (`FormatOptions.blank`) and a
   * component cannot know the spelling it settled on.
   *
   * It is the comparison, not a claim about why the text is what it is: a
   * value that formats to exactly the placeholder reads as blank. The
   * formatter reports no reason of its own, and inventing one here would be a
   * second answer to a question only it can settle.
   */
  blank: boolean;
}

function sameField(a: FieldBinding, b: FieldBinding): boolean {
  return a.field === b.field && Object.is(a.value, b.value) && a.text === b.text && a.blank === b.blank;
}

/**
 * Checks an element's `format` against the values it prints, before any
 * value is read. A fault is thrown, or reported to a check as
 * `format:<path>`; the element then prints without its format.
 */
function admitFormat(
  snapshot: ArtifactSnapshot,
  path: string,
  format: ValueFormat | undefined,
  targets: readonly ModifierTarget[]
): ValueFormat | undefined {
  if (format === undefined) return undefined;
  const problems = elementFormatProblems(format, targets);
  if (problems.length === 0) return format;
  if (!snapshot.collector) throw new ElementFormatError(path, problems);
  snapshot.collector.report(`format:${path}`);
  return undefined;
}

/** The format a value prints with: the document's presentation, then each element level in order. */
function effectiveFormat(snapshot: ArtifactSnapshot, ...levels: readonly (ValueFormat | undefined)[]): ValueFormat | undefined {
  return levels.some((level) => level !== undefined)
    ? mergeFormats(snapshot.formatting.presentation, ...levels)
    : snapshot.formatting.presentation;
}

interface ResolvedField {
  field: FormField;
  declared: boolean;
}

function resolveOrReport(snapshot: ArtifactSnapshot, path: string): ResolvedField {
  try {
    return { field: resolveField(snapshot.artifact, path), declared: true };
  } catch (error) {
    if (!snapshot.collector) throw error;
    snapshot.collector.report(path);
    return { field: { type: "text", label: path, required: false, visible: true }, declared: false };
  }
}

function bindField(snapshot: ArtifactSnapshot, path: string, field: FormField, format: ValueFormat | undefined): FieldBinding {
  const value = readValue(snapshot.data.fields, path);
  const text = formatOrReport(snapshot, path, () => snapshot.formatting.format(field, value, path, format));
  return { field, value, text, blank: text === snapshot.formatting.blank };
}

/**
 * Reads and formats one declared field path. `format` is the element's own,
 * merged over the document's presentation; it must apply to the field's type.
 */
export function useField(path: string, format?: ValueFormat): FieldBinding {
  const element = useKeyed(format);
  return useSelection(keyed(`field:${path}`, element), (snapshot) => {
    const { field, declared } = resolveOrReport(snapshot, path);
    const admitted = admitFormat(snapshot, path, element.value, declared ? fieldTargets(snapshot.artifact, path) : []);
    return bindField(snapshot, path, field, effectiveFormat(snapshot, admitted));
  }, sameField);
}

function sameFields(a: readonly FieldBinding[], b: readonly FieldBinding[]): boolean {
  return a.length === b.length && a.every((binding, index) => sameField(binding, b[index]!));
}

/** The element several fields belong to, when it prints more than the fields: a party block. */
interface FieldGroupScope {
  path: string;
  targets: readonly ModifierTarget[];
}

function selectFields(
  snapshot: ArtifactSnapshot,
  paths: readonly string[],
  format: ValueFormat | undefined,
  scope?: FieldGroupScope
): readonly FieldBinding[] {
  const resolved = paths.map((path) => resolveOrReport(snapshot, path));
  const targets = [
    ...(scope?.targets ?? []),
    ...resolved.flatMap(({ declared }, index) => declared ? fieldTargets(snapshot.artifact, paths[index]!) : []),
  ];
  const admitted = admitFormat(snapshot, scope?.path ?? paths.join(", "), format, targets);
  const effective = effectiveFormat(snapshot, admitted);
  return paths.map((path, index) => bindField(snapshot, path, resolved[index]!.field, effective));
}

/**
 * Reads and formats several declared field paths, each exactly as `useField`
 * reads its one, for a component binding a number of paths its props decide
 * (a party's organization, address, and contact lines). `format` applies to
 * all of them, and each of its keys must apply to at least one.
 */
export function useFields(paths: readonly string[], format?: ValueFormat): readonly FieldBinding[] {
  return useFieldGroup(paths, format);
}

/** `useFields` for an element that prints more than the fields, whose `format` is checked against all it prints. */
export function useFieldGroup(paths: readonly string[], format?: ValueFormat, scope?: FieldGroupScope): readonly FieldBinding[] {
  const element = useKeyed(format);
  const scopeKey = scope === undefined ? "" : `${scope.path}\u0000${scope.targets.map((target) => target.kind).join(",")}`;
  return useSelection(
    keyed(`fields:${JSON.stringify(paths)}${scopeKey === "" ? "" : `\u0000scope:${scopeKey}`}`, element),
    (snapshot) => selectFields(snapshot, paths, element.value, scope),
    sameFields
  );
}

export interface AnnexBinding {
  /** The annex slot the artifact declares, or an empty slot on a form that admits ad-hoc annexes. */
  annex: FormAnnex;
  /** The slot's own heading, falling back to the slot name. */
  label: string;
  /** The attachment filled into the slot, or `undefined` when nothing is attached. */
  attachment: Attachment | undefined;
  /** The attachment as the shared formatter prints it, or the blank placeholder. */
  text: string;
}

function sameAnnex(a: AnnexBinding, b: AnnexBinding): boolean {
  return (
    a.annex === b.annex &&
    a.label === b.label &&
    Object.is(a.attachment, b.attachment) &&
    a.text === b.text
  );
}

/** What an unresolved slot binds to under a check, shared so the binding is stable. */
const UNRESOLVED_ANNEX: FormAnnex = Object.freeze({});

/** True when a value carries the two things every attachment names itself by. */
function isAttachment(value: unknown): value is Attachment {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" && typeof record.mimeType === "string";
}

/**
 * Reads and formats the attachment at one declared `annexes.<slot>` path.
 *
 * The text comes from the shared formatter's `attachment` kind, the same one
 * the text, DOCX, and PDF outputs print an annex with, so a composition that
 * prints an attachment's name prints what every other output prints.
 * `format` is the element's own, merged over the document's presentation.
 */
export function useAnnex(path: string, format?: ValueFormat): AnnexBinding {
  const element = useKeyed(format);
  return useSelection(keyed(`annex:${path}`, element), (snapshot) => {
    let annex: FormAnnex;
    let declared = true;
    try {
      annex = resolveAnnex(snapshot.artifact, path);
    } catch (error) {
      if (!snapshot.collector) throw error;
      snapshot.collector.report(path);
      annex = UNRESOLVED_ANNEX;
      declared = false;
    }
    const admitted = admitFormat(snapshot, path, element.value, declared ? annexTargets(snapshot.artifact, path) : []);
    const value = readAnnex(snapshot.data.annexes, path);
    return {
      annex,
      label: annex.title ?? annexSlot(path) ?? path,
      attachment: isAttachment(value) ? value : undefined,
      text: formatOrReport(snapshot, path, () => formatByType(
        "attachment", value, snapshot.formatting.formatter, snapshot.formatting.blank,
        path, snapshot.formatting.progressive, effectiveFormat(snapshot, admitted)
      )),
    };
  }, sameAnnex);
}

export interface AnnexPictureBinding extends AnnexBinding {
  /** The attachment when its MIME type is a picture, and `undefined` when it is not one. */
  picture: Attachment | undefined;
}

/** A MIME type a renderer draws rather than names. */
function isPicture(attachment: Attachment | undefined): boolean {
  return attachment !== undefined && DRAWABLE_IMAGE_MEDIA_TYPES.includes(attachment.mimeType.toLowerCase());
}

/**
 * The attachment at one annex path, read as a picture.
 *
 * Asking for a picture is what makes an attachment that is not one a mismatch,
 * so the report belongs here rather than in whatever draws it: `useAnnex` on
 * its own has no reason to call a spreadsheet wrong, and a composition that
 * owns its own markup cannot lose a check result the package promises.
 */
export function useAnnexPicture(path: string, format?: ValueFormat): AnnexPictureBinding {
  const binding = useAnnex(path, format);
  const collector = useUnresolvedPathCollector();
  const picture = isPicture(binding.attachment) ? binding.attachment : undefined;
  if (binding.attachment !== undefined && picture === undefined) {
    collector?.report(`image:${path}`);
  }
  return useMemo(() => ({ ...binding, picture }), [binding, picture]);
}

export interface ListBinding {
  field: FormField;
  item: FormField;
  rows: readonly unknown[];
  format: DocumentFormatter["format"];
  /**
   * One row's text, or one field's within it. `format` is merged over the
   * list's, and must apply to that value's type.
   */
  text(index: number, path?: string, format?: ValueFormat): string;
  /** One row's text in one declared column, the `column`-th of `ListFormats.columns`, in that column's format. */
  cell(index: number, column: number): string;
}

/** One column a list prints: the path of a field within an item, and its format. */
export interface ListColumn {
  /** The field within an item, such as `amount`. */
  path: string;
  /** Merged over the list's format; it must apply to the field's type. */
  format?: ValueFormat;
}

/** The element formats of a list: one for every value it prints, and one per column. */
export interface ListFormats {
  /** Merged under every column's format; each key must apply to at least one of the item's fields. */
  format?: ValueFormat;
  /**
   * The columns the list prints, in order. A field may appear in several
   * columns, each with its own format. Each format is checked against the
   * item's declared field even when the list has no rows.
   */
  columns?: readonly ListColumn[];
}

function sameList(a: ListBinding, b: ListBinding): boolean {
  return a.field === b.field && a.item === b.item &&
    a.rows.length === b.rows.length && a.rows.every((row, index) => Object.is(row, b.rows[index])) &&
    a.format === b.format;
}

const EMPTY_ROWS: readonly unknown[] = Object.freeze([]);

/**
 * Reads one declared list and formats scalar items or fields within its rows.
 * `formats` are the element's own, merged over the document's presentation.
 */
export function useList(path: string, formats?: ListFormats): ListBinding {
  const element = useKeyed(formats);
  return useSelection(keyed(`list:${path}`, element), (snapshot) => {
    let field: FormField;
    let item: FormField;
    let declared = true;
    try {
      field = resolveField(snapshot.artifact, path);
      item = itemField(snapshot.artifact, path);
    } catch (error) {
      if (!snapshot.collector) throw error;
      snapshot.collector.report(path);
      field = { type: "list", label: path, required: false, visible: true, item: { type: "text", required: false, visible: true } } as FormField;
      item = { type: "text", label: path, required: false, visible: true };
      declared = false;
    }
    const listFormat = admitFormat(snapshot, path, element.value?.format, declared ? fieldTargets(snapshot.artifact, path) : []);
    const columns = element.value?.columns ?? [];
    const columnFormats = columns.map(({ path: column, format }) => {
      if (format === undefined) return undefined;
      let targets: ModifierTarget[] = [];
      if (declared) {
        try {
          resolveField(snapshot.artifact, `${path}.0.${column}`);
          targets = fieldTargets(snapshot.artifact, `${path}.0.${column}`);
        } catch (error) {
          if (!snapshot.collector) throw error;
          snapshot.collector.report(`${path}.${column}`);
        }
      }
      return admitFormat(snapshot, `${path}.${column}`, format, targets);
    });
    const value = readValue(snapshot.data.fields, path);
    if (value !== undefined && value !== null && !Array.isArray(value)) {
      if (!snapshot.collector) throw new InvalidListValueError(path, value);
      snapshot.collector.report(path);
    }
    const rows = Array.isArray(value) ? value : EMPTY_ROWS;
    const print = (index: number, childPath: string | undefined, own: ValueFormat | undefined, rowField?: FormField) => {
      const rowPath = childPath ? `${path}.${index}.${childPath}` : `${path}.${index}`;
      const effective = effectiveFormat(snapshot, listFormat, own);
      return formatOrReport(snapshot, rowPath, () => {
        const resolved = rowField ?? resolveField(snapshot.artifact, rowPath);
        return snapshot.formatting.format(resolved, readValue(snapshot.data.fields, rowPath), rowPath, effective);
      });
    };
    const text = (index: number, childPath?: string, format?: ValueFormat) => {
      if (format === undefined) return print(index, childPath, undefined);
      const rowPath = childPath ? `${path}.${index}.${childPath}` : `${path}.${index}`;
      let rowField: FormField | undefined;
      try {
        rowField = resolveField(snapshot.artifact, rowPath);
      } catch {
        rowField = undefined;
      }
      const own = admitFormat(snapshot, rowPath, format, rowField ? fieldTargets(snapshot.artifact, rowPath) : []);
      return print(index, childPath, own, rowField);
    };
    const cell = (index: number, column: number) => {
      const declaredColumn = columns[column];
      if (declaredColumn === undefined) throw new RangeError(`The list at "${path}" declares no column ${column}.`);
      return print(index, declaredColumn.path, columnFormats[column]);
    };
    return { field, item, rows, format: snapshot.formatting.format, text, cell };
  }, sameList);
}

export interface TotalBinding {
  name: string;
  label: string;
  value: unknown;
  text: string;
}

function sameTotals(a: readonly TotalBinding[], b: readonly TotalBinding[]): boolean {
  return a.length === b.length && a.every((row, index) => {
    const other = b[index];
    return !!other && row.name === other.name && row.label === other.label &&
      Object.is(row.value, other.value) && row.text === other.text;
  });
}

/** The element formats of a totals block: one for every row, and one per definition. */
export interface TotalsFormats {
  /** Merged under every row's format; each key must apply to at least one row's type. */
  format?: ValueFormat;
  /**
   * One format per name, in the order of `names`, each checked against that
   * definition's declared type. A definition named twice takes each its own.
   */
  rows?: readonly (ValueFormat | undefined)[];
}

/**
 * Reads computed definitions in caller-selected display order. `formats` are
 * the element's own, merged over the document's presentation.
 */
export function useTotals(names: readonly string[], formats?: TotalsFormats): readonly TotalBinding[] {
  const element = useKeyed(formats);
  return useSelection(keyed(`totals:${names.join("\u0000")}`, element), (snapshot) => {
    const targets = names.flatMap((name) => definitionTargets(snapshot.artifact, name));
    const blockPath = names.map((name) => `defs.${name}`).join(", ");
    const blockFormat = admitFormat(snapshot, blockPath, element.value?.format, targets);
    return names.map((name, index) => selectTotal(snapshot, name, blockFormat, element.value?.rows?.[index]));
  }, sameTotals);
}

function selectTotal(
  snapshot: ArtifactSnapshot,
  name: string,
  blockFormat: ValueFormat | undefined,
  rowFormat: ValueFormat | undefined
): TotalBinding {
  const issuePath = `defs.${name}`;
  const definition = snapshot.artifact.defs?.[name];
  if (!definition) {
    if (!snapshot.collector) throw new UnknownDefinitionError(name, snapshot.artifact.name);
    snapshot.collector.report(issuePath);
    return { name, label: name, value: undefined, text: snapshot.formatting.blank };
  }
  const rowAdmitted = admitFormat(snapshot, issuePath, rowFormat, definitionTargets(snapshot.artifact, name));
  const value = snapshot.defs.get(name);
  const issue = snapshot.definitionIssues.get(issuePath) ?? snapshot.definitionIssues.get("defs");
  if (issue !== undefined) {
    if (snapshot.collector) snapshot.collector.report(issuePath);
    else if (!snapshot.formatting.partial) throw new Error(`${issuePath}: ${issue}`);
  }
  return {
    name,
    label: definition.label ?? name,
    value,
    text: formatOrReport(snapshot, issuePath, () => formatByType(
      definition.type, value, snapshot.formatting.formatter, snapshot.formatting.blank,
      issuePath, snapshot.formatting.progressive, effectiveFormat(snapshot, blockFormat, rowAdmitted)
    )),
  };
}

/** Reads parties for one declared artifact role. */
export function useParty(role: string): readonly Party[] {
  return useSelection(`party:${role}`, (snapshot) => {
    if (!Object.hasOwn(snapshot.artifact.parties ?? {}, role)) {
      if (snapshot.collector) {
        snapshot.collector.report(`party:${role}`);
        return [];
      }
      throw new UnknownPartyRoleError(role, snapshot.artifact.name);
    }
    const value = snapshot.data.parties[role];
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
  }, (a, b) => a.length === b.length && a.every((party, index) => Object.is(party, b[index])));
}

/**
 * The placeholder a partial document prints for a value not answered yet, or
 * `undefined` when the document is finished.
 *
 * It is the progressive policy's `missing` text, which defaults to the
 * document's blank, so a hook printing something the formatter never sees (a
 * party not filled yet, say) prints the same placeholder `Field` does.
 */
export function usePartialPlaceholder(): string | undefined {
  return useSelection(
    "partial-placeholder",
    (snapshot) => snapshot.formatting.partial
      ? snapshot.formatting.progressive?.missing ?? snapshot.formatting.blank
      : undefined,
    same
  );
}

/** Reads the formatter registry for advanced copy-owned components. */
export function useFormatter(): Formatter {
  return useSelection("formatter", (snapshot) => snapshot.formatting.formatter, same);
}

/** Reads the document's complete formatting policy for headless bindings. */
export function useDocumentFormatting(): DocumentFormatter {
  return useSelection("document-formatting", (snapshot) => snapshot.formatting, same);
}
