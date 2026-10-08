import {
  AuthError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitedError,
  ServerError,
  YTAPIError,
} from "./errors.js";
import type {
  BatchJob,
  BatchSubmit,
  BatchTask,
  Channel,
  ChannelLatest,
  ChannelPlaylist,
  ChannelPlaylistsPage,
  ChannelVideo,
  ChannelVideosPage,
  ClientOptions,
  DurationFilter,
  PlaylistPage,
  PlaylistVideo,
  SearchItem,
  SearchPage,
  SearchSort,
  SearchType,
  SortBy,
  Suggestions,
  TrackPolicy,
  Transcript,
  TranscriptFormat,
  UploadDate,
  VideoBasicInfo,
  VideoInfo,
} from "./types.js";

const USER_AGENT = "ytapi-js/0.1.0 (+https://docs.ytapi.dev)";
const ENV_KEYS = ["YTAPI_API_KEY", "YTAPI_KEY"];
// A free account's daily limit answers 429 with Retry-After until 00:00 UTC.
// Waiting that long inside a call would hang the caller, so it is thrown.
const DAILY_LIMIT_CODE = "daily_limit_exceeded";
const TEXT_FORMATS = new Set(["markdown", "text", "srt", "vtt"]);

const ERROR_TYPES: Record<number, typeof YTAPIError> = {
  401: AuthError,
  402: InsufficientCreditsError,
  404: NotFoundError,
  429: RateLimitedError,
};

export class YTAPI {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly backoffMs: number;
  readonly backoffCapMs: number;
  readonly maxRetryWaitMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly nowImpl: () => number;

  /**
   * `apiKey` falls back to the `YTAPI_API_KEY` environment variable, then `YTAPI_KEY`.
   *
   * Retries apply to HTTP 429, 5xx and network errors (timeouts, dropped
   * connections), unless the body sets `retryable` to false. A 429 whose
   * Retry-After is longer than `maxRetryWaitMs`, such as a free account's daily
   * limit, is thrown at once instead of waited out. Creating a batch is never
   * retried after a 5xx or a network error, since the job may already exist.
   */
  constructor(options: ClientOptions = {}) {
    const key = options.apiKey ?? ENV_KEYS.map(readEnv).find((value) => value);
    if (!key) {
      throw new Error("Pass apiKey or set the YTAPI_API_KEY environment variable.");
    }
    const maxRetries = options.maxRetries ?? 2;
    if (maxRetries < 0) {
      throw new Error("maxRetries must be >= 0.");
    }
    this.apiKey = key;
    this.baseUrl = (options.baseUrl ?? "https://api.ytapi.dev").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = maxRetries;
    this.backoffMs = options.backoffMs ?? 500;
    this.backoffCapMs = options.backoffCapMs ?? 8_000;
    this.maxRetryWaitMs = options.maxRetryWaitMs ?? 60_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.sleepImpl =
      options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.nowImpl = options.now ?? Date.now;
  }

  /** Captions for one video. Text formats return the document as a string. */
  async getTranscript(
    videoId: string,
    options: {
      format?: TranscriptFormat;
      wordLevel?: boolean;
      languages?: string[];
      trackPolicy?: TrackPolicy;
    } = {},
  ): Promise<Transcript | string> {
    const body: Record<string, unknown> = { video_id: videoId };
    if (options.format !== undefined) body.format = options.format;
    if (options.wordLevel !== undefined) body.word_level = options.wordLevel;
    if (options.languages !== undefined) body.languages = options.languages;
    if (options.trackPolicy !== undefined) body.track_policy = options.trackPolicy;
    return this.request("POST", "/v1/transcripts", {
      json: body,
      asText: options.format !== undefined && TEXT_FORMATS.has(options.format),
    });
  }

  /** Title, duration, channel and caption languages. Costs 0 credits. */
  getBasicInfo(videoId: string): Promise<VideoBasicInfo> {
    return this.request("GET", `/v1/videos/${seg(videoId)}/basic-info`);
  }

  /** Full metadata, including description, counts and chapters. 1 credit. */
  getVideoInfo(videoId: string): Promise<VideoInfo> {
    return this.request("GET", `/v1/videos/${seg(videoId)}/video-info`);
  }

  /** One page of a playlist. Later pages carry videos only. 1 credit per page. */
  getPlaylist(playlistId: string, options: { cursor?: string } = {}): Promise<PlaylistPage> {
    return this.request("GET", `/v1/playlists/${seg(playlistId)}`, {
      query: { cursor: options.cursor },
    });
  }

  /** Every video in a playlist, following `next_cursor`. */
  async *iterPlaylistVideos(playlistId: string): AsyncGenerator<PlaylistVideo> {
    yield* pages(
      (cursor) => this.getPlaylist(playlistId, { cursor }),
      (page) => page.videos,
    );
  }

  /** Channel profile. `channelId` may be `@handle` or `UC...`. 1 credit. */
  getChannel(channelId: string): Promise<Channel> {
    return this.request("GET", `/v1/channels/${seg(channelId)}`);
  }

  /** The latest upload and a short list of recent videos. 1 credit. */
  getChannelLatest(channelId: string): Promise<ChannelLatest> {
    return this.request("GET", `/v1/channels/${seg(channelId)}/latest`);
  }

  /** One page of uploads. 1 credit per page. */
  listChannelVideos(
    channelId: string,
    options: { cursor?: string; sortBy?: SortBy } = {},
  ): Promise<ChannelVideosPage> {
    return this.request("GET", `/v1/channels/${seg(channelId)}/videos`, {
      query: { cursor: options.cursor, sort_by: options.sortBy },
    });
  }

  /** Every upload, following `next_cursor`. `sortBy` is sent on each page. */
  async *iterChannelVideos(
    channelId: string,
    options: { sortBy?: SortBy } = {},
  ): AsyncGenerator<ChannelVideo> {
    yield* pages(
      (cursor) => this.listChannelVideos(channelId, { cursor, sortBy: options.sortBy }),
      (page) => page.videos,
    );
  }

  /** One page of the channel's playlists. 1 credit per page. */
  listChannelPlaylists(
    channelId: string,
    options: { cursor?: string } = {},
  ): Promise<ChannelPlaylistsPage> {
    return this.request("GET", `/v1/channels/${seg(channelId)}/playlists`, {
      query: { cursor: options.cursor },
    });
  }

  async *iterChannelPlaylists(channelId: string): AsyncGenerator<ChannelPlaylist> {
    yield* pages(
      (cursor) => this.listChannelPlaylists(channelId, { cursor }),
      (page) => page.playlists,
    );
  }

  /** One page of search results. 1 credit per page. */
  search(
    query: string,
    options: {
      type?: SearchType;
      limit?: number;
      cursor?: string;
      uploadDate?: UploadDate;
      duration?: DurationFilter;
      sortBy?: SearchSort;
    } = {},
  ): Promise<SearchPage> {
    return this.request("GET", "/v1/search", {
      query: {
        q: query,
        type: options.type,
        limit: options.limit,
        cursor: options.cursor,
        upload_date: options.uploadDate,
        duration: options.duration,
        sort_by: options.sortBy,
      },
    });
  }

  /** Every search hit, following `next_cursor`. */
  async *iterSearch(
    query: string,
    options: {
      type?: SearchType;
      limit?: number;
      uploadDate?: UploadDate;
      duration?: DurationFilter;
      sortBy?: SearchSort;
    } = {},
  ): AsyncGenerator<SearchItem> {
    yield* pages(
      (cursor) => this.search(query, { ...options, cursor }),
      (page) => page.items,
    );
  }

  /** Autocomplete strings. Costs 0 credits. */
  getSuggestions(query: string): Promise<Suggestions> {
    return this.request("GET", "/v1/search/suggestions", { query: { q: query } });
  }

  /** Start a batch of up to 100 tasks. Returns the job id; poll it with `pollBatch`. */
  createBatch(tasks: BatchTask[], options: { concurrency?: number } = {}): Promise<BatchSubmit> {
    const body: Record<string, unknown> = { tasks };
    if (options.concurrency !== undefined) body.concurrency = options.concurrency;
    // A 5xx or a dropped connection can come after the job was created, so a
    // retry could start a second batch. Only 429 (nothing was created) is
    // retried here.
    return this.request("POST", "/v1/batch", { json: body, retryServerErrors: false });
  }

  /** Status of a batch job. Free. */
  getBatch(jobId: string): Promise<BatchJob> {
    return this.request("GET", `/v1/batch/${seg(jobId)}`);
  }

  /** Poll until status is `completed` or `failed`, or `timeoutMs` passes. */
  async pollBatch(
    jobId: string,
    options: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<BatchJob> {
    const intervalMs = options.intervalMs ?? 1_000;
    const timeoutMs = options.timeoutMs ?? 120_000;
    const deadline = this.nowImpl() + timeoutMs;
    for (;;) {
      const job = await this.getBatch(jobId);
      if (job.status === "completed" || job.status === "failed") return job;
      if (this.nowImpl() >= deadline) {
        throw new Error(`Batch ${jobId} still ${String(job.status)} after ${timeoutMs} ms.`);
      }
      await this.sleepImpl(intervalMs);
    }
  }

  private async request(
    method: string,
    path: string,
    options: {
      query?: Record<string, unknown>;
      json?: Record<string, unknown>;
      asText?: boolean;
      retryServerErrors?: boolean;
    } = {},
  ): Promise<any> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json, text/plain, text/vtt, text/markdown",
      "User-Agent": USER_AGENT,
    };
    let body: string | undefined;
    if (options.json) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    }

    const retryServerErrors = options.retryServerErrors ?? true;
    let attempt = 0;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      let raw: string;
      try {
        response = await this.fetchImpl(url, { method, headers, body, signal: controller.signal });
        raw = await response.text();
      } catch (err) {
        const message = controller.signal.aborted
          ? `timed out after ${this.timeoutMs} ms`
          : err instanceof Error
            ? err.message
            : String(err);
        const error = new YTAPIError(`Request failed: ${message}`, { status: 0, retryable: true });
        if (attempt >= this.maxRetries || !retryServerErrors) throw error;
        await this.sleepImpl(this.backoffDelay(attempt));
        attempt += 1;
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 200 || response.status === 202) {
        if (options.asText) return raw;
        if (!raw) return {};
        try {
          return JSON.parse(raw);
        } catch {
          throw new YTAPIError(`Expected JSON from ${method} ${path}, got: ${raw.slice(0, 200)}`, {
            status: response.status,
            retryable: false,
          });
        }
      }

      const error = errorFrom(response.status, response.headers, raw);
      if (attempt >= this.maxRetries || !shouldRetry(error, retryServerErrors, this.maxRetryWaitMs)) {
        throw error;
      }
      let delay = this.backoffDelay(attempt);
      if (error.retryAfter !== undefined) delay = Math.max(delay, error.retryAfter * 1000);
      await this.sleepImpl(delay);
      attempt += 1;
    }
  }

  private backoffDelay(attempt: number): number {
    return Math.min(this.backoffCapMs, this.backoffMs * 2 ** attempt);
  }
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name];
}

function seg(value: string): string {
  return encodeURIComponent(value);
}

function shouldRetry(error: YTAPIError, retryServerErrors: boolean, maxRetryWaitMs: number): boolean {
  if (error.retryable === false) return false;
  if (error.status === 429) {
    if (error.code === DAILY_LIMIT_CODE) return false;
    return error.retryAfter === undefined || error.retryAfter * 1000 <= maxRetryWaitMs;
  }
  return retryServerErrors && error.status >= 500;
}

function errorFrom(status: number, headers: Headers, raw: string): YTAPIError {
  const retryAfterHeader = headers.get("retry-after");
  const retryAfter =
    retryAfterHeader !== null && retryAfterHeader !== "" && !Number.isNaN(Number(retryAfterHeader))
      ? Number(retryAfterHeader)
      : undefined;
  let message = raw;
  let code: string | undefined;
  let retryable: boolean | undefined;
  try {
    const payload = raw ? JSON.parse(raw) : {};
    const err = payload?.error;
    if (err && typeof err === "object") {
      if (typeof err.code === "string") code = err.code;
      if (typeof err.message === "string") message = err.message;
      if (typeof err.retryable === "boolean") retryable = err.retryable;
    }
  } catch {
    // Keep the raw body as the message.
  }
  const Kind = status >= 500 ? ServerError : (ERROR_TYPES[status] ?? YTAPIError);
  return new Kind(message, { status, code, retryable, retryAfter });
}

async function* pages<T, P extends { has_more?: boolean; next_cursor?: string | null }>(
  fetchPage: (cursor?: string) => Promise<P>,
  readItems: (page: P) => T[] | undefined,
): AsyncGenerator<T> {
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (;;) {
    const page = await fetchPage(cursor);
    yield* readItems(page) ?? [];
    // Stop on a repeated cursor rather than loop forever.
    if (!page.has_more || !page.next_cursor || seen.has(page.next_cursor)) return;
    seen.add(page.next_cursor);
    cursor = page.next_cursor;
  }
}
