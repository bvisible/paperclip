import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  query: z.string().optional(),
  folder: z.string().optional(),
  mime_type: z.string().optional(),
  owner: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

interface DriveItem {
  name: string;
  title?: string;
  mime_type?: string;
  parent?: string;
  is_group?: number;
  modified?: string;
  owner?: string;
  file_size?: number;
}

interface DriveSearchResponse {
  success?: boolean;
  items?: DriveItem[];
  count?: number;
  error?: string;
}

export const noraDriveSearch: RegisteredToolEntry = {
  name: "noraDriveSearch",
  declaration: {
    displayName: "Search Drive",
    description:
      "Search files and folders in Neoffice Drive. Filter by name (LIKE), folder, MIME " +
      "type, or owner. Returns metadata only (filename, size, modified date, parent folder). " +
      "Use frappeFileUpload to add a new file, or frappeDocumentGet on 'Drive File' for full content.",
    parametersSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Filename or title (LIKE match)." },
        folder: { type: "string", description: "Filter to one Drive Folder docname." },
        mime_type: { type: "string", description: "MIME type filter (e.g. 'application/pdf')." },
        owner: { type: "string", description: "Owner user id." },
        limit: { type: "number", description: "Max items (default 20, max 100)." },
      },
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const filters: Record<string, unknown> = {};
    if (input.query) filters.title = ["like", `%${input.query}%`];
    if (input.folder) filters.parent_drive_entity = input.folder;
    if (input.mime_type) filters.mime_type = input.mime_type;
    if (input.owner) filters.owner = input.owner;

    const body = {
      doctype: "Drive File",
      filters: JSON.stringify(filters),
      fields: JSON.stringify(["name", "title", "mime_type", "parent_drive_entity as parent", "is_group", "modified", "owner", "file_size"]),
      limit: input.limit ?? 20,
    };
    const res = await frappeFetch<DriveSearchResponse | DriveItem[]>(
      config,
      "nora.api.frappe_tools_whitelist.list_documents",
      body,
    );

    let items: DriveItem[];
    if (Array.isArray(res)) {
      items = res;
    } else if (res && Array.isArray((res as DriveSearchResponse).items)) {
      items = (res as DriveSearchResponse).items as DriveItem[];
    } else if (res && (res as DriveSearchResponse).success === false) {
      return { error: (res as DriveSearchResponse).error || "Drive search failed" };
    } else {
      items = [];
    }

    return {
      content: `${items.length} fichier(s)/dossier(s) Drive trouvé(s).`,
      data: { items, count: items.length },
    };
  },
};
