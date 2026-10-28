import { Command } from "commander";
import kleur from "kleur";
import open from "open";

/**
 * Create the 'docs' command
 * Opens the Asterdoc documentation in browser
 */
export function createDocsCommand(): Command {
	const docs = new Command("docs");

	docs
		.description("Open Asterdoc documentation in browser")
		.action(async () => {
			console.log(kleur.gray("Opening Asterdoc documentation..."));
			await open("https://docs.asterdoc.com");
		});

	return docs;
}
