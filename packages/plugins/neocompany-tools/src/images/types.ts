/**
 * Generated-image types — images created by AI providers, stored as
 * company-scoped plugin entities. A template can be applied before saving
 * to produce a composited final image.
 */

export const IMAGE_ENTITY_TYPE = "generated_image";

export type ImageProvider = "openai" | "gemini" | "codex-cli";

export type ImageStatus = "pending" | "approved" | "rejected";

export type ImageSource = "generated" | "upload";

export interface GeneratedImageData {
  /** Prompt used for the generation (plain text, empty for uploads). */
  prompt: string;
  /** Provider that produced the base image (undefined for uploads). */
  provider?: ImageProvider;
  /** Origin of the image — AI-generated or user-uploaded. Defaults to
   *  "generated" when absent for backward compatibility with existing rows. */
  source?: ImageSource;
  /** User-editable tags for filtering / agent targeting. */
  tags?: string[];
  /** Raw generated image (before template composite), as a data URL. */
  rawImageUrl: string;
  /**
   * Final image after optional template composite, as a data URL. If no
   * template was applied, this is identical to `rawImageUrl`.
   */
  finalImageUrl: string;
  /** Optional template externalId that was composited on top. */
  templateId?: string;
  /** Dimensions (pixels). */
  width: number;
  height: number;
  /** Approval status — drives stock visibility in the UI. */
  status: ImageStatus;
  /** Batch id grouping images generated together (for review). */
  batchId?: string;
  /** Feedback notes left by the reviewer. */
  feedback?: string;
  /** ISO-8601 timestamp — when the image was generated or uploaded. */
  createdAt: string;
}
