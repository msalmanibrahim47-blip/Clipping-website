/**
 * Opt-in end-to-end test: real Postgres queue, real S3-compatible storage, real FFmpeg and the
 * real job runner. Only the two external AI services (speech-to-text and the LLM) are replaced
 * with deterministic test doubles, since CI has no provider keys.
 *
 *   E2E=1 npx vitest run e2e     (with DATABASE_URL + STORAGE_* pointing at test services)
 *
 * It drains every queued job (process, render, package, captions…) and then exits.
 */
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { JsonRequest, LlmProvider } from "../llm";
import type { SttProvider } from "../stt";

const CHUNK = Number(process.env.TRANSCRIBE_CHUNK_SECONDS ?? 600);

class FakeStt implements SttProvider {
  readonly name = "fake-stt";
  readonly concurrency = 2;
  async transcribe(file: string) {
    const index = Number(path.basename(file).match(/chunk-(\d+)/)?.[1] ?? 0);
    const start = index * CHUNK;
    const words = [];
    // A word every 0.5s on an absolute grid, so overlapping chunks agree with each other.
    // Deliberately runs past the end of the audio on the last chunk, like a hallucinating ASR.
    for (let k = Math.ceil(start / 0.5); k * 0.5 < start + CHUNK + 4; k++) {
      const t = k * 0.5;
      const topic = Math.floor(t / 120);
      const text = k % 12 === 11 ? `point${k}.` : k % 12 === 0 ? `Topic${topic}` : `w${k % 50}`;
      words.push({ s: t - start, e: t - start + 0.4, w: text });
    }
    return { words, language: "en" };
  }
}

const idxs = (prompt: string) => [...prompt.matchAll(/\[#(\d+) /g)].map((m) => Number(m[1]));

class FakeLlm implements LlmProvider {
  readonly name = "fake-llm";
  readonly model = "fake";
  async json<T>(req: JsonRequest<T>): Promise<T> {
    const schema = req.schema as z.ZodType<T>;
    const p = req.prompt;
    let out: unknown;
    switch (req.task) {
      case "segment_topics": {
        const ids = idxs(p);
        const sections = [];
        for (let i = 0; i < ids.length; i += 20) {
          sections.push({ startIdx: ids[i], endIdx: ids[Math.min(ids.length - 1, i + 19)], title: `Section ${ids[i]}`, summary: "A discussion.", kind: "explanation", value: 40 + ((ids[i] * 7) % 60), energy: 50 });
        }
        out = { sections };
        break;
      }
      case "propose_candidates": {
        const ids = [...p.matchAll(/^(\d+) \|/gm)].map((m) => Number(m[1]));
        const candidates = [];
        for (let i = 0; i + 1 < ids.length; i += 3) candidates.push({ fromSection: ids[i], toSection: ids[i + 1], workingTitle: `Candidate ${i}`, angle: "complete discussion" });
        out = { candidates };
        break;
      }
      case "refine_clip": {
        const m = p.match(/Proposed boundaries: #(\d+) .* to #(\d+) /);
        const s = Number(m?.[1]);
        const e = Number(m?.[2]);
        const seed = s % 37;
        const signals = Object.fromEntries(
          ["hook", "curiosity", "emotion", "story", "density", "relevance", "controversy", "surprise", "shareability", "standalone", "completeness", "opening", "ending", "retention", "energy", "humor"].map((k, j) => [k, 45 + ((seed + j * 11) % 50)]),
        );
        out = { startIdx: s, endIdx: e, title: `How Topic ${s} Changes Everything`, reason: "Complete explanation with a strong opening and a clear conclusion.", summary: "They explain the idea end to end.", topics: ["business", "growth"], hookIdx: s, signals, flags: { startsMidThought: false, endsAbruptly: false, needsPriorContext: false } };
        break;
      }
      case "publishing_package": {
        const first = idxs(p)[0] ?? 0;
        out = {
          titles: { recommended: "Why Most Businesses Never Scale", alternatives: ["The Real Reason Businesses Stop Growing", "Why Scaling Gets Hard"] },
          description: { long: "In this clip, he explains why businesses struggle to scale and what to focus on first.", short: "Why businesses stall — and what to fix first." },
          hashtags: ["Business", "#Entrepreneurship", "#BusinessGrowth", "#Startup", "#Marketing"],
          keywords: ["scaling", "growth"],
          thumbnail: { subject: "Speaker, close-up", emotion: "serious, confident", composition: "face right third", background: "dark studio", visualElement: "downward chart", textOptions: ["THE SCALING TRAP", "WHY THEY STAY SMALL", "THIS STOPS GROWTH"], recommendedTextIndex: 0, prompt: "Create a professional YouTube thumbnail…", sourceFramePrompt: "Using the attached reference frame…" },
          hook: { hookIdx: first, strength: 88, suggestion: "Most businesses never scale — here's why." },
          cta: "Watch the full discussion for the complete breakdown.",
        };
        break;
      }
      case "smart_trim": {
        const ids = idxs(p);
        out = { startIdx: ids[Math.floor(ids.length / 4)], endIdx: ids[ids.length - 1], reason: "strongest part" };
        break;
      }
      default: {
        if (req.task.startsWith("captions_")) {
          const items = JSON.parse(p) as Array<{ idx: number; text: string }>;
          out = { sentences: items.map((i) => ({ idx: i.idx, text: i.text.toUpperCase() })) };
          break;
        }
        throw new Error(`unexpected task ${req.task}`);
      }
    }
    return schema.parse(out);
  }
}

vi.mock("../providers", () => ({
  providersForUser: async () => ({ llmName: "anthropic", sttName: "local", llm: () => new FakeLlm(), stt: () => new FakeStt() }),
}));

describe.skipIf(!process.env.E2E)("e2e: drain the job queue with the real pipeline", () => {
  it(
    "processes every queued job",
    async () => {
      const { getPool } = await import("@longcut/db");
      const { JobPool } = await import("../runner");
      const { processJob, analyzeJob, probeJob } = await import("../jobs/process");
      const { renderJob } = await import("../jobs/render");
      const { packageJob, captionsJob } = await import("../jobs/clipJobs");
      const { previewJob, cleanupJob } = await import("../jobs/maintenance");
      const handlers = { process: processJob, analyze: analyzeJob, probe: probeJob, render: renderJob, package: packageJob, captions: captionsJob, preview: previewJob, cleanup: cleanupJob };
      const pool = new JobPool("e2e", ["process", "analyze", "probe", "render", "package", "captions", "preview", "cleanup"], 2, handlers);
      pool.start();
      let idle = 0;
      while (idle < 3) {
        await new Promise((r) => setTimeout(r, 1500));
        const { rows } = await getPool().query("select count(*)::int as n from jobs where status in ('queued','running') and run_at <= now() + interval '5 seconds'");
        idle = rows[0].n === 0 ? idle + 1 : 0;
      }
      await pool.stop(1000);
      // Classified failures (e.g. a deliberately corrupt upload → SOURCE_UNREADABLE) are expected;
      // unclassified crashes, timeouts and leaked presigned URLs are not.
      const { rows: failed } = await getPool().query("select type, error_code, last_error from jobs where status = 'failed'");
      expect(failed.filter((f) => f.error_code === "INTERNAL" || f.error_code === "TIMEOUT")).toEqual([]);
      expect(failed.filter((f) => /X-Amz-Signature/i.test(f.last_error ?? ""))).toEqual([]);
    },
    15 * 60_000,
  );
});
