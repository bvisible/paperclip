// Tool barrel — single source of truth for manifest + worker registration.
//
// Wave 1 (MVP, 2026-04-24): 8 tools to unblock the E2E regression suite.
// Wave 2 (2026-04-25): +8 tools for analytics, document chain, email.
// Wave 3 (next): metadata/reports/workflow/dashboards/OCR.
// Plan: Obsidian NORA/13-sub-agents-hygiene-roadmap/05-nora-frappe-tools-plugin.md

import type { RegisteredToolEntry } from "./types.js";

// Smart ops — Wave 1 (3) + Wave 2 (3)
import { frappeCustomerCreate } from "./smart/customer-create.js";
import { frappeSupplierCreate } from "./smart/supplier-create.js";
import { frappeSalesInvoiceCreate } from "./smart/sales-invoice-create.js";
import { frappeQuotationCreate } from "./smart/quotation-create.js";
import { frappePurchaseOrderCreate } from "./smart/purchase-order-create.js";
import { frappeTransformDocument } from "./smart/transform-document.js";

// CRUD — Wave 1 (3 of 6)
import { frappeDocumentList } from "./crud/document-list.js";
import { frappeDocumentCount } from "./crud/document-count.js";
import { frappeDocumentGet } from "./crud/document-get.js";

// Search — Wave 1 (1 of 3)
import { frappeSearchGlobal } from "./search/search-global.js";

// SQL / metadata — Wave 1 (1)
import { frappeSqlQuery } from "./metadata/sql-query.js";

// Analytics — Wave 2 (3)
import { frappeRevenueSummary } from "./analytics/revenue-summary.js";
import { frappeOutstandingReceivables } from "./analytics/outstanding-receivables.js";
import { frappeOutstandingPayables } from "./analytics/outstanding-payables.js";

// Email — Wave 2 (2)
import { frappeEmailDraft } from "./email/email-draft.js";
import { frappeEmailConfirm } from "./email/email-confirm.js";

export const ALL_TOOLS: RegisteredToolEntry[] = [
  // Wave 1 smart
  frappeCustomerCreate,
  frappeSupplierCreate,
  frappeSalesInvoiceCreate,
  // Wave 2 smart
  frappeQuotationCreate,
  frappePurchaseOrderCreate,
  frappeTransformDocument,
  // Wave 1 CRUD
  frappeDocumentList,
  frappeDocumentCount,
  frappeDocumentGet,
  // Wave 1 search + SQL
  frappeSearchGlobal,
  frappeSqlQuery,
  // Wave 2 analytics
  frappeRevenueSummary,
  frappeOutstandingReceivables,
  frappeOutstandingPayables,
  // Wave 2 email
  frappeEmailDraft,
  frappeEmailConfirm,
];

export type { RegisteredToolEntry } from "./types.js";
