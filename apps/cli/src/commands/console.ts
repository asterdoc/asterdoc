import { Command } from "commander";
import kleur from "kleur";
import open from "open";
import { consoleConfig } from "../config/index.js";

/**
 * Create the 'console' command
 * Opens the Asterdoc web console in browser
 */
export function createConsoleCommand(): Command {
	const consoleCmd = new Command("console");

	consoleCmd
		.description("Open Asterdoc web console in browser")
		.action(async () => {
			console.log(kleur.gray("Opening Asterdoc console..."));
			await open(consoleConfig.baseUrl);
		});

	return consoleCmd;
}
