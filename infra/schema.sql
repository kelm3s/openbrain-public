-- OpenBrain Aurora PostgreSQL Schema
-- Run this after enabling the pgvector extension on your Aurora cluster
-- Aurora Serverless v2, us-east-1, Data API enabled

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Main thoughts table
CREATE TABLE thoughts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  content     TEXT        NOT NULL,
  embedding   vector(1024),           -- Bedrock Titan Embed v2 dimensions (max 1024; v2 supports 256/512/1024)
  source      VARCHAR(50) DEFAULT 'manual',  -- 'manual', 'claude-code', 'loop', etc.
  tags        TEXT[],                 -- optional tags for filtering
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- HNSW index for fast cosine similarity search
-- Must be created AFTER table exists, BEFORE inserting large amounts of data
CREATE INDEX ON thoughts
  USING hnsw (embedding vector_cosine_ops);

-- Optional: index for source filtering
CREATE INDEX ON thoughts (source);

-- Optional: index for recency queries
CREATE INDEX ON thoughts (created_at DESC);

-- Verify setup
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
SELECT COUNT(*) FROM thoughts;
