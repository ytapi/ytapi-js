# YTAPI JavaScript client

JavaScript and TypeScript client for [YTAPI](https://ytapi.dev?utm_source=github): YouTube transcripts, video details, search, channels and playlists over one HTTP API. It works from servers, serverless functions and edge runtimes, where fetching YouTube directly tends to get blocked.

- No runtime dependencies. Node 18+ (tested), and other runtimes with `fetch`, such as Bun, Deno or Cloudflare Workers (pass `apiKey` where there is no `process.env`). ESM and CommonJS.
- Full TypeScript types, typed errors, automatic retries and async iterators for paging.
- Reference: [docs.ytapi.dev](https://docs.ytapi.dev).

## Install

```bash
npm install ytapi
```

## Quickstart

Get a key at [ytapi.dev](https://ytapi.dev/app/api-keys?utm_source=github). New accounts get 200 free credits, and no card is needed.

```ts
import { YTAPI } from "ytapi";

const api = new YTAPI(); // reads YTAPI_API_KEY (or YTAPI_KEY) from the environment
const transcript = await api.getTranscript("dQw4w9WgXcQ");
if (typeof transcript !== "string") {
  for (const segment of transcript.segments?.slice(0, 3) ?? []) {
    console.log(segment.start, segment.text);
  }
}
```

By default you get the captions in the video's own language, as timed segments. A successful request uses 1 credit, and errors are free.

CommonJS: `const { YTAPI } = require("ytapi");`

Keep the client on the server. An API key in browser code is visible to every visitor.

## Examples

```ts
// Other formats. markdown, text, srt and vtt come back as a string.
const srt = await api.getTranscript("dQw4w9WgXcQ", { format: "srt" });
const spanish = await api.getTranscript("dQw4w9WgXcQ", { format: "text", languages: ["es", "*"] });
const words = await api.getTranscript("dQw4w9WgXcQ", { format: "word_timestamps", wordLevel: true });

// Free: title, length, channel and the caption languages a video has.
const basic = await api.getBasicInfo("dQw4w9WgXcQ");
// 1 credit: description, counts, chapters and more.
const info = await api.getVideoInfo("dQw4w9WgXcQ");

// Channels take an @handle, a channel ID (UC...) or a URL.
const channel = await api.getChannel("@3blue1brown");
for await (const video of api.iterChannelVideos("@3blue1brown", { sortBy: "popular" })) {
  console.log(video.video_id, video.title);
}

// Playlists, page by page or as an async iterator.
for await (const video of api.iterPlaylistVideos("PLZHQObOWTQDNU6R1_67000Dx_ZCJB-3pi")) {
  console.log(video.video_id, video.length_text);
}

// Search: type is video, channel, playlist, shorts or movie.
const page = await api.search("rust async", { type: "video", uploadDate: "month", limit: 10 });
for (const hit of page.items ?? []) console.log(hit.title);

// Search suggestions are free.
console.log((await api.getSuggestions("nextjs")).suggestions);

// Batch: up to 100 transcript or basic_info tasks per job.
const job = await api.createBatch([
  { id: "a", type: "transcript", video_id: "dQw4w9WgXcQ", format: "text" },
  { id: "b", type: "basic_info", video_id: "jNQXAC9IVRw" },
]);
const done = await api.pollBatch(job.id!, { timeoutMs: 120_000 });
console.log(done.successful, done.credits_deducted);
```

The iterators (`iterPlaylistVideos`, `iterChannelVideos`, `iterChannelPlaylists`, `iterSearch`) follow `next_cursor` for you. Each page is a request and uses a credit. In a batch, each successful task uses 1 credit and failed tasks are free.

## Errors

```ts
import { InsufficientCreditsError, NotFoundError, RateLimitedError, YTAPIError } from "ytapi";

try {
  await api.getTranscript("xxxxxxxxxxx");
} catch (err) {
  if (err instanceof NotFoundError) {
    console.log(err.code); // captions_disabled, language_not_found, video_unavailable, ...
  } else if (err instanceof RateLimitedError) {
    console.log(err.code, err.retryAfter); // rate_limited or daily_limit_exceeded
  } else if (err instanceof InsufficientCreditsError) {
    console.log("Out of credits: https://ytapi.dev/#pricing");
  } else if (err instanceof YTAPIError) {
    console.log(err.status, err.code, err.message); // status 0 means a network error
  }
}
```

| Status | Error |
| --- | --- |
| 401 | `AuthError` |
| 402 | `InsufficientCreditsError` |
| 404 | `NotFoundError` |
| 429 | `RateLimitedError` |
| 5xx | `ServerError` |
| network error or timeout | `YTAPIError` with `status` 0 |
| other | `YTAPIError` |

## Retries

The client retries a 429, a 5xx or a network error up to `maxRetries` times (default 2). It backs off from 500 ms, doubling up to 8 seconds, and waits longer when the server sends `Retry-After`. A few cases are not retried:

- **A 429 that asks for a long wait.** The cutoff is `maxRetryWaitMs`, default 60 seconds. This includes a free account's daily limit (`daily_limit_exceeded`), which lasts until 00:00 UTC. The client throws these right away instead of hanging your program.
- **Creating a batch after a 5xx or a network error.** The job may already exist, so a retry could start a second one.

Use `new YTAPI({ maxRetries: 0 })` to turn retries off, and `timeoutMs` (default 30 seconds) to set the per-request timeout.

## Tests

```bash
npm install
npm test
```

The tests mock `fetch` and need no network or API key.

## Releases

The package is published to npm as [`ytapi`](https://www.npmjs.com/package/ytapi). Versions follow semver, and each one has a matching GitHub release.

## License

MIT
