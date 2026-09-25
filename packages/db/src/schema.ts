import { sql } from "drizzle-orm";
import {
  bigint,

  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  CaptionStyle,
  ContextFlags,
  ExportOptions,
  LanguageStats,
  ProjectSettings,
  PublishingPackage,
  Sentence,
  Signals,
  TimeRange,
  UserDefaults,
  Word,
} from "@longcut/shared";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  defaults: jsonb("defaults").$type<Partial<UserDefaults>>().notNull().default({}),
  captionStyle: jsonb("caption_style").$type<Partial<CaptionStyle>>(),
  llmProvider: text("llm_provider"),
  sttProvider: text("stt_provider"),
  /** AES-256-GCM encrypted JSON of per-user API keys. Never sent to the browser. */
  encryptedKeys: text("encrypted_keys"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface YouTubeMeta {
  videoId: string;
  title: string;
  author?: string;
  thumbnailUrl?: string;
  duration?: number | null;
}

export interface MediaInfo {
  container?: string;
  videoCodec?: string | null;
  audioCodec?: string | null;
  audioChannels?: number | null;
  audioSampleRate?: number | null;
  bitrate?: number | null;
  hasAudio?: boolean;
  browserPlayable?: boolean;
}

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sourceType: text("source_type").$type<"upload" | "youtube">().notNull(),
    sourceUrl: text("source_url"),
    storagePath: text("storage_path"),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type"),
    fileSize: bigint("file_size", { mode: "number" }),
    uploadId: text("upload_id"),
    duration: doublePrecision("duration"),
    width: integer("width"),
    height: integer("height"),
    fps: real("fps"),
    media: jsonb("media").$type<MediaInfo>(),
    youtube: jsonb("youtube").$type<YouTubeMeta>(),
    thumbnailPath: text("thumbnail_path"),
    audioPath: text("audio_path"),
    previewPath: text("preview_path"),
    waveformPath: text("waveform_path"),
    /** Peaks per second in the waveform file. */
    waveformRate: integer("waveform_rate"),
    status: text("status").notNull().default("uploading"),
    progress: real("progress").notNull().default(0),
    statusMessage: text("status_message"),
    errorCode: text("error_code"),
    settings: jsonb("settings").$type<ProjectSettings>().notNull(),
    /** Current performance strategy used for ranking (can differ from the analysis strategy). */
    rankStrategy: text("rank_strategy").notNull().default("balanced"),
    languageStats: jsonb("language_stats").$type<LanguageStats>(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("projects_user_idx").on(t.userId, t.createdAt)],
);

export const transcripts = pgTable("transcripts", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  /** Sentences with compact word timings. */
  segments: jsonb("segments").$type<Sentence[]>().notNull(),
  language: text("language"),
  provider: text("provider"),
  wordCount: integer("word_count").notNull().default(0),
  speakerCount: integer("speaker_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-chunk transcription checkpoints so interrupted jobs resume without re-transcribing. */
export const transcriptChunks = pgTable(
  "transcript_chunks",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    start: doublePrecision("start").notNull(),
    end: doublePrecision("end").notNull(),
    provider: text("provider").notNull(),
    language: text("language"),
    words: jsonb("words").$type<Word[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.index] })],
);

export interface TopicSection {
  id: number;
  startIdx: number;
  endIdx: number;
  start: number;
  end: number;
  title: string;
  summary: string;
  kind: string;
  value: number;
  energy: number;
}

export const analyses = pgTable("analyses", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  sections: jsonb("sections").$type<TopicSection[]>().notNull(),
  overview: text("overview"),
  model: text("model"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clips = pgTable(
  "clips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    origin: text("origin").$type<"ai" | "manual">().notNull().default("ai"),
    rank: integer("rank").notNull().default(0),
    startTime: doublePrecision("start_time").notNull(),
    endTime: doublePrecision("end_time").notNull(),
    /** Output duration (end - start - cuts). */
    duration: doublePrecision("duration").notNull(),
    /** Removed ranges inside the clip, in source time. */
    cuts: jsonb("cuts").$type<TimeRange[]>().notNull().default([]),
    /** AI-proposed boundaries, kept so edits can be reset. */
    originalStart: doublePrecision("original_start"),
    originalEnd: doublePrecision("original_end"),
    score: integer("score").notNull().default(0),
    signals: jsonb("signals").$type<Signals>(),
    flags: jsonb("flags").$type<ContextFlags>(),
    title: text("title").notNull(),
    reason: text("reason"),
    summary: text("summary"),
    topics: jsonb("topics").$type<string[]>().notNull().default([]),
    hookText: text("hook_text"),
    hookStart: doublePrecision("hook_start"),
    status: text("status").notNull().default("candidate"),
    package: jsonb("package").$type<PublishingPackage>(),
    packageStatus: text("package_status").notNull().default("none"),
    captionStyle: jsonb("caption_style").$type<CaptionStyle>(),
    captionLanguage: text("caption_language"),
    frameThumbPath: text("frame_thumb_path"),
    ...timestamps,
  },
  (t) => [index("clips_project_idx").on(t.projectId, t.rank)],
);

/** Cached caption-language transforms per sentence (translation / romanization). */
export const sentenceTranslations = pgTable(
  "sentence_translations",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    sentenceIdx: integer("sentence_idx").notNull(),
    text: text("text").notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.mode, t.sentenceIdx] })],
);

export const exportsTable = pgTable(
  "exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clipId: uuid("clip_id")
      .notNull()
      .references(() => clips.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resolution: text("resolution").notNull(),
    captionMode: text("caption_mode").notNull(),
    captionLanguage: text("caption_language").notNull().default("auto"),
    format: text("format").notNull().default("mp4"),
    options: jsonb("options").$type<ExportOptions>().notNull(),
    /** Clip state captured at export time, so later edits don't change an in-flight render. */
    startTime: doublePrecision("start_time").notNull(),
    endTime: doublePrecision("end_time").notNull(),
    cuts: jsonb("cuts").$type<TimeRange[]>().notNull().default([]),
    storagePath: text("storage_path"),
    subtitlePaths: jsonb("subtitle_paths").$type<Record<string, string>>(),
    fileSize: bigint("file_size", { mode: "number" }),
    duration: doublePrecision("duration"),
    status: text("status").notNull().default("queued"),
    progress: real("progress").notNull().default(0),
    errorCode: text("error_code"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("exports_user_idx").on(t.userId, t.createdAt), index("exports_clip_idx").on(t.clipId)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    /** Prevents duplicate queued/running jobs for the same work item. */
    dedupeKey: text("dedupe_key"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    clipId: uuid("clip_id"),
    exportId: uuid("export_id"),
    progress: real("progress").notNull().default(0),
    message: text("message"),
    lastError: text("last_error"),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("jobs_claim_idx").on(t.status, t.runAt, t.priority),
    index("jobs_project_idx").on(t.projectId),
    uniqueIndex("jobs_dedupe_active_idx")
      .on(t.dedupeKey)
      .where(sql`${t.status} in ('queued','running') and ${t.dedupeKey} is not null`),
  ],
);

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Transcript = typeof transcripts.$inferSelect;
export type Clip = typeof clips.$inferSelect;
export type NewClip = typeof clips.$inferInsert;
export type Export = typeof exportsTable.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Analysis = typeof analyses.$inferSelect;
