import "server-only";

import type {
  Model,
  ModelRequest,
  ModelResponse,
  StreamEvent,
} from "@openai/agents-core";

/**
 * Primary → backup model failover (server-only).
 *
 * A thin Agents SDK `Model` wrapper: every request first goes to the PRIMARY
 * model (the Gemini multi-project chain). When the primary attempt fails with
 * a provider-level error classified as eligible for backup, the BACKUP model
 * (Groq) serves the request. Everything above this layer — the agent, tools,
 * confirmation policy, streaming protocol — is unchanged and unaware of which
 * provider answered.
 *
 * Streaming recovery: events are buffered only until the first meaningful
 * content (output_text_delta) reaches the caller, then yielded live.  This
 * preserves the failover clean-replay guarantee for the common failure modes
 * (auth, rate-limit, config errors — which surface before any content) while
 * enabling progressive text rendering.  A failure AFTER the first text delta
 * has been yielded means the partial text stands and canReplayCleanly is
 * false; this rare edge case (typically a mid-generation network drop) is an
 * acceptable trade-off for real-time streaming.  Tools execute BETWEEN model
 * turns, outside this stream, so replaying a model request can never repeat
 * a database action.
 */

/** Describes how safely a failed primary attempt may be retried. */
export interface FailoverPhase {
  /**
   * True when NO event reached downstream yet, so the backup may serve the
   * whole request cleanly regardless of the primary error classification.
   */
  readonly canReplayCleanly: boolean;
}

export interface FailoverModelOptions {
  /** Builds/returns the primary model for each attempt. */
  readonly getPrimary: () => Model;
  /**
   * Decides whether the failure warrants the backup provider and returns a
   * ready-to-use backup model, or null to keep the original failure. The
   * phase tells the decision maker whether a clean replay is possible.
   */
  readonly resolveBackup: (
    primaryError: unknown,
    phase: FailoverPhase,
  ) => Model | null;
  /**
   * Translates a raw backup-provider failure into the error that should
   * propagate upstream. Called once per failed backup attempt.
   */
  readonly translateBackupError: (backupError: unknown) => Error;
}

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export class FailoverModel implements Model {
  private readonly options: FailoverModelOptions;

  constructor(options: FailoverModelOptions) {
    this.options = options;
  }

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    try {
      return await this.options.getPrimary().getResponse(request);
    } catch (error) {
      // A non-streaming response commits nothing downstream until it is
      // returned, so a failed primary attempt here is ALWAYS a clean-replay
      // opportunity for the backup — same guarantee as the streaming drain.
      const backup = this.resolveUsableBackup(error, request, true);
      if (!backup) throw error;
      try {
        return await backup.getResponse(request);
      } catch (backupError) {
        throw this.options.translateBackupError(backupError);
      }
    }
  }

  async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    // Buffer events only until the first meaningful content (output_text_delta)
    // reaches the caller, then switch to live yielding.  This preserves the
    // failover clean-replay guarantee for the most common failure modes
    // (auth, rate-limit, config — all surface before any content) while
    // enabling progressive text rendering for the common success path.
    //
    // Unsafe window: failures that happen AFTER the first text delta has
    // already been yielded.  In that rare case (typically a network drop
    // mid-generation) the partial text already shown to the user stands and
    // canReplayCleanly is false — matching the same principle already
    // accepted elsewhere for non-streaming mid-conversation-turn failures.
    const primary = this.options.getPrimary();
    const stream = primary.getStreamedResponse(request);

    const staging: StreamEvent[] = [];
    let live = false;

    try {
      for await (const event of stream) {
        if (!live) {
          staging.push(event);
          if (event.type === "output_text_delta") {
            // First meaningful content — commit to the primary and stream
            // everything (including already-staged events) to the caller.
            live = true;
            yield* staging;
            staging.length = 0;
          }
        } else {
          yield event;
        }
      }

      // Primary completed successfully — flush any remaining staged events
      // (e.g. response_started, model events for tool-call-only responses
      // where no output_text_delta was emitted).
      if (staging.length > 0) yield* staging;
    } catch (error) {
      // If we already yielded content to the caller the replay cannot be
      // clean — partial text is already visible.  Abort errors are never
      // re-routed regardless of phase.
      const canReplayCleanly = !live;
      const backup = this.resolveUsableBackup(error, request, canReplayCleanly);
      if (!backup) throw error;
      // Also flush anything staged before the error so the caller sees the
      // full primary attempt up to the failure point (e.g. response_started)
      // followed by the backup's complete response.
      if (staging.length > 0) yield* staging;
      yield* this.streamBackup(backup, request);
    }
  }

  private async *streamBackup(
    backup: Model,
    request: ModelRequest,
  ): AsyncIterable<StreamEvent> {
    try {
      yield* backup.getStreamedResponse(request);
    } catch (error) {
      throw this.options.translateBackupError(error);
    }
  }

  private resolveUsableBackup(
    error: unknown,
    request: ModelRequest,
    canReplayCleanly: boolean,
  ): Model | null {
    // A cancelled request must never be re-routed to another provider.
    if (request.signal?.aborted || isAbortLike(error)) return null;
    return this.options.resolveBackup(error, { canReplayCleanly });
  }
}
