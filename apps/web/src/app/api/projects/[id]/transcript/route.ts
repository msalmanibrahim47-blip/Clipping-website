import { eq, getDb, transcripts } from "@longcut/db";
import { sentencesInRange } from "@longcut/shared";
import { HttpError, ownedProject, route } from "@/lib/api";

/**
 * Transcript access. `from`/`to` return a time window with word timings (editor);
 * `q` searches the full transcript; with neither, returns every sentence without words.
 */
export const GET = route<{ id: string }>(async (req, { params, session }) => {
  const project = await ownedProject(session.userId, params.id);
  const t = await getDb().query.transcripts.findFirst({ where: eq(transcripts.projectId, project.id) });
  if (!t) throw new HttpError(404, "Transcript not available yet.");
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q")?.trim().toLowerCase();
  const from = sp.get("from");
  const to = sp.get("to");
  const withWords = sp.get("words") === "1";
  let sentences = t.segments;
  if (from != null && to != null) sentences = sentencesInRange(sentences, Number(from), Number(to));
  if (q) sentences = sentences.filter((s) => s.t.toLowerCase().includes(q)).slice(0, 300);
  return {
    language: t.language,
    languageStats: project.languageStats,
    provider: t.provider,
    wordCount: t.wordCount,
    speakerCount: t.speakerCount,
    totalSentences: t.segments.length,
    sentences: withWords ? sentences : sentences.map(({ w: _w, ...rest }) => rest),
  };
});
