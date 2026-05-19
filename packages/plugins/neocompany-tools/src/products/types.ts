//// Neocompany Modification — Product catalog entity types.
//// Synced from a WooCommerce store via WC REST `/products` and
//// `/products/categories`. Stored as company-scoped plugin entities so the
//// existing `registry.listEntities` tenant filter (added 2026-05-17) takes
//// care of isolation. External ids are namespaced with `wc-` so a future
//// Shopify/Etsy connector can use `shopify-` etc. without collisions.
//// End Neocompany Modification

export const PRODUCT_ENTITY_TYPE = "product";
export const PRODUCT_CATEGORY_ENTITY_TYPE = "product_category";

export type ProductSource = "woocommerce";

/**
 * Status mirrors WP's post_status for products. We surface "publish" / "draft"
 * / "pending" / "private" verbatim, plus a "deleted" sentinel for products
 * that disappeared from the store on the last sync — we keep the row so any
 * generated_image that referenced the product can still resolve its title.
 */
export type ProductStatus = "publish" | "draft" | "pending" | "private" | "deleted";

export interface ProductData {
  /** Source connector — currently always "woocommerce". */
  source: ProductSource;
  /** WC product ID — useful for deep-linking back to wp-admin. */
  wcId: number;
  /** Public product permalink (may be null when product is draft). */
  permalink?: string;
  /** Product name as shown to shoppers. */
  name: string;
  /** URL-safe slug. */
  slug: string;
  /** Long description, HTML stripped to plain text. */
  description: string;
  /** Short description / excerpt, HTML stripped. */
  shortDescription: string;
  /** SKU when set. */
  sku?: string;
  /** Display price (raw WC string — e.g. "49.90"). */
  price?: string;
  /** Sale price when on sale. */
  salePrice?: string;
  /** Regular price. */
  regularPrice?: string;
  /** Currency code from the WC store settings (e.g. "CHF", "EUR"). */
  currency?: string;
  /** Product status — see ProductStatus comment. */
  status: ProductStatus;
  /** Category externalIds (`wc-cat-<id>`) the product belongs to. */
  categoryIds: string[];
  /** Cached category names for quick rendering without a join. */
  categoryNames: string[];
  /** Free-form WC tags. */
  tags: string[];
  /**
   * Full URLs of all product gallery images, featured image first.
   * Fed directly to imageGenerate as `-i` references when an agent picks the
   * product in the Generate dialog.
   */
  imageUrls: string[];
  /** Flat attribute map — taxonomy attributes are resolved to readable names. */
  attributes: Record<string, string>;
  /** Last WC `date_modified` ISO string — used to skip unchanged rows. */
  wcModifiedAt?: string;
  /** When the row was last synced from WC, ISO 8601. */
  syncedAt: string;
}

export interface ProductCategoryData {
  source: ProductSource;
  /** WC category ID. */
  wcId: number;
  /** Category name. */
  name: string;
  /** URL-safe slug. */
  slug: string;
  /** Parent category externalId (`wc-cat-<id>`) or null at the root. */
  parentId: string | null;
  /** Number of products in this category as of the last sync. */
  count: number;
  /** ISO 8601 sync timestamp. */
  syncedAt: string;
}

export const wcProductExternalId = (wcId: number): string => `wc-${wcId}`;
export const wcCategoryExternalId = (wcId: number): string => `wc-cat-${wcId}`;
