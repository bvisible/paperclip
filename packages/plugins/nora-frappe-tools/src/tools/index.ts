// Tool barrel — single source of truth for manifest + worker registration.
//
// Wave 1 (MVP): 8 tools that unblock the E2E regression suite.
// Wave 2 (next session): +13 smart ops + metadata/reports/workflow.
// Wave 3: completion to ~54 tools, then SOUL refactor.
// Plan: Obsidian NORA/13-sub-agents-hygiene-roadmap/05-nora-frappe-tools-plugin.md

import type { RegisteredToolEntry } from "./types.js";

// Smart ops (3)
import { frappeCustomerCreate } from "./smart/customer-create.js";
import { frappeSupplierCreate } from "./smart/supplier-create.js";
import { frappeSalesInvoiceCreate } from "./smart/sales-invoice-create.js";

// CRUD (3 of 6)
import { frappeDocumentList } from "./crud/document-list.js";
import { frappeDocumentCount } from "./crud/document-count.js";
import { frappeDocumentGet } from "./crud/document-get.js";

// Search (1 of 3)
import { frappeSearchGlobal } from "./search/search-global.js";

// SQL / metadata (1)
import { frappeSqlQuery } from "./metadata/sql-query.js";

export const ALL_TOOLS: RegisteredToolEntry[] = [
  frappeCustomerCreate,
  frappeSupplierCreate,
  frappeSalesInvoiceCreate,
  frappeDocumentList,
  frappeDocumentCount,
  frappeDocumentGet,
  frappeSearchGlobal,
  frappeSqlQuery,
];

export type { RegisteredToolEntry } from "./types.js";
