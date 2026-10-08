import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AuthError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitedError,
  ServerError,
  YTAPI,
  YTAPIError,
} from "../dist/esm/index.js";

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function client(fetch, extra = {}) {
  return new YTAPI({
    apiKey: "test-key",
    fetch,
    sleep: async (ms) => {
      extra.slept?.push(ms);
    },
    now: extra.now ?? (() => extra.clock?.() ?? 0),
    maxRetries: extra.maxRetries,
    timeoutMs: extra.timeoutMs,
  });
}

function withEnv(values, fn) {
  const names = ["YTAPI_API_KEY", "YTAPI_KEY"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  Object.assign(process.env, values);
  try {
    fn();
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test("requires an API key", () => {
  withEnv({}, () => assert.throws(() => new YTAPI({}), /YTAPI_API_KEY/));
});

test("reads YTAPI_KEY from the environment", () => {
  withEnv({ YTAPI_KEY: "from-env" }, () => assert.equal(new YTAPI({}).apiKey, "from-env"));
});

test("prefers YTAPI_API_KEY", () => {
  withEnv({ YTAPI_API_KEY: "preferred", YTAPI_KEY: "fallback" }, () =>
    assert.equal(new YTAPI({}).apiKey, "preferred"),
  );
});

test("transcript posts every option and returns JSON", async () => {
  let captured;
  const api = client(async (url, init) => {
    captured = { url: String(url), ...init, body: JSON.parse(init.body) };
    return jsonResponse({
      video_id: "dQw4w9WgXcQ",
      language: "en",
      segments: [{ text: "hello", start: 0, end: 1 }],
    });
  });
  const transcript = await api.getTranscript("dQw4w9WgXcQ", {
    format: "segments",
    wordLevel: true,
    languages: ["es", "*"],
    trackPolicy: "asr_first",
  });
  assert.equal(captured.method, "POST");
  assert.equal(captured.url, "https://api.ytapi.dev/v1/transcripts");
  assert.equal(captured.headers.Authorization, "Bearer test-key");
  assert.deepEqual(captured.body, {
    video_id: "dQw4w9WgXcQ",
    format: "segments",
    word_level: true,
    languages: ["es", "*"],
    track_policy: "asr_first",
  });
  assert.equal(transcript.language, "en");
});

test("text formats return the document", async () => {
  const api = client(async () => new Response("WEBVTT\n\nhello\n", { status: 200 }));
  const text = await api.getTranscript("dQw4w9WgXcQ", { format: "vtt" });
  assert.equal(text, "WEBVTT\n\nhello\n");
});

test("srt is returned as text when the type is text/plain", async () => {
  const api = client(
    async () =>
      new Response("1\n00:00:00,000 --> 00:00:01,000\nhi\n", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
  );
  const text = await api.getTranscript("abc", { format: "srt" });
  assert.equal(text.startsWith("1\n"), true);
});

test("each read endpoint uses the documented path", async () => {
  const seen = [];
  const api = client(async (url, init) => {
    seen.push([init.method, String(url)]);
    return jsonResponse({ ok: true, videos: [], items: [], suggestions: [], playlists: [] });
  });
  await api.getBasicInfo("kCc8FmEb1nY");
  await api.getVideoInfo("kCc8FmEb1nY");
  await api.getPlaylist("PL123", { cursor: "c1" });
  await api.getChannel("@MrBeast");
  await api.getChannelLatest("@MrBeast");
  await api.listChannelVideos("@MrBeast", { sortBy: "popular", cursor: "v1" });
  await api.listChannelPlaylists("UCabcdef", { cursor: "p1" });
  await api.search("agents", {
    type: "video",
    limit: 10,
    cursor: "s1",
    uploadDate: "month",
    duration: "short",
    sortBy: "view_count",
  });
  await api.getSuggestions("next");
  await api.getBatch("batch_1");

  const paths = seen.map(([, url]) => url.split("?")[0]);
  assert.deepEqual(paths, [
    "https://api.ytapi.dev/v1/videos/kCc8FmEb1nY/basic-info",
    "https://api.ytapi.dev/v1/videos/kCc8FmEb1nY/video-info",
    "https://api.ytapi.dev/v1/playlists/PL123",
    "https://api.ytapi.dev/v1/channels/%40MrBeast",
    "https://api.ytapi.dev/v1/channels/%40MrBeast/latest",
    "https://api.ytapi.dev/v1/channels/%40MrBeast/videos",
    "https://api.ytapi.dev/v1/channels/UCabcdef/playlists",
    "https://api.ytapi.dev/v1/search",
    "https://api.ytapi.dev/v1/search/suggestions",
    "https://api.ytapi.dev/v1/batch/batch_1",
  ]);
  assert.equal(seen[2][1].includes("cursor=c1"), true);
  assert.equal(seen[5][1].includes("sort_by=popular"), true);
  assert.equal(seen[7][1].includes("upload_date=month"), true);
  assert.equal(seen.every(([method]) => method === "GET"), true);
});

test("batch create accepts 202 and sends concurrency", async () => {
  let body;
  const api = client(async (_url, init) => {
    body = JSON.parse(init.body);
    return jsonResponse({ id: "batch_1", status: "pending", total: 1 }, 202);
  });
  const job = await api.createBatch(
    [{ id: "t1", type: "transcript", video_id: "dQw4w9WgXcQ", format: "srt" }],
    { concurrency: 10 },
  );
  assert.equal(job.id, "batch_1");
  assert.equal(body.concurrency, 10);
});

test("typed errors are not retried", async () => {
  const cases = [
    [401, "unauthorized", AuthError],
    [402, "insufficient_credits", InsufficientCreditsError],
    [404, "captions_disabled", NotFoundError],
    [400, "invalid_request", YTAPIError],
    [403, "region_blocked", YTAPIError],
  ];
  for (const [status, code, Kind] of cases) {
    let calls = 0;
    const api = client(async () => {
      calls += 1;
      return jsonResponse({ error: { code, message: code } }, status);
    });
    await assert.rejects(api.getBasicInfo("abc"), (err) => {
      assert.ok(err instanceof Kind);
      assert.equal(err.code, code);
      assert.equal(err.status, status);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("429 retries then raises with Retry-After", async () => {
  const slept = [];
  let calls = 0;
  const api = client(
    async () => {
      calls += 1;
      return jsonResponse({ error: { code: "rate_limited", message: "slow down" } }, 429, {
        "retry-after": "3",
      });
    },
    { slept },
  );
  await assert.rejects(api.getBasicInfo("abc"), (err) => {
    assert.ok(err instanceof RateLimitedError);
    assert.equal(err.retryAfter, 3);
    return true;
  });
  assert.equal(calls, 3);
  assert.deepEqual(slept, [3000, 3000]);
});

test("5xx stops when retryable is false", async () => {
  let calls = 0;
  const slept = [];
  const api = client(
    async () => {
      calls += 1;
      return jsonResponse(
        { error: { code: "upstream_error", message: "no", retryable: false } },
        503,
      );
    },
    { slept },
  );
  await assert.rejects(api.getBasicInfo("abc"), ServerError);
  assert.equal(calls, 1);
  assert.deepEqual(slept, []);
});

test("5xx retries until success", async () => {
  const slept = [];
  let calls = 0;
  const api = client(
    async () => {
      calls += 1;
      if (calls < 3) {
        return jsonResponse(
          { error: { code: "upstream_error", message: "later", retryable: true } },
          500,
        );
      }
      return jsonResponse({ title: "ok" });
    },
    { slept },
  );
  const info = await api.getBasicInfo("abc");
  assert.equal(info.title, "ok");
  assert.deepEqual(slept, [500, 1000]);
});

test("retries can be switched off", async () => {
  let calls = 0;
  const api = client(
    async () => {
      calls += 1;
      return jsonResponse({ error: { code: "upstream_error", message: "later", retryable: true } }, 500);
    },
    { maxRetries: 0, slept: [] },
  );
  await assert.rejects(api.getBasicInfo("abc"), ServerError);
  assert.equal(calls, 1);
});

test("network errors are retried then thrown", async () => {
  const slept = [];
  let calls = 0;
  const api = client(
    async () => {
      calls += 1;
      throw new Error("connection refused");
    },
    { slept },
  );
  await assert.rejects(api.getBasicInfo("abc"), (err) => {
    assert.ok(err instanceof YTAPIError);
    assert.equal(err.status, 0);
    assert.equal(err.retryable, true);
    return true;
  });
  assert.equal(calls, 3);
  assert.deepEqual(slept, [500, 1000]);
});

test("a network error then success", async () => {
  let calls = 0;
  const api = client(async () => {
    calls += 1;
    if (calls === 1) throw new Error("socket hang up");
    return jsonResponse({ video_id: "abc" });
  });
  assert.deepEqual(await api.getBasicInfo("abc"), { video_id: "abc" });
});

test("a timeout says so", async () => {
  const api = client(
    (url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("This operation was aborted")));
      }),
    { maxRetries: 0, timeoutMs: 10 },
  );
  await assert.rejects(api.getBasicInfo("abc"), /timed out after 10 ms/);
});

test("batch create retries a network error with the same key", async () => {
  const keys = [];
  let calls = 0;
  const api = client(async (url, init) => {
    keys.push(init.headers["Idempotency-Key"]);
    calls += 1;
    if (calls === 1) throw new Error("socket hang up");
    return jsonResponse({ id: "job1", status: "pending" }, 202);
  });
  const job = await api.createBatch([{ type: "transcript", video_id: "abc" }]);
  assert.equal(job.id, "job1");
  assert.equal(keys.length, 2);
  assert.match(keys[0], /^[0-9a-f-]{36}$/);
  assert.equal(keys[0], keys[1]);
});

test("batch create uses the given key and a new key per call", async () => {
  const keys = [];
  const api = client(async (url, init) => {
    keys.push(init.headers["Idempotency-Key"]);
    return jsonResponse({ id: "job1" }, 202);
  });
  const task = [{ type: "transcript", video_id: "abc" }];
  await api.createBatch(task, { idempotencyKey: "order-42" });
  await api.createBatch(task);
  await api.createBatch(task);
  assert.equal(keys[0], "order-42");
  assert.notEqual(keys[1], keys[2]);
});

test("the daily limit is thrown without waiting", async () => {
  const slept = [];
  let calls = 0;
  const api = client(
    async () => {
      calls += 1;
      return jsonResponse(
        { error: { code: "daily_limit_exceeded", message: "100 requests a day", retryable: true } },
        429,
        { "retry-after": "43200" },
      );
    },
    { slept },
  );
  await assert.rejects(api.getBasicInfo("abc"), (err) => {
    assert.ok(err instanceof RateLimitedError);
    assert.equal(err.code, "daily_limit_exceeded");
    assert.equal(err.retryAfter, 43200);
    return true;
  });
  assert.equal(calls, 1);
  assert.deepEqual(slept, []);
});

test("a 429 with a long Retry-After is thrown", async () => {
  const slept = [];
  let calls = 0;
  const api = client(
    async () => {
      calls += 1;
      return jsonResponse({ error: { code: "rate_limited", message: "slow down" } }, 429, {
        "retry-after": "120",
      });
    },
    { slept },
  );
  await assert.rejects(api.getBasicInfo("abc"), RateLimitedError);
  assert.equal(calls, 1);
  assert.deepEqual(slept, []);
});

test("a non-JSON success body throws a clear error", async () => {
  const api = client(async () => new Response("<html>proxy page</html>", { status: 200 }));
  await assert.rejects(api.getBasicInfo("abc"), /Expected JSON/);
});

test("iterators stop on a repeated cursor", async () => {
  let calls = 0;
  const api = client(async () => {
    calls += 1;
    return jsonResponse({ has_more: true, next_cursor: "same", videos: [{ video_id: "a" }] });
  });
  const videos = [];
  for await (const video of api.iterPlaylistVideos("PL1")) videos.push(video);
  assert.equal(calls, 2);
  assert.equal(videos.length, 2);
});

test("playlist iterator follows the cursor and stops", async () => {
  const pages = [
    { title: "Demo", has_more: true, next_cursor: "page-2", videos: [{ video_id: "aaaaaaaaaaa" }] },
    { has_more: false, next_cursor: null, videos: [{ video_id: "bbbbbbbbbbb" }] },
  ];
  const seen = [];
  const api = client(async (url) => {
    seen.push(String(url));
    return jsonResponse(pages.shift());
  });
  const ids = [];
  for await (const video of api.iterPlaylistVideos("PLdemo")) ids.push(video.video_id);
  assert.deepEqual(ids, ["aaaaaaaaaaa", "bbbbbbbbbbb"]);
  assert.equal(seen[0].includes("cursor"), false);
  assert.equal(seen[1].includes("cursor=page-2"), true);
});

test("search and channel iterators use the item keys", async () => {
  const api = client(async (url) => {
    if (String(url).startsWith("https://api.ytapi.dev/v1/search?")) {
      return jsonResponse({ has_more: false, items: [{ id: "vid", type: "video" }] });
    }
    return jsonResponse({
      has_more: false,
      videos: [{ video_id: "vid", title: "upload" }],
      playlists: [{ playlist_id: "PLx", title: "list" }],
    });
  });
  const hits = [];
  for await (const item of api.iterSearch("q", { type: "playlist" })) hits.push(item);
  const uploads = [];
  for await (const video of api.iterChannelVideos("@c", { sortBy: "oldest" })) uploads.push(video);
  const lists = [];
  for await (const playlist of api.iterChannelPlaylists("@c")) lists.push(playlist);
  assert.equal(hits[0].id, "vid");
  assert.equal(uploads[0].title, "upload");
  assert.equal(lists[0].playlist_id, "PLx");
});

test("pollBatch returns when the job finishes", async () => {
  const statuses = ["pending", "processing", "completed"];
  const slept = [];
  let now = 0;
  const api = client(
    async () => jsonResponse({ id: "batch_1", status: statuses.shift(), successful: 1, total: 1 }),
    {
      slept,
      now: () => {
        now += 1000;
        return now;
      },
    },
  );
  const job = await api.pollBatch("batch_1", { intervalMs: 1000, timeoutMs: 10_000 });
  assert.equal(job.status, "completed");
  assert.deepEqual(slept, [1000, 1000]);
});

test("pollBatch times out", async () => {
  let now = 0;
  const api = client(async () => jsonResponse({ id: "batch_1", status: "processing" }), {
    slept: [],
    now: () => {
      now += 5000;
      return now;
    },
  });
  await assert.rejects(api.pollBatch("batch_1", { intervalMs: 1000, timeoutMs: 3000 }), /still/);
});

test("the CommonJS build loads", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const loaded = require("../dist/cjs/index.js");
  assert.equal(typeof loaded.YTAPI, "function");
  assert.equal(loaded.NotFoundError.name, "NotFoundError");
});

test("batch create retries 429 and 5xx", async () => {
  let calls = 0;
  const failing = client(async () => {
    calls += 1;
    return jsonResponse({ error: { code: "upstream_error", message: "try again" } }, 503);
  });
  await assert.rejects(failing.createBatch([{ type: "transcript", video_id: "abc" }]), ServerError);
  assert.equal(calls, 3); // 1 try + maxRetries; safe because every attempt carries the same key

  const replies = [
    jsonResponse({ error: { code: "rate_limited", message: "slow down" } }, 429),
    jsonResponse({ id: "job1", status: "pending" }, 202),
  ];
  const limited = client(async () => replies.shift());
  const job = await limited.createBatch([{ type: "transcript", video_id: "abc" }]);
  assert.equal(job.id, "job1");
});
