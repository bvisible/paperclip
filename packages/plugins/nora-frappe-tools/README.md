# @paperclipai/plugin-nora-frappe-tools

Typed Paperclip plugin exposing Neoffice/Frappe ERP operations to NORA agents.
Replaces the Python `execute_code` wrapper (with its JSON-escaping hell) by
direct typed tool calls like `frappeCustomerCreate({ customer_name: "X" })`.

## Wave 1 (MVP) — 8 tools

| Tool | Endpoint (Frappe method) | Use case |
|------|--------------------------|----------|
| `frappeCustomerCreate` | `nora.api.frappe_tools_whitelist.frappe_customer_create` | Create Customer + Contact + Address, idempotent |
| `frappeSupplierCreate` | `frappe_supplier_create` | Create Supplier |
| `frappeSalesInvoiceCreate` | `frappe_sales_invoice_create` | Create Draft Sales Invoice with smart defaults |
| `frappeDocumentList` | `list_documents` | List with filters + selected fields |
| `frappeDocumentCount` | `count_documents` | Count matching documents |
| `frappeDocumentGet` | `get_document` | Fetch full document by docname |
| `frappeSearchGlobal` | `search_documents` | Full-text search across DocTypes |
| `frappeSqlQuery` | `run_database_query` | Read-only SQL (SUM/COUNT/GROUP BY) |

Waves 2 & 3 extend to ~54 tools (CRUD complete, smart ops, metadata, reports,
workflow, email, dashboards, accounting) — see Obsidian
`NORA/13-sub-agents-hygiene-roadmap/05-nora-frappe-tools-plugin.md`.

## Configuration

Credentials are resolved per call in this priority order (see `src/context.ts`):

1. **Company state** (per-tenant overrides):
   - `nora:frappe:url`
   - `nora:frappe:siteName`
   - `nora:frappe:apiKey`
   - `nora:frappe:apiSecretRef` (points to a platform secret)

2. **Instance config** (platform default, set via admin UI):
   - `frappeUrlDefault`
   - `frappeSiteNameDefault`
   - `frappeApiKeyDefault`
   - `frappeApiSecretDefault`

3. **Process environment** (dev convenience):
   - `FRAPPE_URL`
   - `FRAPPE_SITE_NAME`
   - `FRAPPE_API_KEY`
   - `FRAPPE_API_SECRET`

## Auth

Every request uses Frappe's token auth:
```
Authorization: token <api_key>:<api_secret>
```

The API key is bound to a Frappe User; permissions are enforced server-side.
The plugin never caches credentials — `ctx.secrets.resolve()` is called per tool invocation.

## Development

```bash
cd packages/plugins/nora-frappe-tools
pnpm install
pnpm build
```

## Adding a tool (process)

1. Create `src/tools/<category>/<tool-name>.ts` following the pattern of
   `src/tools/smart/customer-create.ts`.
2. Export a `RegisteredToolEntry`.
3. Import + add to `ALL_TOOLS` in `src/tools/index.ts`.
4. Rebuild and test via the Paperclip gateway.

## References

- Plan: Obsidian `NORA/13-sub-agents-hygiene-roadmap/05-nora-frappe-tools-plugin.md`
- NORA Python source to port: `/Users/jeremy/GitHub/nora/nora/api/frappe_tools_whitelist.py`
- Smart ops source: `/Users/jeremy/GitHub/nora/nora/code_executor/bridge/smart_operations.py`
- Reference pattern: `@paperclipai/plugin-neocompany-tools`
