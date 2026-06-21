/// Matches Rust Series struct
export interface Series {
  id: number;
  title: string;
  folder_name: string;
  display_name: string;
  search_term: string;
  type: "anime" | "tv" | "movie" | "unknown";
  poster_path: string | null;
  fanart_path: string | null;
  bangumi_id: number | null;
  tmdb_id: number | null;
  synopsis: string | null;
  year: number | null;
  genres: string | null; // JSON array string
  score: number | null; // 0–100 (Bangumi score 0-10 scaled ×10; TMDB vote_average scaled ×10)
  created_at: string;
  updated_at: string;
}

/// Matches Rust Episode struct
export interface Episode {
  id: number;
  series_id: number;
  season_number: number;
  episode_number: number;
  title: string | null;
  file_path: string;
  duration: number;
  subtitle_count: number;
  status: "ready" | "downloading" | "missing";
  watched_progress: number;
  watched_completed: number;
  created_at: string;
  updated_at: string;
}

/// Scan result from scanner
export interface SeriesScan {
  folder_name: string;
  display_name: string;
  search_term: string;
  poster_path: string | null;
  fanart_path: string | null;
  episodes: EpisodeScan[];
}

export interface EpisodeScan {
  file_path: string;
  file_name: string;
  episode_number: number;
  season_number: number;
  title: string | null;
  subtitle_count: number;
  status: string;
}

export interface ScanResult {
  series: SeriesScan[];
}

// ── Phase 2: Metadata ───────────────────────────────────────────────────────

/// Returned by fetch_metadata / match_anilist_id / match_tmdb_id
/// Mirrors Rust metadata::MetadataResult

export interface MetadataResult {
  title: string;
  series_type: "anime" | "tv" | "movie" | "unknown";
  bangumi_id: number | null;
  tmdb_id: number | null;
  synopsis: string | null;
  year: number | null;
  genres: string | null; // JSON array: ["Action","Fantasy"]
  poster_path: string | null;
  fanart_path: string | null;
  score: number | null;
  diagnostic: string | null;
}

/// Bangumi search result (for manual matching UI)
export interface BangumiSearchResult {
  id: number;
  name: string;
  name_cn: string;
  summary: string;
  air_date: string;
  images: {
    large: string | null;
    common: string | null;
    medium: string | null;
    small: string | null;
    grid: string | null;
  };
}

/// TMDB search result (for manual matching UI)
/// Mirrors Rust metadata::TmdbSearchResult

export interface TmdbSearchResult {
  id: number;
  name: string | null;
  title: string | null;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number | null;
  first_air_date: string | null;
  release_date: string | null;
  genre_ids: number[] | null;
  genres: { id: number; name: string }[] | null;
  media_type: string | null;
}
