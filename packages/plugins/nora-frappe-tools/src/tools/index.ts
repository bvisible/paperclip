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

// CRUD — Wave 1 (3 reads) + Wave 5 (4 writes)
import { frappeDocumentList } from "./crud/document-list.js";
import { frappeDocumentCount } from "./crud/document-count.js";
import { frappeDocumentGet } from "./crud/document-get.js";
import { frappeDocumentUpdate } from "./crud/document-update.js";
import { frappeDocumentSubmit } from "./crud/document-submit.js";
import { frappeDocumentCancel } from "./crud/document-cancel.js";
import { frappeDocumentDelete } from "./crud/document-delete.js";

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

// Scheduling — Wave 2 (5)
import { frappeReminderCreate } from "./scheduling/reminder-create.js";
import { frappeAutomationList } from "./scheduling/automation-list.js";
import { frappeAutomationCreate } from "./scheduling/automation-create.js";
import { frappeAutomationUpdate } from "./scheduling/automation-update.js";
import { frappeAutomationDelete } from "./scheduling/automation-delete.js";

// Metadata — Wave 3 (3)
import { frappeDoctypeInfo } from "./metadata/doctype-info.js";
import { frappeFieldInfo } from "./metadata/field-info.js";
import { frappePermissions } from "./metadata/permissions.js";

// Workflow — Wave 3 (2)
import { frappeWorkflowAction } from "./workflow/workflow-action.js";
import { frappeWorkflowStatus } from "./workflow/workflow-status.js";

// Reports — Wave 3 (2)
import { frappeReportList } from "./reports/report-list.js";
import { frappeReportRun } from "./reports/report-run.js";

// Files — Wave 5 (1) — multipart upload
import { frappeFileUpload } from "./files/file-upload.js";

// Accounting — Wave 5 (3) — payment entry + bank rec + tax filing
import { frappePaymentEntryCreate } from "./accounting/payment-entry-create.js";
import { frappeBankReconciliation } from "./accounting/bank-reconciliation.js";
import { noraTaxFiling } from "./accounting/tax-filing.js";

// HR — Wave 5 (2) — leave + payroll
import { frappeLeaveApply } from "./hr/leave-apply.js";
import { noraPayrollRun } from "./hr/payroll-run.js";

// Drive — Wave 5 (2) — search + upload
import { noraDriveSearch } from "./drive/drive-search.js";
import { noraDriveUpload } from "./drive/drive-upload.js";

// OCR — Wave 5 (1) + Wave 5.5 (2) — trigger + DS get + sync flow
import { noraOcrProcess } from "./ocr/ocr-process.js";
import { noraDocumentScanGet } from "./ocr/document-scan-get.js";
import { noraOcrAndSuggest } from "./ocr/ocr-and-suggest.js";

// Work items — Wave 4 (5) — Paperclip issues backed
import { noraWorkItemCreate } from "./workitems/workitem-create.js";
import { noraWorkItemCheckout } from "./workitems/workitem-checkout.js";
import { noraWorkItemComplete } from "./workitems/workitem-complete.js";
import { noraWorkItemComment } from "./workitems/workitem-comment.js";
import { noraWorkItemRequestApproval } from "./workitems/workitem-request-approval.js";

export const ALL_TOOLS: RegisteredToolEntry[] = [
  // Wave 1 smart
  frappeCustomerCreate,
  frappeSupplierCreate,
  frappeSalesInvoiceCreate,
  // Wave 2 smart
  frappeQuotationCreate,
  frappePurchaseOrderCreate,
  frappeTransformDocument,
  // Wave 1 CRUD reads
  frappeDocumentList,
  frappeDocumentCount,
  frappeDocumentGet,
  // Wave 5 CRUD writes
  frappeDocumentUpdate,
  frappeDocumentSubmit,
  frappeDocumentCancel,
  frappeDocumentDelete,
  // Wave 5 files (multipart upload)
  frappeFileUpload,
  // Wave 5 accounting smart ops
  frappePaymentEntryCreate,
  frappeBankReconciliation,
  noraTaxFiling,
  // Wave 5 HR smart ops
  frappeLeaveApply,
  noraPayrollRun,
  // Wave 5 Drive
  noraDriveSearch,
  noraDriveUpload,
  // Wave 5 OCR + Wave 5.5 enrichment
  noraOcrProcess,
  noraDocumentScanGet,
  noraOcrAndSuggest,
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
  // Wave 2 scheduling
  frappeReminderCreate,
  frappeAutomationList,
  frappeAutomationCreate,
  frappeAutomationUpdate,
  frappeAutomationDelete,
  // Wave 3 metadata
  frappeDoctypeInfo,
  frappeFieldInfo,
  frappePermissions,
  // Wave 3 workflow
  frappeWorkflowAction,
  frappeWorkflowStatus,
  // Wave 3 reports
  frappeReportList,
  frappeReportRun,
  // Wave 4 work items (Paperclip issues)
  noraWorkItemCreate,
  noraWorkItemCheckout,
  noraWorkItemComplete,
  noraWorkItemComment,
  noraWorkItemRequestApproval,
];

export type { RegisteredToolEntry } from "./types.js";
