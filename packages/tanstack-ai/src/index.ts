import {
	toolDefinition,
	type ServerTool,
	type ToolDefinition,
	type ToolExecuteFunction,
	type ToolExecutionContext,
} from '@tanstack/ai'
import {
	attachModelOutputSerialization,
	configForExecution,
	operationNames,
	toolDefinitions,
	type OperationName,
	type OperationInput,
	type OperationOutput,
	type AsterdocToolsConfig,
	type ToolDefinitions,
} from '@asterdoc/ai-tools'

export { createToolExecutionContext } from '@asterdoc/ai-tools'
export type { AsterdocToolsConfig }
export type {
	ExtractInput,
	ExtractOutput,
	FillInput,
	FillOutput,
	FillStateInput,
	FillStateOutput,
	FillTarget,
	FillItemState,
	GetArtifactInput,
	GetArtifactOutput,
	GetRegistryInput,
	GetRegistryOutput,
	InspectArtifactInput,
	InspectArtifactOutput,
	OperationName,
	RenderInput,
	RenderOutput,
	ToolDefinitions,
	UpdateFillInput,
	UpdateFillOutput,
	ValidateArtifactInput,
	ValidateArtifactOutput,
	ValidateInputOutput,
	ValidateInputValue,
} from '@asterdoc/ai-tools'

type OperationExecutor<Name extends OperationName> = (
	input: OperationInput<Name>,
	config?: AsterdocToolsConfig,
) => Promise<OperationOutput<Name>>

export type AsterdocToolDefinition<Name extends OperationName = OperationName> = ToolDefinition<
	ToolDefinitions[Name]['input_schema'],
	ToolDefinitions[Name]['output_schema'],
	Name
>

export type AsterdocServerTool<Name extends OperationName = OperationName> = ServerTool<
	ToolDefinitions[Name]['input_schema'],
	ToolDefinitions[Name]['output_schema'],
	Name
>

export type AsterdocToolDefinitions = readonly [
	AsterdocToolDefinition<'get_registry'>,
	AsterdocToolDefinition<'get_artifact'>,
	AsterdocToolDefinition<'inspect_artifact'>,
	AsterdocToolDefinition<'validate_artifact'>,
	AsterdocToolDefinition<'validate_input'>,
	AsterdocToolDefinition<'fill'>,
	AsterdocToolDefinition<'get_fill_state'>,
	AsterdocToolDefinition<'update_fill'>,
	AsterdocToolDefinition<'render'>,
	AsterdocToolDefinition<'extract'>,
]

export type AsterdocToolSet = readonly [
	AsterdocServerTool<'get_registry'>,
	AsterdocServerTool<'get_artifact'>,
	AsterdocServerTool<'inspect_artifact'>,
	AsterdocServerTool<'validate_artifact'>,
	AsterdocServerTool<'validate_input'>,
	AsterdocServerTool<'fill'>,
	AsterdocServerTool<'get_fill_state'>,
	AsterdocServerTool<'update_fill'>,
	AsterdocServerTool<'render'>,
	AsterdocServerTool<'extract'>,
]

function definitionFor<Name extends OperationName>(name: Name): AsterdocToolDefinition<Name> {
	const definition = toolDefinitions[name]
	return toolDefinition({
		name,
		description: definition.description,
		inputSchema: definition.input_schema,
		outputSchema: definition.output_schema,
	}) as AsterdocToolDefinition<Name>
}

const definitions = {
	get_registry: definitionFor('get_registry'),
	get_artifact: definitionFor('get_artifact'),
	inspect_artifact: definitionFor('inspect_artifact'),
	validate_artifact: definitionFor('validate_artifact'),
	validate_input: definitionFor('validate_input'),
	fill: definitionFor('fill'),
	get_fill_state: definitionFor('get_fill_state'),
	update_fill: definitionFor('update_fill'),
	render: definitionFor('render'),
	extract: definitionFor('extract'),
} satisfies { [Name in OperationName]: AsterdocToolDefinition<Name> }

function createTool<Name extends OperationName>(name: Name, config?: AsterdocToolsConfig): AsterdocServerTool<Name> {
	const operation = toolDefinitions[name].execute as unknown as OperationExecutor<Name>
	const execute = (async (input: OperationInput<Name>, context?: ToolExecutionContext) =>
		operation(input, configForExecution(config, context?.abortSignal))) as ToolExecuteFunction<
		ToolDefinitions[Name]['input_schema'],
		ToolDefinitions[Name]['output_schema']
	>
	const shared = toolDefinitions[name]
	// TanStack serializes the validated output directly for the next model turn.
	// A schema transform preserves the full value while supplying its bounded JSON form.
	const definition = toolDefinition({
		name,
		description: shared.description,
		inputSchema: shared.input_schema,
		outputSchema: shared.output_schema.transform((output) => attachModelOutputSerialization(output, config?.maxOutputBytes)),
	})

	return definition.server(execute as never) as unknown as AsterdocServerTool<Name>
}

/** Return the definition-only tools for client registration or a shared chat declaration. */
export function asterdocToolDefinitions(): AsterdocToolDefinitions {
	return [
		definitions.get_registry,
		definitions.get_artifact,
		definitions.inspect_artifact,
		definitions.validate_artifact,
		definitions.validate_input,
		definitions.fill,
		definitions.get_fill_state,
		definitions.update_fill,
		definitions.render,
		definitions.extract,
	]
}

/** Create the registry discovery tool. */
export function getRegistry(config?: AsterdocToolsConfig): AsterdocServerTool<'get_registry'> {
	return createTool('get_registry', config)
}

/** Return the registry discovery definition without server execution context. */
export function getRegistryDefinition(): AsterdocToolDefinition<'get_registry'> {
	return definitions.get_registry
}

/** Create the registry artifact retrieval tool. */
export function getArtifact(config?: AsterdocToolsConfig): AsterdocServerTool<'get_artifact'> {
	return createTool('get_artifact', config)
}

/** Return the registry artifact retrieval definition without server execution context. */
export function getArtifactDefinition(): AsterdocToolDefinition<'get_artifact'> {
	return definitions.get_artifact
}

/** Create the bounded artifact inspection tool. */
export function inspectArtifact(config?: AsterdocToolsConfig): AsterdocServerTool<'inspect_artifact'> {
	return createTool('inspect_artifact', config)
}

/** Return the bounded artifact inspection definition without server execution context. */
export function inspectArtifactDefinition(): AsterdocToolDefinition<'inspect_artifact'> {
	return definitions.inspect_artifact
}

/** Create the artifact validation tool. */
export function validateArtifact(config?: AsterdocToolsConfig): AsterdocServerTool<'validate_artifact'> {
	return createTool('validate_artifact', config)
}

/** Return the artifact validation definition without server execution context. */
export function validateArtifactDefinition(): AsterdocToolDefinition<'validate_artifact'> {
	return definitions.validate_artifact
}

/** Create the progressive input validation tool. */
export function validateInput(config?: AsterdocToolsConfig): AsterdocServerTool<'validate_input'> {
	return createTool('validate_input', config)
}

/** Return the progressive input validation definition without server execution context. */
export function validateInputDefinition(): AsterdocToolDefinition<'validate_input'> {
	return definitions.validate_input
}

/** Create the initial draft fill tool. */
export function fill(config?: AsterdocToolsConfig): AsterdocServerTool<'fill'> {
	return createTool('fill', config)
}

/** Return the initial draft fill definition without server execution context. */
export function fillDefinition(): AsterdocToolDefinition<'fill'> {
	return definitions.fill
}

/** Create the draft progress inspection tool. */
export function getFillState(config?: AsterdocToolsConfig): AsterdocServerTool<'get_fill_state'> {
	return createTool('get_fill_state', config)
}

/** Return the draft progress inspection definition without server execution context. */
export function getFillStateDefinition(): AsterdocToolDefinition<'get_fill_state'> {
	return definitions.get_fill_state
}

/** Create the draft update tool. */
export function updateFill(config?: AsterdocToolsConfig): AsterdocServerTool<'update_fill'> {
	return createTool('update_fill', config)
}

/** Return the draft update definition without server execution context. */
export function updateFillDefinition(): AsterdocToolDefinition<'update_fill'> {
	return definitions.update_fill
}

/** Create the artifact rendering tool. */
export function render(config?: AsterdocToolsConfig): AsterdocServerTool<'render'> {
	return createTool('render', config)
}

/** Return the artifact rendering definition without server execution context. */
export function renderDefinition(): AsterdocToolDefinition<'render'> {
	return definitions.render
}

/** Create the filled-PDF extraction tool. */
export function extract(config?: AsterdocToolsConfig): AsterdocServerTool<'extract'> {
	return createTool('extract', config)
}

/** Return the filled-PDF extraction definition without server execution context. */
export function extractDefinition(): AsterdocToolDefinition<'extract'> {
	return definitions.extract
}

/** Create all ten native TanStack AI server tools for `chat({ tools })`. */
export function asterdocTools(config?: AsterdocToolsConfig): AsterdocToolSet {
	return [
		getRegistry(config),
		getArtifact(config),
		inspectArtifact(config),
		validateArtifact(config),
		validateInput(config),
		fill(config),
		getFillState(config),
		updateFill(config),
		render(config),
		extract(config),
	]
}

export { operationNames }
