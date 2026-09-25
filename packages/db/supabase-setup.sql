-- LongCut database setup for the Supabase SQL Editor.
-- Paste everything and click Run. Safe to run more than once.

CREATE TABLE IF NOT EXISTS "analyses" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"sections" jsonb NOT NULL,
	"overview" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."analyses" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"origin" text DEFAULT 'ai' NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"start_time" double precision NOT NULL,
	"end_time" double precision NOT NULL,
	"duration" double precision NOT NULL,
	"cuts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"original_start" double precision,
	"original_end" double precision,
	"score" integer DEFAULT 0 NOT NULL,
	"signals" jsonb,
	"flags" jsonb,
	"title" text NOT NULL,
	"reason" text,
	"summary" text,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hook_text" text,
	"hook_start" double precision,
	"status" text DEFAULT 'candidate' NOT NULL,
	"package" jsonb,
	"package_status" text DEFAULT 'none' NOT NULL,
	"caption_style" jsonb,
	"caption_language" text,
	"frame_thumb_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."clips" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clip_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"resolution" text NOT NULL,
	"caption_mode" text NOT NULL,
	"caption_language" text DEFAULT 'auto' NOT NULL,
	"format" text DEFAULT 'mp4' NOT NULL,
	"options" jsonb NOT NULL,
	"start_time" double precision NOT NULL,
	"end_time" double precision NOT NULL,
	"cuts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"storage_path" text,
	"subtitle_paths" jsonb,
	"file_size" bigint,
	"duration" double precision,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"error_code" text,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."exports" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"dedupe_key" text,
	"user_id" uuid,
	"project_id" uuid,
	"clip_id" uuid,
	"export_id" uuid,
	"progress" real DEFAULT 0 NOT NULL,
	"message" text,
	"last_error" text,
	"error_code" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."jobs" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"storage_path" text,
	"original_filename" text,
	"mime_type" text,
	"file_size" bigint,
	"upload_id" text,
	"duration" double precision,
	"width" integer,
	"height" integer,
	"fps" real,
	"media" jsonb,
	"youtube" jsonb,
	"thumbnail_path" text,
	"audio_path" text,
	"preview_path" text,
	"waveform_path" text,
	"waveform_rate" integer,
	"status" text DEFAULT 'uploading' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"status_message" text,
	"error_code" text,
	"settings" jsonb NOT NULL,
	"rank_strategy" text DEFAULT 'balanced' NOT NULL,
	"language_stats" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."projects" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "sentence_translations" (
	"project_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"sentence_idx" integer NOT NULL,
	"text" text NOT NULL
);
ALTER TABLE public."sentence_translations" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "transcript_chunks" (
	"project_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"start" double precision NOT NULL,
	"end" double precision NOT NULL,
	"provider" text NOT NULL,
	"language" text,
	"words" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."transcript_chunks" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "transcripts" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"segments" jsonb NOT NULL,
	"language" text,
	"provider" text,
	"word_count" integer DEFAULT 0 NOT NULL,
	"speaker_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."transcripts" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"caption_style" jsonb,
	"llm_provider" text,
	"stt_provider" text,
	"encrypted_keys" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."user_settings" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."users" ENABLE ROW LEVEL SECURITY;

-- Primary keys / unique constraints (kept outside CREATE TABLE on purpose).
DO $$ BEGIN
  ALTER TABLE "sentence_translations" ADD CONSTRAINT "sentence_translations_project_id_mode_sentence_idx_pk" PRIMARY KEY("project_id","mode","sentence_idx");
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "transcript_chunks" ADD CONSTRAINT "transcript_chunks_project_id_index_pk" PRIMARY KEY("project_id","index");
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "analyses" ADD CONSTRAINT "analyses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "clips" ADD CONSTRAINT "clips_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exports" ADD CONSTRAINT "exports_clip_id_clips_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clips"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exports" ADD CONSTRAINT "exports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exports" ADD CONSTRAINT "exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sentence_translations" ADD CONSTRAINT "sentence_translations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "transcript_chunks" ADD CONSTRAINT "transcript_chunks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "clips_project_idx" ON "clips" USING btree ("project_id","rank");

CREATE INDEX IF NOT EXISTS "exports_user_idx" ON "exports" USING btree ("user_id","created_at");

CREATE INDEX IF NOT EXISTS "exports_clip_idx" ON "exports" USING btree ("clip_id");

CREATE INDEX IF NOT EXISTS "jobs_claim_idx" ON "jobs" USING btree ("status","run_at","priority");

CREATE INDEX IF NOT EXISTS "jobs_project_idx" ON "jobs" USING btree ("project_id");

CREATE UNIQUE INDEX IF NOT EXISTS "jobs_dedupe_active_idx" ON "jobs" USING btree ("dedupe_key") WHERE "jobs"."status" in ('queued','running') and "jobs"."dedupe_key" is not null;

CREATE INDEX IF NOT EXISTS "projects_user_idx" ON "projects" USING btree ("user_id","created_at");

-- Record the migration so the worker's RUN_MIGRATIONS=true won't re-apply it.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT 'ccd96f02e1488613b83d324144374e534da2663a7c4675aaa60c03008f52ade6', 1790323620303
  WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = 1790323620303);
