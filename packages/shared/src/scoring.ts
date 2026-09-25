/**
 * Clip scoring. The LLM rates each candidate on independent content signals (0–100); the overall
 * "Predicted Performance Potential" is a deterministic weighted blend. Because the blend is
 * computed here — not by the model — switching strategy re-ranks clips instantly, without
 * re-transcribing or re-analyzing the source.
 */
export const SIGNAL_KEYS = [
  "hook",
  "curiosity",
  "emotion",
  "story",
  "density",
  "relevance",
  "controversy",
  "surprise",
  "shareability",
  "standalone",
  "completeness",
  "opening",
  "ending",
  "retention",
  "energy",
  "humor",
] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];
export type Signals = Record<SignalKey, number>;

export const SIGNAL_LABELS: Record<SignalKey, string> = {
  hook: "Hook strength",
  curiosity: "Curiosity gap",
  emotion: "Emotional intensity",
  story: "Story quality",
  density: "Information density",
  relevance: "Audience relevance",
  controversy: "Debate potential",
  surprise: "Surprise factor",
  shareability: "Shareability",
  standalone: "Standalone context",
  completeness: "Narrative completeness",
  opening: "Strong opening",
  ending: "Strong ending",
  retention: "Retention potential",
  energy: "Conversational energy",
  humor: "Humor",
};

export const STRATEGIES = [
  "balanced",
  "viral",
  "educational",
  "storytelling",
  "controversial",
  "emotional",
  "business",
  "comedy",
  "energy",
  "gaming",
  "custom",
] as const;
export type Strategy = (typeof STRATEGIES)[number];

export const STRATEGY_LABELS: Record<Strategy, string> = {
  balanced: "Balanced",
  viral: "Viral Potential",
  educational: "Educational",
  storytelling: "Storytelling",
  controversial: "Controversial",
  emotional: "Emotional",
  business: "Business",
  comedy: "Comedy",
  energy: "High Energy",
  gaming: "Gaming",
  custom: "Custom",
};

/** Guidance injected into analysis prompts so the model looks for the right kind of segment. */
export const STRATEGY_GUIDANCE: Record<Strategy, string> = {
  balanced: "Find the most compelling complete discussions overall, balancing value, story and energy.",
  viral: "Favor segments with strong hooks, surprise, emotional peaks and high share potential — still complete and self-contained.",
  educational: "Favor clear explanations, frameworks, how-tos and teaching moments with a complete arc.",
  storytelling: "Favor complete personal stories and narratives with setup, tension and resolution.",
  controversial: "Favor strong opinions, disagreements and debates that are fully argued, not isolated hot takes.",
  emotional: "Favor emotionally resonant moments — vulnerability, inspiration, conflict — presented with full context.",
  business: "Favor business, money, growth, marketing, startup and career discussions with actionable substance.",
  comedy: "Favor genuinely funny extended bits, banter and comedic stories that land without prior context.",
  energy: "Favor high-energy, fast-paced, animated stretches that keep momentum throughout.",
  gaming: "Favor gameplay highlights with commentary: clutch moments, big plays, reactions and funny sequences with context.",
  custom: "Follow the creator's custom instructions.",
};

const BASE: Signals = {
  hook: 1.2,
  curiosity: 1,
  emotion: 0.8,
  story: 1,
  density: 1,
  relevance: 1,
  controversy: 0.5,
  surprise: 0.6,
  shareability: 0.9,
  standalone: 1.3,
  completeness: 1.3,
  opening: 1,
  ending: 1,
  retention: 1.2,
  energy: 0.7,
  humor: 0.4,
};

function weights(overrides: Partial<Signals>): Signals {
  return { ...BASE, ...overrides };
}

export const STRATEGY_WEIGHTS: Record<Exclude<Strategy, "custom">, Signals> = {
  balanced: BASE,
  viral: weights({ hook: 2, curiosity: 1.6, surprise: 1.4, shareability: 1.8, emotion: 1.2, retention: 1.6, density: 0.6 }),
  educational: weights({ density: 2, relevance: 1.5, completeness: 1.6, story: 0.7, controversy: 0.2, humor: 0.2, energy: 0.4 }),
  storytelling: weights({ story: 2.2, emotion: 1.4, completeness: 1.7, ending: 1.4, density: 0.6 }),
  controversial: weights({ controversy: 2.2, curiosity: 1.4, shareability: 1.3, emotion: 1.1 }),
  emotional: weights({ emotion: 2.2, story: 1.4, ending: 1.2, humor: 0.3 }),
  business: weights({ density: 1.6, relevance: 1.7, curiosity: 1.2, story: 1.1, humor: 0.2 }),
  comedy: weights({ humor: 2.4, energy: 1.5, shareability: 1.3, density: 0.4, controversy: 0.4 }),
  energy: weights({ energy: 2.2, retention: 1.5, hook: 1.4, emotion: 1.2, density: 0.6 }),
  gaming: weights({ energy: 1.8, surprise: 1.5, humor: 1.2, emotion: 1.2, density: 0.5, story: 0.8 }),
};

export interface ContextFlags {
  startsMidThought?: boolean;
  endsAbruptly?: boolean;
  needsPriorContext?: boolean;
}

export function normalizeSignals(input: Partial<Record<string, unknown>> | null | undefined): Signals {
  const out = {} as Signals;
  for (const key of SIGNAL_KEYS) {
    const raw = Number(input?.[key]);
    out[key] = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 50;
  }
  return out;
}

export function weightsFor(strategy: Strategy, custom?: Partial<Signals> | null): Signals {
  if (strategy === "custom") return weights(custom ?? {});
  return STRATEGY_WEIGHTS[strategy];
}

/** Predicted Performance Potential, 0–100. */
export function computeScore(
  signals: Partial<Signals>,
  strategy: Strategy = "balanced",
  flags: ContextFlags = {},
  custom?: Partial<Signals> | null,
): number {
  const s = normalizeSignals(signals);
  const w = weightsFor(strategy, custom);
  let num = 0;
  let den = 0;
  for (const key of SIGNAL_KEYS) {
    num += s[key] * w[key];
    den += w[key];
  }
  let score = den > 0 ? num / den : 0;
  // A clip that can't stand on its own is never a top pick, whatever its other signals.
  if (flags.startsMidThought) score -= 8;
  if (flags.endsAbruptly) score -= 8;
  if (flags.needsPriorContext) score -= 6;
  // Stretch mid-range blends so rankings are legible (raw blends cluster around 55–80).
  const stretched = 50 + (score - 50) * 1.35;
  return Math.round(Math.min(99, Math.max(1, stretched)));
}

export interface RankableClip {
  id: string;
  signals: Partial<Signals> | null;
  flags?: ContextFlags | null;
}

export function rankClips<T extends RankableClip>(
  clips: T[],
  strategy: Strategy,
  custom?: Partial<Signals> | null,
): Array<T & { score: number; rank: number }> {
  return clips
    .map((c) => ({ ...c, score: computeScore(c.signals ?? {}, strategy, c.flags ?? {}, custom) }))
    .sort((a, b) => b.score - a.score)
    .map((c, i) => ({ ...c, rank: i + 1 }));
}
