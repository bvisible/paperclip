-- plugin-nora-memory — migration 001
--
-- Schema name is the host-derived plugin namespace:
--   plugin_<slug>_<sha256(pluginId)[:10]>
--   slug      = "nora_memory"  (manifest.database.namespaceSlug)
--   pluginId  = "paperclipai.plugin-nora-memory"
--   namespace = plugin_nora_memory_bdc0493c33
--
-- The host creates the schema before applying this migration. Object names
-- must be fully qualified (plugin migration validator requirement).
--
-- PREREQUISITE: the `vector` extension (pgvector) must already exist in the
-- `paperclip` database. `CREATE EXTENSION` is BANNED inside plugin migrations,
-- so it is run separately by the devops script `enable-pgvector.sh` before
-- this plugin is installed.

CREATE TABLE plugin_nora_memory_bdc0493c33.memory_units (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_id       text NOT NULL,
  content       text NOT NULL,
  embedding     vector(1024),
  fact_type     text NOT NULL DEFAULT 'experience',
  tags          text[] NOT NULL DEFAULT '{}',
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_id   text,
  proof_count   integer NOT NULL DEFAULT 1,
  consolidated  boolean NOT NULL DEFAULT false,
  superseded_by uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  accessed_at   timestamptz,
  access_count  integer NOT NULL DEFAULT 0
);

-- HNSW index for fast approximate cosine-similarity recall.
CREATE INDEX memory_units_embedding_hnsw
  ON plugin_nora_memory_bdc0493c33.memory_units
  USING hnsw (embedding vector_cosine_ops);

-- Btree for bank-scoped filtered scans (list, Dream window selection).
CREATE INDEX memory_units_bank_type_created
  ON plugin_nora_memory_bdc0493c33.memory_units (bank_id, fact_type, created_at);

-- Partial index: recall only ever scans live (non-superseded) memories.
CREATE INDEX memory_units_bank_live
  ON plugin_nora_memory_bdc0493c33.memory_units (bank_id)
  WHERE superseded_by IS NULL;

-- Dedup / reinforcement lookup by document_id.
CREATE INDEX memory_units_company_document
  ON plugin_nora_memory_bdc0493c33.memory_units (company_id, document_id)
  WHERE document_id IS NOT NULL;
