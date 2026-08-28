"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Language } from "@/lib/business/types";
import type { ChatErrorCode } from "@/lib/ai/chat-protocol";
import {
  isSpeechRecognitionSupported,
  startListening as startRecognition,
  stopListening as finalizeRecognition,
  type SpeechRecognitionErrorCode,
} from "@/lib/voice/speech-recognition";
import {
  cancelSpeaking,
  isSpeechSynthesisSupported,
  speak,
} from "@/lib/voice/text-to-speech";

/**
 * Voice turn state machine for the AI Manager.
 *
 * IDLE → LISTENING → PROCESSING → SPEAKING → IDLE (ERROR at any step).
 * Recognized speech becomes plain text and flows through the SAME agent
 * endpoint as typed chat; nothing here talks to providers directly.
 */

export type VoiceStatus = "idle" | "listening" | "processing" | "speaking" | "error";

export type VoiceErrorKind =
  | SpeechRecognitionErrorCode
  | "ai_failed"
  | "no_reply"
  | "speech_out_unavailable";

export interface TurnSubmitResult {
  ok: boolean;
  text?: string;
  errorCode?: ChatErrorCode;
}

const REPLY_PREF_KEY = "abm-voice-reply";

interface UseVoiceTurnOptions {
  language: Language;
  /** Sends user text through the shared AI chat pipeline. */
  submit: (text: string) => Promise<TurnSubmitResult>;
}

export function useVoiceTurn({ language, submit }: UseVoiceTurnOptions) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [partial, setPartial] = useState("");
  const [captured, setCaptured] = useState<string | null>(null);
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [showReplyBar, setShowReplyBar] = useState(false);
  const [errorKind, setErrorKind] = useState<VoiceErrorKind | null>(null);
  const [aiErrorCode, setAiErrorCode] = useState<ChatErrorCode | null>(null);
  const [replyMuted, setReplyMutedState] = useState(false);

  const submitRef = useRef(submit);
  submitRef.current = submit;
  const languageRef = useRef(language);
  languageRef.current = language;
  /* Kept in a ref so an in-flight turn honors the latest preference even if
     the user toggles mute mid-listening (avoids stale-closure speech). */
  const replyMutedRef = useRef(replyMuted);
  replyMutedRef.current = replyMuted;
  const mounted = useRef(true);

  /* Restore the spoken-reply preference after hydration. Speaking replies
     after a voice request is the expected behavior; users can mute it. */
  useEffect(() => {
    mounted.current = true;
    try {
      const stored = window.localStorage.getItem(REPLY_PREF_KEY);
      setReplyMutedState(stored === "off");
    } catch {
      // Session-only default.
    }
    return () => {
      mounted.current = false;
      finalizeRecognition(true);
      cancelSpeaking();
    };
  }, []);

  const setReplyMuted = useCallback((muted: boolean) => {
    replyMutedRef.current = muted;
    setReplyMutedState(muted);
    try {
      window.localStorage.setItem(REPLY_PREF_KEY, muted ? "off" : "on");
    } catch {
      // Session-only switch.
    }
  }, []);

  const fail = useCallback((kind: VoiceErrorKind, code: ChatErrorCode | null = null) => {
    if (!mounted.current) return;
    setErrorKind(kind);
    setAiErrorCode(code);
    setStatus("error");
  }, []);

  const finishTurn = useCallback(
    (replyText: string) => {
      if (!mounted.current) return;
      setLastReply(replyText);
      setShowReplyBar(true);
      if (replyMutedRef.current || !isSpeechSynthesisSupported()) {
        setStatus("idle");
        return;
      }
      setStatus("speaking");
      speak(replyText, languageRef.current, {
        onStart: () => {
          if (!mounted.current) return;
          setStatus((current) =>
            current === "speaking" ? "speaking" : current,
          );
        },
        onEnd: () => {
          if (!mounted.current) return;
          setStatus((current) => (current === "speaking" ? "idle" : current));
        },
        onError: () => {
          if (!mounted.current) return;
          setStatus((current) =>
            current === "speaking" ? "idle" : current,
          );
        },
      });
    },
    [],
  );

  const runTurn = useCallback(
    async (text: string) => {
      setCaptured(text);
      setPartial("");
      setStatus("processing");
      try {
        const result = await submitRef.current(text);
        if (!mounted.current) return;
        if (!result.ok) {
          fail("ai_failed", result.errorCode ?? "try_again");
          return;
        }
        const reply = result.text?.trim();
        if (!reply) {
          fail("no_reply");
          return;
        }
        finishTurn(reply);
      } catch {
        if (mounted.current) fail("ai_failed", "try_again");
      }
    },
    [fail, finishTurn],
  );

  const startListening = useCallback(() => {
    if (status === "listening" || status === "processing") return;
    cancelSpeaking();
    setErrorKind(null);
    setAiErrorCode(null);
    setCaptured(null);
    setPartial("");

    if (!isSpeechRecognitionSupported()) {
      fail("unsupported");
      return;
    }

    setStatus("listening");
    startRecognition(languageRef.current, {
      onPartial: (text) => {
        if (mounted.current) setPartial(text);
      },
      onComplete: (text) => {
        if (!mounted.current) return;
        const clean = text.trim();
        if (!clean) {
          fail("no_speech");
          return;
        }
        void runTurn(clean);
      },
      onError: (code) => {
        fail(code);
      },
    });
  }, [status, runTurn, fail]);

  /** Stops capture early and processes whatever speech was recognized. */
  const stopListening = useCallback(() => {
    finalizeRecognition(false);
  }, []);

  const stopSpeaking = useCallback(() => {
    cancelSpeaking();
    setStatus((current) => (current === "speaking" ? "idle" : current));
  }, []);

  const replayReply = useCallback(() => {
    if (!lastReply) return;
    cancelSpeaking();
    if (!isSpeechSynthesisSupported()) {
      fail("speech_out_unavailable");
      return;
    }
    setStatus("speaking");
    speak(lastReply, languageRef.current, {
      onEnd: () => {
        if (mounted.current) {
          setStatus((current) => (current === "speaking" ? "idle" : current));
        }
      },
      onError: () => {
        if (mounted.current) {
          setStatus((current) => (current === "speaking" ? "idle" : current));
        }
      },
    });
  }, [lastReply, fail]);

  /** Retry the failed step: listen again, or resend the same request. */
  const retry = useCallback(() => {
    const kind = errorKind;
    setErrorKind(null);
    setAiErrorCode(null);
    if (kind === "ai_failed" || kind === "no_reply") {
      const text = captured?.trim();
      if (text) void runTurn(text);
      else startListening();
      return;
    }
    startListening();
  }, [errorKind, captured, runTurn, startListening]);

  /** Dismiss errors / reply bar back to the resting state. */
  const reset = useCallback(() => {
    finalizeRecognition(true);
    cancelSpeaking();
    setErrorKind(null);
    setAiErrorCode(null);
    setPartial("");
    setCaptured(null);
    setShowReplyBar(false);
    setStatus((current) => (current === "processing" ? current : "idle"));
  }, []);

  return {
    status,
    partial,
    captured,
    lastReply,
    showReplyBar,
    errorKind,
    aiErrorCode,
    replyMuted,
    speechOutSupported: isSpeechSynthesisSupported(),
    setReplyMuted,
    startListening,
    stopListening,
    stopSpeaking,
    replayReply,
    retry,
    reset,
  };
}
