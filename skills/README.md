# Asterdoc Skills

Agent skills for [Asterdoc](https://asterdoc.com), the documents-as-code framework. A skill is a package of instructions and references that teaches an AI coding agent how to use Asterdoc's APIs, CLI and file formats.

## Available skills

| Skill | Use it for |
|---|---|
| [asterdoc](skills/asterdoc/) | Authoring, filling, validating, rendering and sealing artifacts with the TypeScript SDK, the `asterdoc` CLI, raw JSON/YAML, the AI agent tools, or the hosted MCP server. Includes a staged workflow for creating a form or converting a PDF form. |
| [asterdoc-react](skills/asterdoc-react/) | Composing, checking, previewing, rendering and sealing documents written in React with `@asterdoc/react` and `@asterdoc/react-pdf`. |

Install `asterdoc-react` on its own when composing documents in React is the only Asterdoc work in play. Install both when you also author the artifacts.

## Installation

### Claude Code

```bash
npx skills add https://github.com/asterdoc/asterdoc --skill asterdoc
npx skills add https://github.com/asterdoc/asterdoc --skill asterdoc-react
```

Or copy them by hand:

```bash
git clone https://github.com/asterdoc/asterdoc.git
cp -r framework/skills/skills/asterdoc ~/.claude/skills/
cp -r framework/skills/skills/asterdoc-react ~/.claude/skills/
```

### Claude.ai

Upload `SKILL.md` and the relevant files from `references/` to your project knowledge.

### From the website

Both public sites publish an [Agent Skills discovery index](https://github.com/cloudflare/agent-skills-discovery-rfc) at `/.well-known/agent-skills/index.json`, for example `https://docs.asterdoc.com/.well-known/agent-skills/index.json`. Each entry is a `.tar.gz` archive with `SKILL.md` and every reference, and a `sha256` digest of the archive bytes.

### Other agents

The skills follow the [Agent Skills specification](https://agentskills.io/specification.md). Point your agent's skill loader at each skill's `SKILL.md`.

## Structure

```text
skills/
  asterdoc/
    SKILL.md            # Manifest: rules, package map, dispatch
    metadata.json
    references/
      sdk.md cli.md schemas.md ai-tools.md mcp.md          # Surfaces
      artifacts.md fields.md parties.md annexes.md logic.md  # Topics
      layers.md templates.md pdf.md rendering.md formatting.md
      instructions.md filling.md sealing.md essentials.md
      workflow-author-form.md                               # Workflow
  asterdoc-react/
    SKILL.md            # Manifest: the compose-to-seal lifecycle
    metadata.json
    references/
      components.md pagination.md safe-classes.md
      custom-components.md render-and-seal.md cli.md
```

## Contributing

See [AGENTS.md](AGENTS.md) for the conventions and the tests that tie the skills to the code.

## License

MIT
