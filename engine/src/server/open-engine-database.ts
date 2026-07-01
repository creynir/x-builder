import { chmodSync } from "node:fs";

import Database from "better-sqlite3";

import { generatedReplyContentHash } from "../generated-replies/normalize-generated-reply.js";
import { PostLibraryStorageError } from "./post-library-repository.js";

type DatabaseHandle = Database.Database;

const memoryPath = ":memory:";

const migration1Ddl = `
CREATE TABLE post (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'x',
  platform_post_id TEXT NOT NULL,
  logical_post_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  language TEXT,
  in_reply_to_post_id TEXT,
  in_reply_to_user_id TEXT,
  has_urls INTEGER NOT NULL,
  has_media INTEGER NOT NULL,
  has_hashtags INTEGER NOT NULL,
  has_mentions INTEGER NOT NULL,
  weak_favorite_count INTEGER,
  weak_retweet_count INTEGER,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_post_platform_post_id ON post(platform_post_id);
CREATE INDEX idx_post_kind ON post(kind);
CREATE INDEX idx_post_logical ON post(logical_post_id);
CREATE INDEX idx_post_created_at ON post(created_at);

CREATE TABLE metric_obs (
  tweet_id TEXT NOT NULL REFERENCES post(platform_post_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT '',
  impressions INTEGER,
  likes INTEGER,
  reposts INTEGER,
  replies INTEGER,
  quotes INTEGER,
  bookmarks INTEGER,
  favorite_count INTEGER,
  retweet_count INTEGER,
  content_hash TEXT NOT NULL,
  PRIMARY KEY (tweet_id, source, observed_at, imported_at)
);
CREATE INDEX idx_metric_obs_tweet ON metric_obs(tweet_id, observed_at);

CREATE TABLE source_ref (
  post_id TEXT NOT NULL REFERENCES post(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  import_run_id TEXT NOT NULL DEFAULT '',
  source_hash TEXT NOT NULL DEFAULT '',
  capture_session_id TEXT NOT NULL DEFAULT '',
  raw_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (post_id, source, import_run_id, source_hash, capture_session_id, raw_id)
);

CREATE TABLE profile_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_user_id TEXT NOT NULL,
  screen_name TEXT NOT NULL,
  followers INTEGER,
  captured_at TEXT NOT NULL
);
CREATE INDEX idx_profile_snapshot_user ON profile_snapshot(platform_user_id, captured_at);

CREATE TABLE import_run (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);

CREATE TABLE derived_insight (
  import_run_id TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE active_context (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  payload TEXT NOT NULL
);
`;

const migration2Ddl = `
CREATE TABLE feedback_prediction (
  id TEXT PRIMARY KEY,
  client_event_id TEXT UNIQUE,
  action TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'x' CHECK (platform = 'x'),
  content_hash TEXT NOT NULL,
  text TEXT NOT NULL,
  detected_format_snapshot TEXT NOT NULL,
  source_format TEXT,
  score_value REAL NOT NULL,
  predicted_mid_impressions INTEGER NOT NULL,
  stall_low INTEGER NOT NULL,
  stall_high INTEGER NOT NULL,
  escape_low INTEGER NOT NULL,
  escape_high INTEGER NOT NULL,
  escape_probability REAL NOT NULL,
  expected_replies REAL NOT NULL,
  base_impressions INTEGER NOT NULL,
  base_source TEXT NOT NULL,
  quality_basis TEXT NOT NULL,
  reach_model_version TEXT NOT NULL,
  prediction_signals_json TEXT NOT NULL,
  scoring_context_json TEXT NOT NULL,
  analyzer_version TEXT NOT NULL,
  analyzed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE feedback_prediction_link (
  prediction_id TEXT PRIMARY KEY REFERENCES feedback_prediction(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'x' CHECK (platform = 'x'),
  platform_post_id TEXT NOT NULL,
  method TEXT NOT NULL,
  linked_at TEXT NOT NULL
);

CREATE INDEX idx_feedback_prediction_hash ON feedback_prediction(content_hash);
CREATE INDEX idx_feedback_prediction_created ON feedback_prediction(created_at);
CREATE INDEX idx_feedback_prediction_format ON feedback_prediction(detected_format_snapshot, created_at);
CREATE INDEX idx_feedback_link_post ON feedback_prediction_link(platform_post_id);
`;


const migration3Ddl = `
CREATE TABLE external_x_signal_source (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'x' CHECK (platform = 'x'),
  screen_name TEXT NOT NULL,
  display_name TEXT,
  platform_user_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_observed_at TEXT
);
CREATE UNIQUE INDEX idx_external_x_signal_source_screen_name ON external_x_signal_source(screen_name);
CREATE INDEX idx_external_x_signal_source_status ON external_x_signal_source(status, updated_at);

CREATE TABLE external_x_signal_evidence (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES external_x_signal_source(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'x' CHECK (platform = 'x'),
  platform_post_id TEXT NOT NULL,
  screen_name TEXT NOT NULL,
  text TEXT NOT NULL,
  preview_text TEXT,
  created_at TEXT,
  kind TEXT NOT NULL,
  language TEXT,
  in_reply_to_post_id TEXT,
  in_reply_to_user_id TEXT,
  has_urls INTEGER NOT NULL,
  has_media INTEGER NOT NULL,
  has_hashtags INTEGER NOT NULL,
  has_mentions INTEGER NOT NULL,
  metrics_json TEXT NOT NULL,
  evidence_source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  imported_at TEXT,
  content_hash TEXT,
  raw_id TEXT,
  source_hash TEXT,
  capture_session_id TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_external_x_signal_evidence_identity ON external_x_signal_evidence(source_id, platform_post_id, evidence_source, observed_at);
CREATE INDEX idx_external_x_signal_evidence_source_time ON external_x_signal_evidence(source_id, observed_at);
CREATE INDEX idx_external_x_signal_evidence_post ON external_x_signal_evidence(platform_post_id);

CREATE TABLE external_x_signal_refresh_run (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES external_x_signal_source(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  message TEXT
);
CREATE INDEX idx_external_x_signal_refresh_source_time ON external_x_signal_refresh_run(source_id, started_at);

CREATE TABLE external_x_signal_pattern (
  id TEXT PRIMARY KEY,
  pattern_type TEXT NOT NULL,
  label TEXT NOT NULL,
  statement TEXT NOT NULL,
  confidence REAL NOT NULL,
  support_count INTEGER NOT NULL,
  generated_at TEXT NOT NULL,
  version TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX idx_external_x_signal_pattern_generated ON external_x_signal_pattern(generated_at);
CREATE INDEX idx_external_x_signal_pattern_type ON external_x_signal_pattern(pattern_type, confidence);

CREATE TABLE external_x_signal_pattern_evidence (
  pattern_id TEXT NOT NULL REFERENCES external_x_signal_pattern(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES external_x_signal_evidence(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  PRIMARY KEY (pattern_id, evidence_id, role)
);
CREATE INDEX idx_external_x_signal_pattern_evidence_evidence ON external_x_signal_pattern_evidence(evidence_id);
`;

const migration4Ddl = `
CREATE TABLE voice_index_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  embedder_id TEXT NOT NULL,
  embedder_version TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  distance_metric TEXT NOT NULL CHECK (distance_metric IN ('cosine')),
  updated_at TEXT NOT NULL,
  last_successful_index_at TEXT,
  last_error_at TEXT,
  last_error TEXT
);

CREATE TABLE voice_post_embedding (
  post_id TEXT PRIMARY KEY REFERENCES post(id) ON DELETE CASCADE,
  platform_post_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  post_updated_at TEXT NOT NULL,
  embedder_id TEXT NOT NULL,
  embedder_version TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_blob BLOB NOT NULL,
  indexed_at TEXT NOT NULL
);
CREATE INDEX idx_voice_post_embedding_model
  ON voice_post_embedding(embedder_id, embedder_version);
CREATE INDEX idx_voice_post_embedding_content
  ON voice_post_embedding(content_hash, post_updated_at);
`;

const migration5Ddl = `
CREATE TABLE archive_voice_profile (
  profile_id TEXT PRIMARY KEY,
  rule_version TEXT NOT NULL,
  corpus_hash TEXT NOT NULL,
  source_post_count INTEGER NOT NULL,
  source_reply_count INTEGER NOT NULL,
  generated_at TEXT NOT NULL,
  model_provider TEXT NOT NULL,
  model_id TEXT,
  profile_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_archive_voice_profile_current
  ON archive_voice_profile(rule_version, corpus_hash, updated_at);

CREATE TABLE archive_voice_profile_evidence (
  profile_id TEXT NOT NULL REFERENCES archive_voice_profile(profile_id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES post(id) ON DELETE CASCADE,
  platform_post_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('original', 'reply')),
  evidence_role TEXT NOT NULL CHECK (evidence_role IN ('model_selected', 'sampled')),
  excerpt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, post_id, evidence_role)
);
CREATE INDEX idx_archive_voice_profile_evidence_post
  ON archive_voice_profile_evidence(post_id);
`;

const migration6Ddl = `
CREATE TABLE observed_thread_post (
  status_id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('same_dialog_dom', 'x_graphql_observed', 'archive_tweets_js', 'x_live_capture')),
  role TEXT CHECK (role IN ('root', 'ancestor', 'immediate_parent', 'current_target', 'previous_own_reply')),
  url TEXT,
  author_handle TEXT,
  author_display_name TEXT,
  author_user_id TEXT,
  text TEXT NOT NULL,
  created_at TEXT,
  in_reply_to_status_id TEXT,
  in_reply_to_user_id TEXT,
  conversation_id TEXT,
  weak_metrics_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_observed_thread_parent ON observed_thread_post(in_reply_to_status_id, created_at);
CREATE INDEX idx_observed_thread_conversation ON observed_thread_post(conversation_id, created_at);
CREATE INDEX idx_observed_thread_observed ON observed_thread_post(observed_at);
`;

const migration7Ddl = `
CREATE TABLE observed_thread_post_source (
  status_id TEXT NOT NULL REFERENCES observed_thread_post(status_id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('same_dialog_dom', 'x_graphql_observed', 'archive_tweets_js', 'x_live_capture')),
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (status_id, source)
);
CREATE INDEX idx_observed_thread_post_source_source ON observed_thread_post_source(source, status_id);

INSERT INTO observed_thread_post_source (
  status_id, source, first_observed_at, last_observed_at, updated_at
)
SELECT status_id, source, observed_at, observed_at, updated_at
FROM observed_thread_post;
`;

const migration8Ddl = `
CREATE TABLE generated_reply (
  id TEXT PRIMARY KEY,
  client_event_id TEXT UNIQUE NOT NULL,
  body_text TEXT NOT NULL,
  written_text TEXT NOT NULL,
  body_text_hash TEXT NOT NULL,
  written_text_hash TEXT NOT NULL,
  target_status_id TEXT,
  chosen_variant_id TEXT,
  reply_move TEXT,
  generated_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX idx_generated_reply_body_text_hash ON generated_reply(body_text_hash);
CREATE INDEX idx_generated_reply_written_text_hash ON generated_reply(written_text_hash);
CREATE INDEX idx_generated_reply_target_status_id ON generated_reply(target_status_id);
`;

const migration8PostDdl = `
ALTER TABLE post ADD COLUMN normalized_text_hash TEXT;
CREATE INDEX idx_post_normalized_text_hash ON post(normalized_text_hash);
`;

export type Migration = {
  version: number;
  up(db: DatabaseHandle): void;
};

// Ordered ascending by version. Later features append migrations without editing
// existing entries; the runner only applies migrations whose version exceeds the
// current PRAGMA user_version.
export const migrations: Migration[] = [
  {
    version: 1,
    up(db) {
      db.exec(migration1Ddl);
    },
  },
  {
    version: 2,
    up(db) {
      db.exec(migration2Ddl);
    },
  },
  {
    version: 3,
    up(db) {
      db.exec(migration3Ddl);
    },
  },
  {
    version: 4,
    up(db) {
      db.exec(migration4Ddl);
    },
  },
  {
    version: 5,
    up(db) {
      db.exec(migration5Ddl);
    },
  },
  {
    version: 6,
    up(db) {
      db.exec(migration6Ddl);
    },
  },
  {
    version: 7,
    up(db) {
      db.exec(migration7Ddl);
    },
  },
  {
    version: 8,
    up(db) {
      db.exec(migration8Ddl);

      const hasPostTable = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("post");
      if (!hasPostTable) {
        return;
      }

      db.exec(migration8PostDdl);

      const rows = db.prepare("SELECT id, text FROM post").all() as Array<{
        id: string;
        text: string;
      }>;
      const update = db.prepare("UPDATE post SET normalized_text_hash = ? WHERE id = ?");

      for (const row of rows) {
        update.run(generatedReplyContentHash(row.text), row.id);
      }
    },
  },
];

const applyMigrations = (db: DatabaseHandle): void => {
  const currentVersion = Number(db.pragma("user_version", { simple: true }));

  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue;
    }

    db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
};

export const openEngineDatabase = (dbPath: string): DatabaseHandle => {
  try {
    const db = new Database(dbPath);

    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");

    if (dbPath !== memoryPath) {
      chmodSync(dbPath, 0o600);
    }

    applyMigrations(db);

    return db;
  } catch (error) {
    if (error instanceof PostLibraryStorageError) {
      throw error;
    }

    throw new PostLibraryStorageError(
      `Failed to open engine database at ${dbPath}.`,
      error,
    );
  }
};
