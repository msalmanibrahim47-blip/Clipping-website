import { z } from "zod";
import { canonicalYouTubeUrl, parseYouTubeId } from "@longcut/shared";
import { HttpError, parseBody, route } from "@/lib/api";

function isoDurationToSeconds(iso: string): number | null {
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [, d, h, min, s] = m.map((v) => Number(v ?? 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "user-agent": "LongCut/1.0" } });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Validates a YouTube URL and returns title, channel, thumbnail and duration. Uses the
 * YouTube Data API when YOUTUBE_API_KEY is set; otherwise oEmbed plus a best-effort duration.
 */
export const POST = route(async (req) => {
  const { url } = await parseBody(req, z.object({ url: z.string().min(5).max(500) }));
  const videoId = parseYouTubeId(url);
  if (!videoId) throw new HttpError(400, "That doesn't look like a valid YouTube link.", "YOUTUBE_INVALID_URL");
  const canonical = canonicalYouTubeUrl(videoId);

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (apiKey) {
    const data = await fetchJson(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${videoId}&key=${apiKey}`,
    ).catch(() => null);
    const item = (data?.items as Array<Record<string, any>> | undefined)?.[0];
    if (!item) throw new HttpError(404, "Unable to access this YouTube video.", "YOUTUBE_UNAVAILABLE");
    const thumbs = item.snippet?.thumbnails ?? {};
    return {
      videoId,
      url: canonical,
      title: item.snippet?.title as string,
      author: item.snippet?.channelTitle as string,
      thumbnailUrl: (thumbs.maxres ?? thumbs.high ?? thumbs.medium ?? thumbs.default)?.url as string,
      duration: isoDurationToSeconds(item.contentDetails?.duration ?? ""),
      isLive: item.snippet?.liveBroadcastContent === "live",
    };
  }

  const oembed = await fetchJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(canonical)}`).catch(() => null);
  if (!oembed) throw new HttpError(404, "Unable to access this YouTube video.", "YOUTUBE_UNAVAILABLE");
  let duration: number | null = null;
  try {
    const html = await (await fetch(canonical, { signal: AbortSignal.timeout(8000), headers: { "accept-language": "en" } })).text();
    const m = html.match(/"lengthSeconds":"(\d+)"/);
    if (m) duration = Number(m[1]);
  } catch {
    duration = null; // shown after download when unavailable here
  }
  return {
    videoId,
    url: canonical,
    title: String(oembed.title ?? "YouTube video"),
    author: String(oembed.author_name ?? ""),
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    duration,
    isLive: false,
  };
});
