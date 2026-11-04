-- Neon 전용. main 머지 후 적용한다. PGlite 테스트 마이그레이션과 분리한다 (AGENTS 8장).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS place_embeddings (
  place_id text PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
  model text NOT NULL CHECK (model = 'solar-embedding-2-passage'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  passage text NOT NULL,
  embedding vector(1024) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS place_embeddings_cosine_idx
  ON place_embeddings USING hnsw (embedding vector_cosine_ops);
