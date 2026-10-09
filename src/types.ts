/** Response shapes documented at https://docs.ytapi.dev. Unknown keys are preserved. */

export type TranscriptFormat =
  | "segments"
  | "word_timestamps"
  | "sentences"
  | "markdown"
  | "text"
  | "srt"
  | "vtt"
  | "json3";

export type TrackPolicy = "manual_first" | "asr_first" | "exact_only";

/** `shorts` is in the OpenAPI spec. `movie` is in the docs. Both are accepted. */
export type SearchType = "video" | "channel" | "playlist" | "shorts" | "movie";

export type SortBy = "newest" | "popular" | "oldest";
export type UploadDate = "hour" | "today" | "week" | "month" | "year";
export type DurationFilter = "short" | "medium" | "long";
export type SearchSort = "relevance" | "rating" | "upload_date" | "view_count";

export interface Thumbnail {
  url?: string;
  width?: number;
  height?: number;
}

export interface Word {
  word?: string;
  start?: number;
  end?: number;
}

export interface Segment {
  text: string;
  start: number;
  end: number;
  duration?: number;
  words?: Word[];
}

export interface Transcript {
  video_id: string;
  language: string;
  track_kind?: "manual" | "asr";
  duration_seconds?: number;
  has_word_level?: boolean;
  segments: Segment[];
}

export interface CaptionLanguage {
  code?: string;
  name?: string;
  kind?: string;
}

export interface VideoBasicInfo {
  video_id?: string;
  title?: string;
  length_seconds?: number;
  channel?: { id?: string; title?: string; url?: string };
  available_languages?: CaptionLanguage[];
}

export interface Chapter {
  title?: string;
  start_time_seconds?: number;
  time_description?: string;
}

export interface DescriptionLink {
  text?: string;
  url?: string;
}

export interface MusicTrack {
  title?: string;
  artist?: string;
  album?: string;
}

export interface RelatedVideo {
  video_id?: string;
  title?: string;
  channel_title?: string;
  channel_id?: string;
  length_text?: string;
  view_count_text?: string;
  published_text?: string;
}

export interface VideoInfo {
  video_id?: string;
  title?: string;
  description?: string;
  length_seconds?: number;
  view_count?: number;
  like_count?: number;
  /** Rounded by YouTube ("3.3K" is 3300); omitted when comments are off. */
  comment_count?: number;
  comment_count_text?: string;
  published?: number;
  keywords?: string[];
  is_live?: boolean;
  /** A scheduled live stream or premiere that hasn't started. */
  is_upcoming?: boolean;
  is_live_content?: boolean;
  /** Unix start time of an upcoming stream or premiere. */
  scheduled_start?: number;
  channel?: {
    id?: string;
    title?: string;
    url?: string;
    subscribers?: string;
    /** `subscribers` as an approximate number. */
    subscriber_count?: number;
    is_verified?: boolean;
    avatar_url?: string;
  };
  thumbnails?: Thumbnail[];
  available_languages?: CaptionLanguage[];
  chapters?: Chapter[];
  /** YouTube's own AI summary, when it shows one. */
  ai_summary?: string;
  /** YouTube's "How this was made" note. */
  content_disclosure?: string;
  hashtags?: string[];
  links?: DescriptionLink[];
  music?: MusicTrack[];
  /** Up to 20 videos YouTube suggests next to this one. */
  related?: RelatedVideo[];
}

export interface PlaylistVideo {
  video_id?: string;
  title?: string;
  index?: number;
  length_seconds?: number;
  length_text?: string;
  author?: string;
}

export interface PlaylistPage {
  playlist_id?: string;
  title?: string;
  video_count?: number;
  view_count_text?: string;
  author?: string;
  thumbnails?: Thumbnail[];
  videos?: PlaylistVideo[];
  has_more?: boolean;
  next_cursor?: string | null;
}

export interface Channel {
  channel_id?: string;
  title?: string;
  handle?: string;
  description?: string;
  subscriber_count?: number;
  subscriber_count_text?: string;
  custom_url?: string;
  country?: string;
  video_count?: number;
  verified?: boolean;
  thumbnails?: Thumbnail[];
  banners?: Thumbnail[];
  links?: string[];
  available_tabs?: string[];
}

export interface ChannelVideo {
  video_id?: string;
  title?: string;
  length_text?: string;
  view_count_text?: string;
  published_text?: string;
  thumbnails?: Thumbnail[];
}

export interface ChannelLatest {
  channel_id?: string;
  channel_title?: string;
  latest_video?: ChannelVideo;
  recent_videos?: ChannelVideo[];
}

export interface ChannelVideosPage {
  channel_id?: string;
  channel_title?: string;
  has_more?: boolean;
  next_cursor?: string | null;
  continuation?: string | null;
  videos?: ChannelVideo[];
}

export interface ChannelPlaylist {
  playlist_id?: string;
  title?: string;
  video_count?: number;
  video_count_text?: string;
  thumbnails?: Thumbnail[];
}

export interface ChannelPlaylistsPage {
  playlists?: ChannelPlaylist[];
  has_more?: boolean;
  next_cursor?: string | null;
}

export interface SearchItem {
  id?: string;
  type?: string;
  title?: string;
  description?: string;
  author?: string;
  channel_id?: string;
  length_seconds?: number;
  length_text?: string;
  view_count_text?: string;
  published_text?: string;
  thumbnails?: Thumbnail[];
  handle?: string;
  subscriber_count_text?: string;
  video_count_text?: string;
  badges?: string[];
}

export interface SearchPage {
  query?: string;
  type?: string;
  has_more?: boolean;
  next_cursor?: string | null;
  items?: SearchItem[];
}

export interface Suggestions {
  query?: string;
  suggestions?: string[];
}

export interface BatchTask {
  id?: string;
  type: "transcript" | "basic_info";
  video_id: string;
  format?: TranscriptFormat;
  languages?: string[];
  track_policy?: TrackPolicy;
  word_level?: boolean;
}

export interface BatchSubmit {
  id?: string;
  status?: string;
  total?: number;
  estimated_credits?: number;
  created_at?: string;
}

export interface BatchTaskResult {
  id?: string;
  type?: string;
  video_id?: string;
  status?: number;
  data?: unknown;
  error?: { code?: string; message?: string };
}

export interface BatchJob {
  id?: string;
  status?: string;
  total?: number;
  successful?: number;
  failed?: number;
  credits_deducted?: number;
  duration_ms?: number;
  results?: BatchTaskResult[];
  created_at?: string;
  completed_at?: string | null;
}

export interface ClientOptions {
  /** Defaults to the YTAPI_API_KEY environment variable, then YTAPI_KEY. */
  apiKey?: string;
  /** Defaults to https://api.ytapi.dev */
  baseUrl?: string;
  timeoutMs?: number;
  /** Extra attempts after the first. 0 disables retries. Default 2. */
  maxRetries?: number;
  /** First retry delay in milliseconds. Default 500. */
  backoffMs?: number;
  /** Cap on the exponential delay. Default 8000. */
  backoffCapMs?: number;
  /** A 429 asking to wait longer than this is thrown, not waited out. Default 60000. */
  maxRetryWaitMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}
