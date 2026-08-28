"use client";

import type { Language } from "@/lib/business/types";

/**
 * Browser-native text-to-speech (speechSynthesis) wrapper.
 *
 * Free, device-supported, no external service. Voice selection prefers a
 * voice matching the selected app language; Roman Urdu responses stay in
 * Latin script and are spoken with the closest available voice (ur → hi →
 * en-IN → default) so they sound natural where device voices allow.
 */

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Removes symbols that screen/speech engines read awkwardly
 * (check marks, arrows, emoji-style decorations) without touching words.
 */
function speakableText(text: string): string {
  return text
    .replace(/[✓✔✕×✖→←↔★⭐️💡✨]/gu, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* ---------------------------------------------------------------------------
 * Voice selection
 * ------------------------------------------------------------------------ */

const URDU_VOICE_LANGS = ["ur-pk", "ur-in", "ur"];
const HINDI_FALLBACK_LANGS = ["hi-in", "hi"];
const ENGLISH_IN_FALLBACK = ["en-in"];

function pickVoice(lang: Language): SpeechSynthesisVoice | null {
  if (!isSpeechSynthesisSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  const wanted =
    lang === "ur"
      ? [...URDU_VOICE_LANGS, ...HINDI_FALLBACK_LANGS, ...ENGLISH_IN_FALLBACK]
      : ["en-us", "en-gb", "en-au", "en"];

  for (const prefix of wanted) {
    const exact = voices.find(
      (voice) => voice.lang.toLowerCase().replace("_", "-") === prefix,
    );
    if (exact) return exact;
    const partial = voices.find((voice) =>
      voice.lang.toLowerCase().replace("_", "-").startsWith(prefix),
    );
    if (partial) return partial;
  }
  // Last resort: an English-capable default voice reads Latin-script text.
  return voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ?? null;
}

/* ---------------------------------------------------------------------------
 * Long-text chunking (some engines cut off long utterances mid-way)
 * ------------------------------------------------------------------------ */

function chunkText(text: string): string[] {
  if (text.length <= 200) return [text];
  const sentences = text.split(/(?<=[.!?؟।\n])\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + " " + sentence).trim().length > 200 && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = `${current} ${sentence}`.trim();
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

/* ---------------------------------------------------------------------------
 * Playback control
 * ------------------------------------------------------------------------ */

export interface SpeakHandlers {
  onStart?: () => void;
  onEnd?: () => void;
  /** Engine failure or no usable voice — response is still shown as text. */
  onError?: () => void;
}

let cancelled = false;

/**
 * Speaks `text` in the given app language. Resolves via handlers; never
 * throws. Safe to call again after cancelSpeaking().
 */
export function speak(text: string, language: Language, handlers: SpeakHandlers = {}): void {
  if (!isSpeechSynthesisSupported()) {
    handlers.onError?.();
    return;
  }
  const synth = window.speechSynthesis;
  const clean = speakableText(text);
  if (!clean) {
    handlers.onError?.();
    return;
  }

  cancelSpeaking();
  cancelled = false;

  // Voices load asynchronously on some browsers; wait briefly for them.
  const startUtterance = () => {
    if (cancelled) return;
    const chunks = chunkText(clean);
    let started = false;
    let settled = false;

    const settleEnd = () => {
      if (!cancelled && !settled) {
        settled = true;
        handlers.onEnd?.();
      }
    };
    const settleError = () => {
      if (!cancelled && !settled) {
        settled = true;
        if (!started) handlers.onError?.();
        else handlers.onEnd?.();
      }
    };

    for (let i = 0; i < chunks.length; i += 1) {
      const utterance = new SpeechSynthesisUtterance(chunks[i]);
      const voice = pickVoice(language);
      if (voice) utterance.voice = voice;
      utterance.lang =
        language === "ur"
          ? voice?.lang && voice.lang.toLowerCase().startsWith("ur")
            ? voice.lang
            : "ur-PK"
          : (voice?.lang ?? "en-US");
      utterance.rate = 1;
      utterance.pitch = 1;

      if (i === 0) {
        utterance.onstart = () => {
          started = true;
          handlers.onStart?.();
        };
      }
      if (i === chunks.length - 1) {
        utterance.onend = settleEnd;
      }
      utterance.onerror = settleError;

      synth.speak(utterance);
    }

    // Safety net: if nothing ever starts (blocked engine), surface error.
    setTimeout(() => {
      if (!cancelled && !started && !synth.speaking && !synth.pending) {
        settled = true;
        handlers.onError?.();
      }
    }, 1500);
  };

  if (synth.getVoices().length === 0) {
    const handleVoicesChanged = () => {
      synth.removeEventListener("voiceschanged", handleVoicesChanged);
      startUtterance();
    };
    synth.addEventListener("voiceschanged", handleVoicesChanged);
    // Fallback if voiceschanged never fires.
    setTimeout(() => {
      synth.removeEventListener("voiceschanged", handleVoicesChanged);
      if (!cancelled) startUtterance();
    }, 600);
  } else {
    startUtterance();
  }
}

/** Immediately stops any in-progress speech. */
export function cancelSpeaking(): void {
  cancelled = true;
  if (isSpeechSynthesisSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Nothing playing or engine unavailable.
    }
  }
}
