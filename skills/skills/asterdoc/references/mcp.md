---
name: mcp
description: The hosted Asterdoc MCP server at https://mcp.asterdoc.com/mcp. It needs an Asterdoc account. Connect with OAuth or an x-api-key, choose test, live, or both modes per connection, the data payload shape, every tool with its arguments and limits, which tools are billed, and rate limits.
metadata:
  tags: mcp, model-context-protocol, mcp.asterdoc.com, hosted, registry, fill, render, seal, extract, e-signature, payments, account, billing, webhooks, oauth, api-key
---

# Hosted MCP server

**Contents:** [Connect](#connect) · [Payload shape](#payload-shape) · [Workflow](#workflow) · [Artifact tools](#artifact-tools) · [Registry tools](#registry-tools) · [Render](#render) · [Platform tools](#platform-tools) · [Account tools](#account-tools) · [Limits](#limits)

Use this surface when an MCP client (Claude Code, Claude Desktop, Cursor) is connected to Asterdoc's hosted server. Nothing is installed. The server needs an Asterdoc account: every session acts for one Asterdoc organization. A person signs up and creates the organization in the Asterdoc console (`https://console.asterdoc.com`) before connecting.

When the user builds an agent in code, load [ai-tools.md](./ai-tools.md) instead. Its tools have other names; [ai-tools.md § Differences from MCP](./ai-tools.md#differences-from-mcp) maps them.

## Connect

| Endpoint | URL |
|----------|-----|
| MCP (streamable HTTP) | `https://mcp.asterdoc.com/mcp` |
| OAuth protected-resource metadata | `https://mcp.asterdoc.com/.well-known/oauth-protected-resource` |
| Health | `https://mcp.asterdoc.com/health` |

**OAuth (interactive clients).** Add the server by URL. The client runs sign-in on first connect. In Claude Code:

```bash
claude mcp add --transport http asterdoc https://mcp.asterdoc.com/mcp
```

Then run `/mcp` and choose **Authenticate**. The token must be scoped to an organization. A token with no organization is refused with `403` and a link to the console.

**Choose the connection's modes.** Sign-in identifies the member. What the connection may do is set once per connection, in the Asterdoc console, on **Settings → MCP connections**. The first call from a new connection returns an error with a link to that page. Open it, choose the modes and the permissions for each mode, and retry the call.

| Grant | Behavior |
|-------|----------|
| Test only, or live only | Every call runs in that mode. A call that names the other mode is refused. |
| Test and live | Every call that touches mode-owned content or records must pass `mode` (`"test"` or `"live"`). A call without it is refused; there is no default. |

Each mode has its own permissions, capped by the member's role. Every result from a platform tool ends with the mode it ran in (`mode: test`). Only `validate` and `fill` take no `mode`: they run on the artifact you pass in. Every other tool calls the platform and runs in a mode.

The same console page lists the member's connections. Revoke one mode, or the whole connection; the next call is refused. An organization administrator can turn MCP access off per mode for the whole organization.

A refused call returns `isError: true`. Its text starts with the error code, then the message, for example `MCP_MODE_REQUIRED: This MCP connection is granted both test and live mode, …`.

| Error code | Meaning |
|------------|---------|
| `MCP_CONNECTION_NOT_GRANTED` | The connection is not set up. The message carries the setup link. |
| `MCP_MODE_REQUIRED` | A test-and-live connection called without `mode`. |
| `MCP_MODE_NOT_GRANTED` | The call named a mode the connection does not hold. |
| `MCP_MODE_DISABLED` | An administrator turned MCP access off in that mode. |

**API key (headless clients).** Send the key in the `x-api-key` header, for example in `.mcp.json`:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "asterdoc": {
      "type": "http",
      "url": "https://mcp.asterdoc.com/mcp",
      "headers": { "x-api-key": "${ASTERDOC_API_KEY}" }
    }
  }
}
```

The server checks the key with the platform before it opens a session. An API-key connection runs in the key's mode (`ofk_test_…` or `ofk_live_…`) and needs no console setup. A call that names the other mode is refused.

| Response | Meaning |
|----------|---------|
| `401` with `WWW-Authenticate: Bearer resource_metadata="…"` | No credential, or a bad API key or token. OAuth clients start sign-in from this. |
| `403` | A valid token with no organization. Create the organization in the console, then reconnect. |
| `503` | The server could not check the credential. Retry later. |
| `429` | Rate limit. See [Limits](#limits). |
| `400` | A JSON-RPC batch (an array body). Send one message per request. |
| `413` | A request body over 4 MB. |

## Payload shape

`fill`, `render`, `seal`, `create_envelope` and `create_payment` take the same `data` object: `{ fields, parties, annexes }`. Value shapes: [fields.md § Field Type Reference](./fields.md#field-type-reference) and [parties.md § Party fill values](./parties.md#party-fill-values).

```jsonc
// data for fill, render, seal, create_envelope
{
  "fields": {
    "petName": "Rex",
    "weight": 30
  },
  "parties": {
    "tenant": { "name": "Jane Smith" }
  }
}
```

For a checklist, `data` is `{ "items": { "<item id>": true } }`: each item id maps to `true`, `false` or a string.

## Workflow

1. Find the artifact: `search` or `list_artifacts`. Each result carries `artifact`: a Platform coordinate such as `@acme/forms/nda`.
2. `get_artifact` with that `artifact`. Read `fields`, `parties` and `layers`, and follow `agentInstructions` when present.
3. `fill` with `{ "source": "registry", "id": "<artifact>" }` and your `data`. Repeat until `accepted` and `complete` are both `true`.
4. `render` with the same `artifact` and `data`, or pass the same source to `seal` or `create_envelope`.

For signing, call `seal` (the canonical PDF and signature map) or `create_envelope` (seal and send). For reading a filled document, call `describe` then `extract`.

## Artifact tool

`validate` checks an artifact definition you pass in. It makes no outbound call and is free.

| Tool | Arguments | Returns |
|------|-----------|---------|
| `validate` | `artifact` (object), `options?: { schema?: boolean, logic?: boolean }` (both default `true`) | `{ valid, detected_kind?, issues?: [{ message, path? }] }` |

An invalid artifact (`valid: false`) is a normal result. `fill` and `render` run through the platform API and are billed; see [Execution](#execution) and [Render](#render).

## Registry tools

The Asterdoc Platform registry is the default: your organization's artifacts, public and private, and every public artifact. An artifact there is a coordinate, `@org/repo/artifact`, optionally with `/edition` and `@version`. The same coordinate works in `render` and, as `{ "source": "registry", "id": "@org/repo/artifact" }`, in the platform tools.

To read an external Asterdoc file registry instead, pass `registry_url` (the folder that holds its `registry.json`, such as `https://public.asterdoc.com`). There an artifact is its name, and it works with `get_artifact` and `render` only.

| Tool | Arguments | Returns |
|------|-----------|---------|
| `search` | `query` (2-200 characters), `kind?` (`form`, `document`, `checklist`, `bundle`), `limit?` (1-50, default 20), `registry_url?` | `{ results: [{ artifact, name, kind, description, latest_version, … }] }`: your organization's matches first, then public ones |
| `list_artifacts` | `org?` (another organization's public artifacts), `repo?`, `kind?`, `limit?` (1-50, default 20), `offset?`, `registry_url?` | `{ artifacts, has_more }`. Without `org`, your organization's artifacts. |
| `get_artifact` | `artifact`, `edition?`, `version?`, `registry_url?` | `{ coordinate, edition?, version, artifact, metadata }` (or `registry_url` and `artifact_name` for an external registry). File `instructions` and `agentInstructions` come back inline. |

Every registry tool needs `repo:read`. Result keys are snake_case. The artifact JSON inside `get_artifact` keeps the artifact's own keys. A lookup that fails (an unknown or invisible artifact, a bad coordinate) returns a tool error (`isError: true`).

## Render

| Argument | Value |
|----------|-------|
| `artifact` | From a registry tool: a Platform coordinate, or a name with `registry_url`. |
| `registry_url?`, `edition?`, `version?` | As for `get_artifact`. |
| `data?` | A form: the payload you gave `fill`. A checklist: `{ items }`. A bundle: each member's payload keyed by its content key. A document takes none. Data that is present but has no values is refused (`errors` on `data`) unless `blank` is `true`. |
| `blank?` | `true` renders with no values, as a blank copy. Default `false`. |
| `layer?` | Layer key. Defaults to `defaultLayer`, then the first layer. Not used for a bundle: each member renders its own layer. |
| `merge?` | Bundle only: convert every part to PDF and return one merged PDF. |
| `source_mode?` | Platform registry only: `"live"` renders a live published version with a test connection. |
| `output_mode?` | `"url"` (default): a short download link per file that expires in 7 days. `"inline"`: the content in the response, base64 for binary output. Use `"inline"` for text or markdown shown in chat. |

`render` renders any artifact kind (form, checklist, document, bundle) to its layer's format: PDF, Markdown, plain text, HTML or DOCX. It runs through the platform API, so it needs `execution:run` (and `repo:read` for a Platform artifact) and is billed per page: a PDF page is a page, and for a text format a page is 2,000 readable characters (markup, Markdown syntax and table pipes do not count), rounded up, at least one. An external artifact (`registry_url`) is sent with the files its layers need.

Returns `{ success, render_id, billed_pages, mime_type, pages, characters?, download_url?, expires_at?, content?, encoding? }`, or for a bundle `{ success, render_id, billed_pages, parts: [{ content_key, filename, mime_type, pages, … }] }`. When the data is rejected, `success` is `false` with `errors`, and nothing is billed. When the render cannot run (an unknown artifact, an unknown layer, an empty balance), the tool returns an error (`isError: true`).

For an unpublished artifact, render locally with the SDK or CLI ([rendering.md](./rendering.md)). React (`text/tsx`) layers render with the `asterdoc-react` skill.

## Platform tools

These act on the session's organization through the Asterdoc platform API. The artifact argument is a source object, not the bare coordinate the registry tools take:

```jsonc
{ "source": "registry", "id": "@acme/forms/nda" }          // optional "@1.2.0" suffix, or "version"
{ "source": "inline", "artifact": { "kind": "form", "…": "…" } }
{ "source": "inline", "artifact": { "…": "…" }, "files": { "template.pdf": "<base64>" } }  // execution tools: a file-backed layer's files
```

A registry coordinate resolves in the call's mode. A test session never falls back to a live artifact. To test with a live published version, add `"source_mode": "live"` to the registry source. The version is read-only, and the call and its records stay in test mode. To change a live artifact from test mode, fork it into a test repo.

A registry source without a version resolves `latest`, the newest version that its publisher has not yanked or deleted. A source that names a version exactly resolves it even when yanked. `describe` returns the resolved `version_id` and `version`, plus `yanked`, `yanked_message` and `deprecated_message`; `extract` returns the same in `metadata` as `artifact_version_id`, `artifact_version`, `artifact_yanked`, `artifact_yanked_message` and `artifact_deprecated_message`. When `yanked` is `true` or `deprecated_message` is set, tell the user and suggest a newer version. A deleted version fails with `Gone (version_deleted)`; a retry will not bring it back.

OAuth and API-key connections get the same platform tools. Each call needs the permission in the tables below: an API key must hold it, and an OAuth connection must be granted it for the call's mode.

A billed tool fails with an insufficient-balance error when the organization's balance is empty.

Every tool carries MCP annotations: `readOnlyHint` for reads, and `destructiveHint` for `void_envelope` and `refund_payment`, which cannot be undone. On an OAuth connection those two ask the person to confirm (MCP elicitation) before they run; the agent cannot answer for them. A client that cannot ask gets `CONFIRMATION_REQUIRED` and the person does it in the console; a person who declines gets `CONFIRMATION_DECLINED` and nothing changes. An API-key connection runs them without asking: the key's own permission is the decision.

`extract`, `prefill`, `seal`, `extract_job_submit`, `create_envelope` and `create_payment` take an optional `idempotency_key` (1-255 characters). To retry a call that failed or timed out, send the same key with the same arguments: the API does not run or bill it again and returns the first result, with two exceptions. A `seal` result over 1 MB is not kept, so its retry is refused with a 409 (`idempotency_uncacheable`); do not retry it. A `create_envelope` retry returns the envelope with every `signing_url` set to `null`; the signers get their links by email. A key reused with different arguments is refused with a 409 conflict (`idempotency_payload_mismatch` for the execution and e-signature tools), so use a new key for a new call. The text of a 409 error names its cause in parentheses, for example `Conflict (idempotency_payload_mismatch): …`. Execution tools (`extract`, `prefill`, `seal`) remember a key for 24 hours; `extract_job_submit`, `create_envelope` and `create_payment` remember it for the life of the job, envelope or payment. Without a key, each call is a new operation. A test-mode call and a live-mode call never share a result, even with the same key.

### Execution

Every execution tool needs `execution:run`. Reading a stored extraction result with `extract_job_get` or `extract_job_list` also needs `execution-content:read`.

| Tool | Arguments | Cost | Does |
|------|-----------|------|------|
| `describe` | `artifact` | Free | Fields, parties and annexes with types, plus a sample payload to pass as `data` to `fill`, `render`, `seal` or `create_envelope`. Call it first. |
| `fill` | `artifact`, `data?` (a form: `{ fields, parties, annexes }`; a checklist: `{ items }`), `options?: { include_optional?, required_first? }` | Per call | Validates the supplied values and returns `{ artifact_kind, accepted, complete, errors?, values?, state? }`: `accepted` for the patch, `complete` for full readiness, and the fill state with the next target to ask about. Rejected values (`accepted: false`) are a normal result. Takes only the current `$schema` ([schemas.md § Loading rules](./schemas.md#loading-rules)). |
| `extract` | `artifact`, `document: { content_base64, mime_type }`, `options?: { confidence_threshold?, validate_extracted? }`, `idempotency_key?` | Per page | Reads a filled PDF or image (PNG, JPEG, WebP; 5 pages and 10 MB max, no data-URI prefix). Returns values with confidence and page provenance. Works on scanned and flattened documents. |
| `prefill` | `artifact`, `document`, `options?: { confidence_threshold?, include_optional?, required_first? }`, `idempotency_key?` | Extract + fill | Extracts and commits readings above the threshold into a fill. Lower readings come back as suggestions. 5 pages and 10 MB max. |
| `seal` | `artifact`, `data`, `layer?`, `signers?`, `signatories?`, `idempotency_key?` | Per call | Fills the form and returns the canonical PDF, the signature map and `canonical_pdf_hash`. Creates no envelope. See [sealing.md](./sealing.md). |
| `extract_job_submit` | `artifact`, `document` (about 18.75 MB, 100 pages max), `options?`, `idempotency_key?` | Per page, on success | Starts async extraction and returns a job id. |
| `extract_job_get` | `job_id` | Free | Job status, and the `extract` result when complete. |
| `extract_job_list` | `limit?` (1-100), `offset?` | Free | The organization's jobs, newest first. |

### E-signature

| Tool | Arguments | Permission | Cost | Does |
|------|-----------|------------|------|------|
| `create_envelope` | `artifact`, `data`, `signers: [{ email, name, client_user_id?, routing_order? }]` (1-20), `title?`, `message?`, `external_id?`, `client_user_id?`, `signer_access_days?` (1-3650), `retention_days?` (30 or more, or `null` to keep forever), `expires_in_days?` (1-365), `reminder_frequency_days?` (1-30), `idempotency_key?` | `esign:manage` | Per call | Seals the artifact and sends signing invitations. Returns the envelope id and each signer's signing URL; a retry with the same `idempotency_key` returns `signing_url: null`. Omitted `signer_access_days` and `retention_days` take the organization defaults. Omitted `expires_in_days` means no expiry; omitted `reminder_frequency_days` means no reminders. Data with a missing required field or a failed rule is refused (422) before anything is sent. |
| `get_envelope` | `envelope_id` | `esign:read` | Free | Status and per-signer state. |
| `list_envelopes` | `status?` (`draft`, `pending`, `in_progress`, `completed`, `declined`, `voided`, `expired`), `client_user_id?`, `limit?` (1-100), `offset?` | `esign:read` | Free | Envelopes, newest first. |
| `download_envelope` | `envelope_id` | `esign-content:read` | Free | Links to the signed document and completion certificate, once completed. |
| `void_envelope` | `envelope_id`, `reason` (1-500 characters) | `esign:manage` | Free | Voids an in-progress envelope and notifies signers. |
| `remind_envelope` | `envelope_id` | `esign:manage` | Free | Emails each signer whose turn to sign has come and who has not signed. On a sequential envelope, later signers are not reminded. |
| `envelope_audit` | `envelope_id` | `esign-content:read` | Free | Every lifecycle event with actor, timestamp and a tamper-evident hash. |

### Payments

| Tool | Arguments | Permission | Does |
|------|-----------|------------|------|
| `connect_get_status` | none | `payment:read` | Stripe Connect status. `ready` must be `true` before `create_payment`. Onboarding is done by a person on the Payments page of the Asterdoc console. |
| `create_payment` | Either `amount_cents` + `currency`, or `artifact` + `data` (the amount comes from the party `payment` in the form). Always `success_url`, `cancel_url`. Optional `connected_account_id` (defaults to the organization's default account), `description`, `external_id`, `client_user_id`, `payer_client_user_id`, `idempotency_key`. | `payment:charge` | Creates a hosted checkout. Returns `checkout_url`. |
| `get_payment` | `payment_id` | `payment:read` | One payment. |
| `list_payments` | `status?` (`pending`, `succeeded`, `failed`, `partially_refunded`, `refunded`), `created_after?`, `created_before?` (ISO 8601), `q?` (description text), `min_amount_cents?`, `max_amount_cents?`, `connected_account_id?`, `client_user_id?`, `limit?` (1-100), `offset?` | `payment:read` | Payments, newest first. |
| `refund_payment` | `payment_id` | `payment:refund` | Refunds the remaining amount of a `succeeded` or `partially_refunded` payment. A payment already refunded in full is rejected; read its state with `get_payment`. |

A `402` from `create_payment` names its cause: no connected Stripe account (start onboarding), an account that is not payout-enabled (finish onboarding), or, for a billed operation, an empty balance (top up).

## Account tools

These read the session's organization. They change nothing. Amounts are in cents.

| Tool | Arguments | Permission | Returns |
|------|-----------|------------|---------|
| `get_organization` | none | `org:read` | `id`, `slug`, `name`, `type`. The slug is the org part of your own coordinates. |
| `get_credits_balance` | none | `usage:read` | The prepaid balance, debt, low-balance alert threshold and auto-recharge settings. |
| `get_usage_summary` | none | `usage:read` | Calls, spend and the included allowance for the current billing period. |
| `list_credit_transactions` | `limit?` (1-100) | `usage:read` | Top-ups, charges and refunds, newest first, each with the balance after it. |
| `list_webhooks` | `limit?` (1-100), `offset?`, `include_disabled?`, `event?` | `webhook:read` | Webhook endpoints in the call's mode. Secrets are masked. |
| `get_webhook` | `webhook_id` | `webhook:read` | One webhook endpoint. |

Members, API keys, plans and webhook changes are managed in the console.

## Limits

| Limit | Value |
|-------|-------|
| Rate limit per credential | 60 requests to `/mcp` (`POST`, `GET` and `DELETE`) per 60 seconds per API key or OAuth connection |
| Rate limit per client IP | 600 requests to `/mcp` per 60 seconds, across all credentials from that IP |
| `extract`, `prefill` document | 5 pages and 10 MB. Longer or larger documents: `extract_job_submit` (about 18.75 MB, 100 pages). |
| Request body | One JSON-RPC message per `POST`, 4 MB max. A batch gets `400`; a larger body gets `413`. |

The session handshake counts against the rate limit. A `GET` that opens the server-to-client stream counts once, when it opens; an open stream is not cut off. A normal handshake and `tools/list` leave room for an active fill loop within the 60-request window. Request 61 with the same credential gets `429`; wait for the 60-second window to reset. Other credentials behind the same IP keep their own budget. For larger workloads, use the npm tools ([ai-tools.md](./ai-tools.md)), the SDK ([sdk.md](./sdk.md)) or the CLI ([cli.md](./cli.md)) locally.

Every tool signals a failed call the same way: the result has `isError: true` and its text is the error message. A result without `isError` is the tool's answer, which can still report a validation outcome (`valid: false`, `accepted: false`, `success: false` with `errors` or `validation_issues`).
