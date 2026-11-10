/**
 * Serialize a JSON value as RFC 8785 (JSON Canonicalization Scheme) text.
 *
 * Object members are sorted by the UTF-16 code units of their names, numbers
 * are written as ECMAScript writes them, strings with the ECMAScript JSON
 * escapes, and nothing is written between tokens. Equal JSON data gives equal
 * text, whatever its key order or number spelling was.
 *
 * The value must be I-JSON: plain objects, arrays, strings without lone
 * surrogates, finite numbers, booleans and `null`. As `JSON.stringify` does,
 * an `undefined` object member is left out, and an `undefined` array element
 * or a hole in a sparse array is written `null`.
 *
 * @throws {TypeError} naming the path of a value that has no JSON form.
 */
export function canonicalJson(value: unknown): string {
	return write(value, '$')
}

function write(value: unknown, path: string): string {
	if (value === null) return 'null'
	switch (typeof value) {
		case 'boolean':
			return value ? 'true' : 'false'
		case 'number':
			if (!Number.isFinite(value)) throw new TypeError(`${path}: ${String(value)} has no JSON form`)
			return JSON.stringify(value)
		case 'string':
			return writeString(value, path)
		case 'object':
			return Array.isArray(value) ? writeArray(value, path) : writeObject(value, path)
		default:
			throw new TypeError(`${path}: a ${typeof value} has no JSON form`)
	}
}

function writeArray(items: readonly unknown[], path: string): string {
	return `[${Array.from(items, (item, index) => write(item === undefined ? null : item, `${path}[${index}]`)).join(',')}]`
}

function writeObject(value: object, path: string): string {
	const prototype = Object.getPrototypeOf(value)
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${path}: a ${value.constructor?.name ?? 'non-plain'} object has no JSON form`)
	}
	const record = value as Record<string, unknown>
	const members = Object.keys(record)
		.filter((key) => record[key] !== undefined)
		.sort()
		.map((key) => `${writeString(key, `${path} key`)}:${write(record[key], `${path}.${key}`)}`)
	return `{${members.join(',')}}`
}

function loneSurrogateOf(text: string): number | undefined {
	for (let index = 0; index < text.length; index++) {
		const unit = text.charCodeAt(index)
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = text.charCodeAt(index + 1)
			if (next >= 0xdc00 && next <= 0xdfff) {
				index++
				continue
			}
		}
		if (unit >= 0xd800 && unit <= 0xdfff) return unit
	}
	return undefined
}

function writeString(text: string, path: string): string {
	const lone = loneSurrogateOf(text)
	if (lone !== undefined) {
		throw new TypeError(`${path}: the string holds a lone surrogate (U+${lone.toString(16).toUpperCase()}), which I-JSON forbids`)
	}
	return JSON.stringify(text)
}

/**
 * The paths of every string, and every property name, that holds an unpaired
 * UTF-16 surrogate. A property name's path ends with the name itself.
 */
export function findLoneSurrogates(value: unknown, path: (string | number)[] = []): (string | number)[][] {
	if (typeof value === 'string') return loneSurrogateOf(value) === undefined ? [] : [path]
	if (Array.isArray(value)) return value.flatMap((item, index) => findLoneSurrogates(item, [...path, index]))
	if (typeof value !== 'object' || value === null) return []
	return Object.entries(value).flatMap(([key, item]) => [
		...(loneSurrogateOf(key) === undefined ? [] : [[...path, key]]),
		...findLoneSurrogates(item, [...path, key]),
	])
}

/** The issue a definition string with an unpaired surrogate is reported as. */
export const LONE_SURROGATE_MESSAGE =
	'Text holds an unpaired UTF-16 surrogate (half of a character); a definition must be well-formed Unicode'
