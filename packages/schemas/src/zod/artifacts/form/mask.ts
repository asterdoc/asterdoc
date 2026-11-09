import { z } from 'zod';

/**
 * A mask in printable ASCII with at least one token (`#`, `@`, `*`), where
 * every `\` escapes a following character.
 */
export const MASK_PATTERN = /^(?:\\[ -~]|[ -"$-)+-?A-[\]-~])*[#*@](?:\\[ -~]|[ -[\]-~])*$/;

/**
 * An input mask: `#` a digit, `@` a letter, `*` a digit or letter, `\` makes
 * the next character a literal, and every other character is a literal.
 */
export const MaskSchema = z.string()
	.min(1)
	.max(200)
	.regex(MASK_PATTERN)
	.describe('Input mask in printable ASCII: # a digit, @ a letter, * a digit or letter, \\ makes the next character a literal, every other character is a literal (e.g., ###-##-####)');
