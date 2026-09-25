/**
 * Transcript language-style detection. Distinguishes English, Hindi, Urdu and code-mixed
 * Hinglish (romanized or script-mixed) using script ratios plus a romanized Hindi/Urdu lexicon.
 * Deterministic and cheap, so it runs on full multi-hour transcripts.
 */
export const LANGUAGE_STYLES = ["english", "hindi", "urdu", "hinglish", "mixed", "other"] as const;
export type LanguageStyle = (typeof LANGUAGE_STYLES)[number];

export const LANGUAGE_STYLE_LABELS: Record<LanguageStyle, string> = {
  english: "English",
  hindi: "Hindi",
  urdu: "Urdu",
  hinglish: "Hinglish",
  mixed: "English + Hindi/Urdu",
  other: "Other",
};

/** Frequent romanized Hindi/Urdu function words. Chosen to rarely collide with English. */
const ROMAN_HINDI = new Set(
  (
    "aaj hum hain hai ho hoon hu tha thi the thay ye yeh wo woh vo ke ki ka ko se mein mai main mujhe " +
    "tum aap apna apni apne kya kyun kyon kaise kaisa kaisi kab kahan kaha jab tab agar lekin magar aur " +
    "nahi nahin nai na haan han bhi bhai yaar matlab bilkul accha acha theek thik sahi bohot bahut zyada " +
    "kam karna karo karte karta karti kar kiya kiye kiyaa raha rahe rahi rha rhe hoga hogi honge dekho " +
    "dekhte dekhne wala wale wali waala sab kuch koi kisi kitna kitne isko usko unko inko iska uska unka " +
    "yahan wahan abhi phir fir toh jaise waise isliye kyunki kyuki chahiye chahte pata samajh baat baatein " +
    "log logon mera meri mere tera teri tere hamara hamari humein hame unhe unhone maine humne aapko " +
    "paisa paise kaam ghar dost zindagi duniya sirf bas ekdum waqt din saal jaldi dobara pehle baad " +
    "shukriya dhanyavad namaste acha arre arey haina"
  ).split(/\s+/),
);

const DEVANAGARI = /[ऀ-ॿ]/;
const ARABIC = /[؀-ۿݐ-ݿ]/;
const LATIN = /^[a-z']+$/i;

export interface LanguageStats {
  style: LanguageStyle;
  /** BCP-47-ish dominant language code. */
  code: "en" | "hi" | "ur" | "hi-Latn" | "mixed" | "und";
  /** 0..1 */
  confidence: number;
  latinRatio: number;
  devanagariRatio: number;
  arabicRatio: number;
  /** Share of Latin-script words that are romanized Hindi/Urdu. */
  romanHindiRatio: number;
  /** Whether the transcript is in a non-Latin script (captions may need transliteration). */
  nonLatinScript: boolean;
  sampleWords: number;
}

export function detectLanguageStyle(text: string, maxWords = 60000): LanguageStats {
  const tokens = text.split(/\s+/).filter(Boolean).slice(0, maxWords);
  let latin = 0;
  let deva = 0;
  let arabic = 0;
  let romanHindi = 0;
  let total = 0;
  for (const raw of tokens) {
    const tok = raw.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    if (!tok) continue;
    total++;
    if (DEVANAGARI.test(tok)) deva++;
    else if (ARABIC.test(tok)) arabic++;
    else if (LATIN.test(tok)) {
      latin++;
      if (ROMAN_HINDI.has(tok.toLowerCase())) romanHindi++;
    }
  }
  const safe = Math.max(1, total);
  const latinRatio = latin / safe;
  const devanagariRatio = deva / safe;
  const arabicRatio = arabic / safe;
  const romanHindiRatio = latin > 0 ? romanHindi / latin : 0;

  let style: LanguageStyle = "other";
  let code: LanguageStats["code"] = "und";
  let confidence = 0.5;

  if (total < 5) {
    style = "other";
  } else if (devanagariRatio > 0.15 || arabicRatio > 0.15) {
    const nativeIsUrdu = arabicRatio > devanagariRatio;
    if (latinRatio > 0.2) {
      // Native script mixed with a substantial amount of English words.
      style = "mixed";
      code = "mixed";
      confidence = 0.6 + Math.min(0.3, latinRatio / 2);
    } else {
      style = nativeIsUrdu ? "urdu" : "hindi";
      code = nativeIsUrdu ? "ur" : "hi";
      confidence = Math.max(devanagariRatio, arabicRatio);
    }
  } else if (latinRatio > 0.6) {
    // Romanized Hindi/Urdu function words make up a large share of any real Hinglish speech.
    if (romanHindiRatio >= 0.12) {
      style = "hinglish";
      code = "hi-Latn";
      confidence = Math.min(0.97, 0.55 + romanHindiRatio);
    } else if (romanHindiRatio >= 0.05) {
      style = "mixed";
      code = "mixed";
      confidence = 0.55;
    } else {
      style = "english";
      code = "en";
      confidence = Math.min(0.99, 0.7 + (0.05 - romanHindiRatio) * 5);
    }
  }
  return {
    style,
    code,
    confidence: Math.round(confidence * 100) / 100,
    latinRatio,
    devanagariRatio,
    arabicRatio,
    romanHindiRatio,
    nonLatinScript: devanagariRatio + arabicRatio > 0.15,
    sampleWords: total,
  };
}

/**
 * The concrete caption transform required for a requested caption language, given the
 * detected transcript style.
 *   none           → show words as transcribed
 *   translate_en   → natural English translation
 *   romanize       → Roman-script Hinglish (keep English words, transliterate Hindi/Urdu)
 */
export type CaptionTransform = "none" | "translate_en" | "romanize";

export function resolveCaptionTransform(
  requested: "auto" | "english" | "hinglish" | "original",
  stats: Pick<LanguageStats, "style" | "nonLatinScript"> | null,
): CaptionTransform {
  if (requested === "original" || !stats) return "none";
  const { style, nonLatinScript } = stats;
  if (requested === "english") return style === "english" ? "none" : "translate_en";
  if (requested === "hinglish") return nonLatinScript ? "romanize" : "none";
  // auto: keep the creator's own style; only romanize script-mixed speech that is really Hinglish.
  if (nonLatinScript && style === "mixed") return "romanize";
  return "none";
}
