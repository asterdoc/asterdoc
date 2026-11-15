import { config } from "@asterdoc/eslint-config/base";

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...config,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "turbo/no-undeclared-env-vars": "off",
    },
  },
  {
    files: ["src/**"],
    ignores: ["src/commands/dev/index.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "exit",
          message: "Set process.exitCode and return, or throw CliExit. process.exit() drops output that a pipe has not yet taken.",
        },
      ],
    },
  },
  {
    ignores: ["dist/**"],
  },
];
