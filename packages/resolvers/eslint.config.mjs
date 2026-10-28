import { config } from "@asterdoc/eslint-config/base";

/** @type {import("eslint").Linter.Config} */
export default [
	...config,
	{
		ignores: ["dist/**"],
	},
];
