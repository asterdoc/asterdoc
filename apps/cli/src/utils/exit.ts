export class CliExit extends Error {
	readonly exitCode: number

	constructor(exitCode: number) {
		super(`Exit with code ${exitCode}`)
		this.name = 'CliExit'
		this.exitCode = exitCode
	}
}
