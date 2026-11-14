/** Names a template writes as signing directives rather than as expression functions. */
export const SIGNING_DIRECTIVES: ReadonlySet<string> = new Set(['signature', 'initials', 'signatureDate', 'capacity', 'printedName'])

/** The rule a signing directive with format modifiers breaks. */
export const DIRECTIVE_MODIFIER_RULE = 'A signing directive places a signing mark and takes no format modifiers.'
