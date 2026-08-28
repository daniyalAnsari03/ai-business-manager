"use client";

import type { Language } from "@/lib/business/types";

/**
 * Browser-native speech-to-text (Web Speech API) wrapper.
 *
 * Free, device-supported, no external service. The microphone is only
 * activated while `start()` is active — never on page load — and is fully
 * released when listening ends. Recognized text is plain user input: it
 * carries no authorization of any kind.
 */

/* ---------------------------------------------------------------------------
 * Minimal Web Speech API typings (not in the standard DOM lib yet).
 * ------------------------------------------------------------------------ */

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  readonly length: number;
  isFinal: boolean;
  item(index: number): SpeechRecognitionAlternativeLike;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  item(index: number): SpeechRecognitionResultLike;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getRecognitionCtor() !== null;
}

/* ---------------------------------------------------------------------------
 * Error model → stable, UI-mappable codes (never raw browser strings).
 * ------------------------------------------------------------------------ */

export type SpeechRecognitionErrorCode =
  | "unsupported"
  | "permission_denied"
  | "microphone_unavailable"
  | "language_unsupported"
  | "no_speech"
  | "network"
  | "failed";

/** BCP-47 tag used for recognition per app language. */
export function recognitionLocale(language: Language): string {
  return language === "ur" ? "ur-PK" : "en-US";
}

/* ---------------------------------------------------------------------------
 * Controller
 * ------------------------------------------------------------------------ */

const NO_SPEECH_TIMEOUT_MS = 9_000;
const MAX_LISTEN_MS = 30_000;

export interface SpeechSessionHandlers {
  /** Live, unconfirmed text while the user is speaking. */
  onPartial?: (text: string) => void;
  /** Confirmed text for this utterance; fires once before completion. */
  onFinalText?: (text: string) => void;
  /** Recognition ended and produced a usable transcript (or empty). */
  onComplete: (text: string) => void;
  onError: (code: SpeechRecognitionErrorCode) => void;
}

interface ActiveSession {
  recognition: SpeechRecognitionLike;
  handlers: SpeechSessionHandlers;
  finals: string[];
  interim: string;
  gotAnyResult: boolean;
  finished: boolean;
  manualStop: boolean;
  noSpeechTimer: ReturnType<typeof setTimeout> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
}

let active: ActiveSession | null = null;

function clearTimers(session: ActiveSession): void {
  if (session.noSpeechTimer) clearTimeout(session.noSpeechTimer);
  if (session.maxTimer) clearTimeout(session.maxTimer);
  session.noSpeechTimer = null;
  session.maxTimer = null;
}

function fail(session: ActiveSession, code: SpeechRecognitionErrorCode): void {
  if (session.finished) return;
  session.finished = true;
  clearTimers(session);
  try {
    session.recognition.abort();
  } catch {
    // Already stopped.
  }
  if (active === session) active = null;
  session.handlers.onError(code);
}

function complete(session: ActiveSession): void {
  if (session.finished) return;
  session.finished = true;
  clearTimers(session);
  if (active === session) active = null;
  const text = session.finals.join(" ").trim();
  session.handlers.onComplete(text);
}

/**
 * Starts one listening session. Resolves microphone permission lazily as part
 * of `start()` (browser prompt). Any previous session is discarded.
 */
export function startListening(
  language: Language,
  handlers: SpeechSessionHandlers,
): boolean {
  stopListening(true);

  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    handlers.onError("unsupported");
    return false;
  }

  const recognition = new Ctor();
  recognition.lang = recognitionLocale(language);
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  const session: ActiveSession = {
    recognition,
    handlers,
    finals: [],
    interim: "",
    gotAnyResult: false,
    finished: false,
    manualStop: false,
    noSpeechTimer: null,
    maxTimer: null,
  };

  recognition.onstart = () => {
    // If the user stays silent, fail softly instead of listening forever.
    session.noSpeechTimer = setTimeout(() => {
      if (!session.gotAnyResult) {
        fail(session, "no_speech");
      }
    }, NO_SPEECH_TIMEOUT_MS);
  };

  recognition.onresult = (event) => {
    session.gotAnyResult = true;
    if (session.noSpeechTimer) {
      clearTimeout(session.noSpeechTimer);
      session.noSpeechTimer = null;
    }
    let interim = "";
    let finalChunk = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const alternative = result[0];
      if (!alternative) continue;
      if (result.isFinal) {
        finalChunk += `${alternative.transcript} `;
      } else {
        interim += alternative.transcript;
      }
    }
    if (finalChunk.trim()) session.finals.push(finalChunk.trim());
    session.interim = interim.trim();
    if (session.interim) handlers.onPartial?.(session.interim);

    // A confirmed utterance ends the session (command-style interaction).
    if (finalChunk.trim()) {
      handlers.onFinalText?.(session.finals.join(" "));
      complete(session);
    }
  };

  recognition.onerror = (event) => {
    switch (event.error) {
      case "not-allowed":
      case "service-not-allowed":
        fail(session, "permission_denied");
        break;
      case "audio-capture":
        fail(session, "microphone_unavailable");
        break;
      case "language-not-supported":
        fail(session, "language_unsupported");
        break;
      case "network":
        fail(session, "network");
        break;
      case "aborted":
        // Triggered by our own abort()/stop(); handled by onend/manual flags.
        break;
      case "no-speech":
        fail(session, "no_speech");
        break;
      default:
        fail(session, "failed");
    }
  };

  recognition.onend = () => {
    if (session.finished) return;
    // Natural end without a final result: deliver whatever we have.
    if (session.manualStop && session.finals.length > 0) {
      complete(session);
      return;
    }
    if (session.gotAnyResult) {
      const text = [...session.finals, session.interim].join(" ").trim();
      if (text) {
        session.finished = true;
        clearTimers(session);
        if (active === session) active = null;
        session.handlers.onComplete(text);
        return;
      }
    }
    fail(session, "no_speech");
  };

  active = session;

  // Hard cap so the microphone can never stay open indefinitely.
  session.maxTimer = setTimeout(() => {
    if (!session.finished) {
      session.manualStop = true;
      try {
        recognition.stop();
      } catch {
        complete(session);
      }
    }
  }, MAX_LISTEN_MS);

  try {
    recognition.start();
    return true;
  } catch {
    active = null;
    handlers.onError("failed");
    return false;
  }
}

/**
 * Stops listening early and delivers what was captured so far, or silently
 * discards the session when `discard` is set.
 */
export function stopListening(discard = false): void {
  const session = active;
  if (!session) return;
  if (discard) {
    session.finished = true;
    clearTimers(session);
    try {
      session.recognition.abort();
    } catch {
      // Already stopped.
    }
    if (active === session) active = null;
    return;
  }
  session.manualStop = true;
  clearTimers(session);
  try {
    session.recognition.stop();
  } catch {
    // Some engines throw when stop() races end; finalize manually.
    complete(session);
  }
}
