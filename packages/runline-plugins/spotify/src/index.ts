import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.spotify.com/v1";

async function api(
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (res.status === 204) return { success: true };
  if (!res.ok)
    throw new Error(`Spotify error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : { success: true };
}

function stripUri(uri: string, prefix: string): string {
  return uri.replace(prefix, "");
}

export default function spotify(rl: RunlinePluginAPI) {
  rl.setName("spotify");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Spotify OAuth2 access token",
      env: "SPOTIFY_ACCESS_TOKEN",
    },
  });
  const t = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.accessToken as string;

  // ── Player ──────────────────────────────────────────

  rl.registerAction("player.pause", {
    access: "write",
    description: "Pause playback",
    inputSchema: {},
    async execute(_i, ctx) {
      return api(t(ctx), "PUT", "/me/player/pause");
    },
  });

  rl.registerAction("player.resume", {
    access: "write",
    description: "Resume playback",
    inputSchema: {},
    async execute(_i, ctx) {
      return api(t(ctx), "PUT", "/me/player/play");
    },
  });

  rl.registerAction("player.next", {
    access: "write",
    description: "Skip to next track",
    inputSchema: {},
    async execute(_i, ctx) {
      return api(t(ctx), "POST", "/me/player/next");
    },
  });

  rl.registerAction("player.previous", {
    access: "write",
    description: "Skip to previous track",
    inputSchema: {},
    async execute(_i, ctx) {
      return api(t(ctx), "POST", "/me/player/previous");
    },
  });

  rl.registerAction("player.currentlyPlaying", {
    access: "read",
    description: "Get currently playing track",
    inputSchema: {},
    async execute(_i, ctx) {
      return api(t(ctx), "GET", "/me/player/currently-playing");
    },
  });

  rl.registerAction("player.recentlyPlayed", {
    access: "read",
    description: "Get recently played tracks",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit)
        qs.limit = (input as Record<string, unknown>).limit;
      const data = (await api(
        t(ctx),
        "GET",
        "/me/player/recently-played",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.items;
    },
  });

  rl.registerAction("player.addToQueue", {
    access: "write",
    description: "Add a track to the queue",
    inputSchema: {
      uri: { type: "string", required: true, description: "Track URI or ID" },
    },
    async execute(input, ctx) {
      return api(t(ctx), "POST", "/me/player/queue", undefined, {
        uri: (input as Record<string, unknown>).uri,
      });
    },
  });

  rl.registerAction("player.setVolume", {
    access: "write",
    description: "Set playback volume",
    inputSchema: {
      volumePercent: { type: "number", required: true, description: "0-100" },
    },
    async execute(input, ctx) {
      return api(t(ctx), "PUT", "/me/player/volume", undefined, {
        volume_percent: (input as Record<string, unknown>).volumePercent,
      });
    },
  });

  rl.registerAction("player.startMusic", {
    access: "write",
    description: "Start playing an album, artist, or playlist",
    inputSchema: {
      contextUri: {
        type: "string",
        required: true,
        description: "Spotify URI (e.g. spotify:album:...)",
      },
    },
    async execute(input, ctx) {
      return api(t(ctx), "PUT", "/me/player/play", {
        context_uri: (input as Record<string, unknown>).contextUri,
      });
    },
  });

  // ── Album ───────────────────────────────────────────

  rl.registerAction("album.get", {
    access: "read",
    description: "Get an album",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        t(ctx),
        "GET",
        `/albums/${stripUri((input as Record<string, unknown>).id as string, "spotify:album:")}`,
      );
    },
  });

  rl.registerAction("album.getTracks", {
    access: "read",
    description: "Get an album's tracks",
    inputSchema: {
      id: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      const data = (await api(
        t(ctx),
        "GET",
        `/albums/${stripUri(p.id as string, "spotify:album:")}/tracks`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.items;
    },
  });

  rl.registerAction("album.getNewReleases", {
    access: "read",
    description: "Get new album releases",
    inputSchema: {
      limit: { type: "number", required: false },
      country: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      if (p.country) qs.country = p.country;
      const data = (await api(
        t(ctx),
        "GET",
        "/browse/new-releases",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return (data.albums as Record<string, unknown>).items;
    },
  });

  rl.registerAction("album.search", {
    access: "read",
    description: "Search albums",
    inputSchema: {
      query: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { q: p.query, type: "album" };
      if (p.limit) qs.limit = p.limit;
      else qs.limit = 50;
      const data = (await api(
        t(ctx),
        "GET",
        "/search",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return (data.albums as Record<string, unknown>).items;
    },
  });

  // ── Artist ──────────────────────────────────────────

  rl.registerAction("artist.get", {
    access: "read",
    description: "Get an artist",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        t(ctx),
        "GET",
        `/artists/${stripUri((input as Record<string, unknown>).id as string, "spotify:artist:")}`,
      );
    },
  });

  rl.registerAction("artist.getAlbums", {
    access: "read",
    description: "Get an artist's albums",
    inputSchema: {
      id: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      const data = (await api(
        t(ctx),
        "GET",
        `/artists/${stripUri(p.id as string, "spotify:artist:")}/albums`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.items;
    },
  });

  rl.registerAction("artist.getRelatedArtists", {
    access: "read",
    description: "Get related artists",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await api(
        t(ctx),
        "GET",
        `/artists/${stripUri((input as Record<string, unknown>).id as string, "spotify:artist:")}/related-artists`,
      )) as Record<string, unknown>;
      return data.artists;
    },
  });

  rl.registerAction("artist.getTopTracks", {
    access: "read",
    description: "Get an artist's top tracks",
    inputSchema: {
      id: { type: "string", required: true },
      country: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await api(
        t(ctx),
        "GET",
        `/artists/${stripUri(p.id as string, "spotify:artist:")}/top-tracks`,
        undefined,
        { country: p.country },
      )) as Record<string, unknown>;
      return data.tracks;
    },
  });

  rl.registerAction("artist.search", {
    access: "read",
    description: "Search artists",
    inputSchema: {
      query: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {
        q: p.query,
        type: "artist",
        limit: p.limit ?? 50,
      };
      const data = (await api(
        t(ctx),
        "GET",
        "/search",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return (data.artists as Record<string, unknown>).items;
    },
  });

  // ── Playlist ────────────────────────────────────────

  rl.registerAction("playlist.get", {
    access: "read",
    description: "Get a playlist",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        t(ctx),
        "GET",
        `/playlists/${stripUri((input as Record<string, unknown>).id as string, "spotify:playlist:")}`,
      );
    },
  });

  rl.registerAction("playlist.getTracks", {
    access: "read",
    description: "Get a playlist's tracks",
    inputSchema: {
      id: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      const data = (await api(
        t(ctx),
        "GET",
        `/playlists/${stripUri(p.id as string, "spotify:playlist:")}/tracks`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.items;
    },
  });

  rl.registerAction("playlist.create", {
    access: "write",
    description: "Create a playlist",
    inputSchema: {
      name: { type: "string", required: true },
      description: { type: "string", required: false },
      public: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      return api(
        t(ctx),
        "POST",
        "/me/playlists",
        input as Record<string, unknown>,
      );
    },
  });

  rl.registerAction("playlist.addTrack", {
    access: "write",
    description: "Add a track to a playlist",
    inputSchema: {
      id: { type: "string", required: true },
      trackUri: { type: "string", required: true },
      position: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { uris: p.trackUri };
      if (p.position !== undefined) qs.position = p.position;
      return api(
        t(ctx),
        "POST",
        `/playlists/${stripUri(p.id as string, "spotify:playlist:")}/tracks`,
        {},
        qs,
      );
    },
  });

  rl.registerAction("playlist.removeTrack", {
    access: "write",
    description: "Remove a track from a playlist",
    inputSchema: {
      id: { type: "string", required: true },
      trackUri: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(
        t(ctx),
        "DELETE",
        `/playlists/${stripUri(p.id as string, "spotify:playlist:")}/tracks`,
        { tracks: [{ uri: p.trackUri }] },
      );
    },
  });

  rl.registerAction("playlist.listMine", {
    access: "read",
    description: "Get the current user's playlists",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit)
        qs.limit = (input as Record<string, unknown>).limit;
      const data = (await api(
        t(ctx),
        "GET",
        "/me/playlists",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.items;
    },
  });

  rl.registerAction("playlist.search", {
    access: "read",
    description: "Search playlists",
    inputSchema: {
      query: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {
        q: p.query,
        type: "playlist",
        limit: p.limit ?? 50,
      };
      const data = (await api(
        t(ctx),
        "GET",
        "/search",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return (data.playlists as Record<string, unknown>).items;
    },
  });

  // ── Track ───────────────────────────────────────────

  rl.registerAction("track.get", {
    access: "read",
    description: "Get a track",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        t(ctx),
        "GET",
        `/tracks/${stripUri((input as Record<string, unknown>).id as string, "spotify:track:")}`,
      );
    },
  });

  rl.registerAction("track.getAudioFeatures", {
    access: "read",
    description: "Get audio features for a track",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        t(ctx),
        "GET",
        `/audio-features/${stripUri((input as Record<string, unknown>).id as string, "spotify:track:")}`,
      );
    },
  });

  rl.registerAction("track.search", {
    access: "read",
    description: "Search tracks",
    inputSchema: {
      query: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {
        q: p.query,
        type: "track",
        limit: p.limit ?? 50,
      };
      const data = (await api(
        t(ctx),
        "GET",
        "/search",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return (data.tracks as Record<string, unknown>).items;
    },
  });

  // ── Library ─────────────────────────────────────────

  rl.registerAction("library.getLikedTracks", {
    access: "read",
    description: "Get liked tracks",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit)
        qs.limit = (input as Record<string, unknown>).limit;
      const data = (await api(
        t(ctx),
        "GET",
        "/me/tracks",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.items;
    },
  });

  // ── My Data ─────────────────────────────────────────

  rl.registerAction("myData.getFollowingArtists", {
    access: "read",
    description: "Get followed artists",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = { type: "artist" };
      if ((input as Record<string, unknown>)?.limit)
        qs.limit = (input as Record<string, unknown>).limit;
      const data = (await api(
        t(ctx),
        "GET",
        "/me/following",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return (data.artists as Record<string, unknown>).items;
    },
  });
}
