"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import type { Dictionary } from "@/lib/i18n/dictionary";
import type { ChatErrorCode } from "@/lib/ai/chat-protocol";
import { EASE_PREMIUM } from "@/components/motion/presets";
import {
  AlertCircleIcon,
  CheckIcon,
  LoaderIcon,
  SquareStopIcon,
  VolumeIcon,
  VolumeOffIcon,
  XIcon,
} from "@/components/ui/icons";
import type { useVoiceTurn, VoiceErrorKind } from "@/components/ai/use-voice-turn";
import { cn } from "@/lib/utils";

/**
 * Premium voice interaction surface for the AI Manager.
 * Communicates the voice state machine (listening / thinking / speaking /
 * error) with restrained emerald feedback, always paired with readable text.
 */

type VoiceState = ReturnType<typeof useVoiceTurn>;

const VOICE_ERROR_KEY: Record<
  Exclude<VoiceErrorKind, "ai_failed">,
  keyof Dictionary["aiVoice"]
> = {
  unsupported: "errorUnsupported",
  permission_denied: "errorPermissionDenied",
  microphone_unavailable: "errorMicrophoneUnavailable",
  language_unsupported: "errorLanguageUnsupported",
  no_speech: "errorNoSpeech",
  network: "errorNetwork",
  failed: "errorFailed",
  no_reply: "errorNoReply",
  speech_out_unavailable: "speechOutUnavailable",
};

const CHAT_ERROR_KEY: Record<
  ChatErrorCode,
  keyof Dictionary["aiChat"]
> = {
  unauthenticated: "errorUnauthenticated",
  invalid_input: "errorInvalidInput",
  busy: "errorBusy",
  ai_not_configured: "errorAiNotConfigured",
  ai_overloaded: "errorAiOverloaded",
  provider_auth: "errorProviderAuth",
  try_again: "errorTryAgain",
  response_incomplete: "errorResponseIncomplete",
};

const BAR_HEIGHTS = [0.45, 0.8, 1, 0.7, 0.5];

function errorText(
  t: Dictionary,
  kind: VoiceErrorKind,
  aiErrorCode: ChatErrorCode | null,
): string {
  if (kind === "ai_failed") {
    return String(t.aiChat[CHAT_ERROR_KEY[aiErrorCode ?? "try_again"]]);
  }
  return String(t.aiVoice[VOICE_ERROR_KEY[kind]]);
}

export function VoicePanel({
  voice,
  t,
}: {
  voice: VoiceState;
  t: Dictionary;
}) {
  const reducedMotion = useReducedMotion();
  const {
    status,
    partial,
    captured,
    lastReply,
    showReplyBar,
    errorKind,
    aiErrorCode,
    replyMuted,
    speechOutSupported,
    setReplyMuted,
    stopListening,
    stopSpeaking,
    replayReply,
    retry,
    reset,
  } = voice;

  const visible =
    status !== "idle" || errorKind !== null || (showReplyBar && Boolean(lastReply));
  const listening = status === "listening";
  const processing = status === "processing";
  const speaking = status === "speaking";

  /* Keep the active voice control in view — expanding the panel can push it
     below the fold on phones. Gentle, reduced-motion aware; re-targets as
     the expand animation settles. */
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!listening) return;
    const scrollToPanel = () => {
      panelRef.current?.scrollIntoView({
        block: "nearest",
        behavior: reducedMotion ? "auto" : "smooth",
      });
    };
    scrollToPanel();
    const settleTimer = window.setTimeout(scrollToPanel, 240);
    const finalTimer = window.setTimeout(scrollToPanel, 520);
    return () => {
      window.clearTimeout(settleTimer);
      window.clearTimeout(finalTimer);
    };
  }, [listening, reducedMotion]);

  const stateLabel = listening
    ? t.aiVoice.listening
    : processing
      ? t.aiVoice.thinking
      : speaking
        ? t.aiVoice.speaking
        : "";

  const transcriptLine = listening
    ? (partial || captured || "")
    : (captured ?? "");

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div
          key="voice-panel"
          ref={panelRef}
          initial={reducedMotion ? false : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={
            reducedMotion
              ? { opacity: 0 }
              : { opacity: 0, height: 0, transition: { duration: 0.25 } }
          }
          transition={{ duration: 0.4, ease: EASE_PREMIUM }}
          className="overflow-hidden"
        >
          <div className="px-3 pb-1 pt-3 sm:px-4">
            {/* Screen-reader announcement of state changes */}
            <p className="sr-only" role="status" aria-live="polite">
              {errorKind
                ? `${t.aiVoice.errorLabel}. ${errorText(t, errorKind, aiErrorCode)}`
                : stateLabel || ""}
            </p>

            {errorKind ? (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-red-500/25 bg-red-500/[0.07] px-4 py-3 text-sm text-red-600 dark:text-red-400"
              >
                <AlertCircleIcon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 leading-relaxed">
                  {errorText(t, errorKind, aiErrorCode)}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={retry}
                    className="min-h-9 rounded-full border border-red-500/30 px-3.5 font-medium transition-colors hover:bg-red-500/10 min-touch-target-sm"
                  >
                    {t.aiVoice.retry}
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    aria-label={t.aiVoice.close}
                    title={t.aiVoice.close}
                    className="inline-flex size-9 items-center justify-center rounded-full border border-transparent text-red-500/80 transition-colors hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300 min-touch-target-sm"
                  >
                    <XIcon className="size-4" />
                  </button>
                </div>
              </div>
            ) : status === "idle" ? (
              /* Resting reply bar — replay the latest spoken response */
              <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-700 text-emerald-950 shadow-glow-btn">
                  <CheckIcon className="size-3.5" />
                </span>
                <p className="min-w-0 flex-1 truncate text-xs text-muted" title={lastReply ?? ""}>
                  <span className="font-medium text-accent">{t.aiVoice.replyLabel}: </span>
                  {lastReply}
                </p>
                {speechOutSupported && (
                  <button
                    type="button"
                    onClick={replayReply}
                    aria-label={t.aiVoice.replay}
                    title={t.aiVoice.replay}
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card transition-colors hover:border-emerald-500/40 hover:text-accent min-touch-target-sm"
                  >
                    <VolumeIcon className="size-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={reset}
                  aria-label={t.aiVoice.close}
                  title={t.aiVoice.close}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:text-muted min-touch-target-sm"
                >
                  <XIcon className="size-4" />
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-line bg-surface-raised px-3 py-3 shadow-card sm:px-4">
                <div className="flex items-center gap-3">
                  {/* Primary state control */}
                  {processing ? (
                    <span className="inline-flex h-11 flex-1 cursor-default select-none items-center gap-2.5 rounded-full border border-line bg-surface px-4 text-sm font-medium text-muted">
                      <LoaderIcon className="size-4 shrink-0 animate-spin text-accent" />
                      {t.aiVoice.thinking}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={speaking ? stopSpeaking : stopListening}
                      aria-label={speaking ? t.aiVoice.stopSpeaking : t.aiVoice.tapToFinish}
                      className={cn(
                        "group relative inline-flex h-11 flex-1 items-center gap-2.5 overflow-hidden rounded-full px-4 text-sm font-medium shadow-card ring-1 ring-inset transition-all duration-300 active:translate-y-px",
                        listening
                          ? "border border-emerald-500/40 bg-gradient-to-r from-emerald-500/[0.14] to-emerald-500/[0.05] text-accent ring-white/5 hover:border-emerald-400/60"
                          : "border border-line bg-surface text-muted hover:border-emerald-500/40 hover:text-accent",
                      )}
                    >
                      {listening ? (
                        <>
                          <ListeningBars reducedMotion={reducedMotion} />
                          {!reducedMotion && (
                            <motion.span
                              aria-hidden
                              className="absolute inset-0 rounded-full border border-emerald-400/30"
                              animate={{ opacity: [0.55, 0.15, 0.55] }}
                              transition={{
                                duration: 2.2,
                                repeat: Infinity,
                                ease: "easeInOut",
                              }}
                            />
                          )}
                        </>
                      ) : (
                        <VolumeIcon className="size-4 shrink-0 animate-pulse text-accent" />
                      )}
                      <span className="truncate">{stateLabel}</span>
                      <span
                        aria-hidden
                        className="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-background/60 text-faint transition-colors group-hover:text-accent"
                      >
                        <SquareStopIcon className="size-2.5" />
                      </span>
                    </button>
                  )}

                  {/* Spoken-reply preference */}
                  <button
                    type="button"
                    onClick={() => setReplyMuted(!replyMuted)}
                    aria-pressed={!replyMuted}
                    aria-label={
                      replyMuted ? t.aiVoice.repliesOff : t.aiVoice.repliesOn
                    }
                    title={replyMuted ? t.aiVoice.repliesOff : t.aiVoice.repliesOn}
                    disabled={!speechOutSupported}
                    className={cn(
                      "inline-flex size-11 shrink-0 items-center justify-center rounded-full border transition-colors min-touch-target",
                      replyMuted
                        ? "border-line bg-surface text-faint hover:text-muted"
                        : "border-emerald-500/35 bg-emerald-500/[0.08] text-accent",
                      !speechOutSupported && "pointer-events-none opacity-40",
                    )}
                  >
                    {replyMuted ? (
                      <VolumeOffIcon className="size-4" />
                    ) : (
                      <VolumeIcon className="size-4" />
                    )}
                  </button>
                </div>

                {(transcriptLine || (speaking && lastReply)) && (
                  <div
                    aria-live="polite"
                    className="mt-3 space-y-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm leading-relaxed"
                  >
                    {transcriptLine ? (
                      <p className="break-words">
                        <span className="font-medium text-faint">
                          {t.aiVoice.youSaidLabel}:{" "}
                        </span>
                        {transcriptLine}
                        {listening && !partial && !captured ? (
                          <span className="text-faint"> …</span>
                        ) : null}
                      </p>
                    ) : null}
                    {speaking && lastReply ? (
                      <p className="line-clamp-3 break-words text-muted">
                        <span className="font-medium text-accent">
                          {t.aiVoice.replyLabel}:{" "}
                        </span>
                        {lastReply}
                      </p>
                    ) : null}
                  </div>
                )}

                {listening && (
                  <p className="mt-2 px-1 text-xs text-faint">{t.aiVoice.listeningHint}</p>
                )}
              </div>
            )}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Soft emerald waveform — communicates "the AI is hearing you". */
function ListeningBars({ reducedMotion }: { reducedMotion: boolean | null }) {
  return (
    <span aria-hidden className="flex h-5 w-6 items-center gap-[3px]">
      {BAR_HEIGHTS.map((height, index) => (
        <motion.span
          key={index}
          className="w-[3px] rounded-full bg-gradient-to-t from-emerald-600 to-emerald-300"
          style={{ height: `${height * 100}%` }}
          animate={reducedMotion ? undefined : { scaleY: [0.45, 1, 0.45] }}
          transition={
            reducedMotion
              ? undefined
              : {
                  duration: 1.15,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: index * 0.12,
                }
          }
        />
      ))}
    </span>
  );
}
