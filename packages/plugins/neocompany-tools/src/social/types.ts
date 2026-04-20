/**
 * Social publishing types — editorial strategy + social post entities.
 *
 * An `editorial_strategy` is a singleton per company (one entity with a fixed
 * externalId). A `social_post` is the atomic unit of the publishing pipeline
 * and flows through the statuses below.
 */

export const EDITORIAL_STRATEGY_ENTITY_TYPE = "editorial_strategy";
export const EDITORIAL_STRATEGY_SINGLETON_EXTERNAL_ID = "editorial-strategy";

export const SOCIAL_POST_ENTITY_TYPE = "social_post";

export type SocialProviderKey = "linkedin" | "facebook" | "instagram";

export interface EditorialStrategyChannelRef {
  provider: SocialProviderKey;
  /** Stable channel key — format `<provider>:<accountId>`. */
  channelKey: string;
  /** Human-readable account label (cached for UI display). */
  accountName?: string;
}

export interface EditorialStrategyPublishingSlot {
  /** 0 = Sunday, 1 = Monday, …, 6 = Saturday (JS getDay convention). */
  dayOfWeek: number;
  /** 0-23. */
  hour: number;
  /** 0-59. */
  minute?: number;
}

export interface EditorialStrategyData {
  /** Weekly posting target per channel key (e.g. { "linkedin:urn:…": 2 }). */
  postsPerWeek: Record<string, number>;
  /** How many weeks of drafts Pixel should keep in the pipeline. */
  leadTimeWeeks: number;
  /** How many posts awaiting user approval at any given time. */
  queueSize: number;
  /** Preferred publishing slots. */
  publishingSlots: EditorialStrategyPublishingSlot[];
  /** Free-form tone-of-voice notes for Pixel. */
  voiceGuidelines?: string;
  /** Default channels to target when Pixel generates drafts. */
  defaultChannels: EditorialStrategyChannelRef[];
  /** ISO timestamp. */
  updatedAt: string;
}

export type SocialPostStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "rejected"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";

export interface SocialPostChannel {
  provider: SocialProviderKey;
  channelKey: string;
}

export interface SocialPostData {
  /** Caption / post body. */
  text: string;
  /** externalId of a library_image (generated_image) entity in this company. */
  imageId?: string;
  /** Dimensions at which the image was composed. */
  dimensions?: { width: number; height: number };
  /** Target channel for this post. */
  channel: SocialPostChannel;
  /** ISO — suggested publishing date. May be edited before approval. */
  proposedAt: string;
  /** Current status — see SocialPostStatus. */
  status: SocialPostStatus;
  /** Reviewer note when status === "rejected". */
  rejectionFeedback?: string;
  /** ISO — populated when the post is approved and moves to scheduled. */
  scheduledAt?: string;
  /** ISO — populated on success. */
  publishedAt?: string;
  /** Provider-specific post id (URN, etc.) after publish. */
  providerPostId?: string;
  /** Last error message if status === "failed". */
  lastError?: string;
  /** Retry counter for publish attempts. */
  attempts?: number;
  /** Agent id that drafted the post (Pixel in the usual path). */
  generatedByAgentId?: string;
  /** ISO creation time. */
  createdAt: string;
}
