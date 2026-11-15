/// <reference path="./online-streaming-provider.d.ts" />

class Provider {
  private simklClientId = "{{simklClientId}}";
  private addonBaseUrl = "{{addonBaseUrl}}".replace(/\/manifest\.json\/?$/, "").replace(/\/$/, "");

  getSettings(): Settings {
    return {
      episodeServers: ["Auto (Best Quality)", "Server 1", "Server 2", "Server 3"],
      supportsDub: true,
    };
  }

  // 1. Search Simkl to resolve the show's IMDb ID (e.g., tt0373732 for The Boondocks)
  async search(opts: SearchOptions): Promise<SearchResult[]> {
    const query = encodeURIComponent(opts.query);
    const res = await fetch(
      `https://api.simkl.com/search/tv?q=${query}&extended=full&client_id=${this.simklClientId}`
    );

    if (!res.ok) return [];
    const items = await res.json();

    return items
      .filter((item: any) => item.ids?.imdb)
      .map((item: any) => ({
        id: item.ids.imdb, // e.g. "tt0373732"
        title: item.title,
        url: `https://www.imdb.com/title/${item.ids.imdb}`,
        subOrDub: "dub",
      }));
  }

  // 2. Fetch season & episode structure from Cinemeta using the IMDb ID
  async findEpisodes(imdbId: string): Promise<EpisodeDetails[]> {
    const res = await fetch(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`);
    if (!res.ok) return [];

    const data = await res.json();
    const videos = data?.meta?.videos || [];

    // Filter out Season 0 specials and build sequential episode list
    const regularEpisodes = videos.filter((v: any) => v.season > 0 && v.episode > 0);

    return regularEpisodes.map((v: any, index: number) => ({
      id: `${imdbId}:${v.season}:${v.episode}`, // Format required by Stremio stream addons
      number: index + 1,
      url: `https://www.imdb.com/title/${imdbId}`,
      title: `S${v.season}E${v.episode} - ${v.name || v.title || `Episode ${v.episode}`}`,
    }));
  }

  // 3. Query your configured Stremio HTTP addon for direct MP4/M3U8 links
  async findEpisodeServer(
    episode: EpisodeDetails,
    _server: string
  ): Promise<EpisodeServer> {
    const streamUrl = `${this.addonBaseUrl}/stream/series/${episode.id}.json`;
    const res = await fetch(streamUrl);

    if (!res.ok) {
      throw new Error(`Addon returned status ${res.status}`);
    }

    const data = await res.json();
    const streams = (data?.streams || []).filter((s: any) => s.url);

    if (streams.length === 0) {
      throw new Error("No direct HTTP streams found for this episode.");
    }

    // Pick stream index based on selected server tab
    let selectedIndex = 0;
    if (_server === "Server 2" && streams.length > 1) selectedIndex = 1;
    if (_server === "Server 3" && streams.length > 2) selectedIndex = 2;

    const chosen = streams[selectedIndex] || streams[0];
    const requestHeaders = chosen.behaviorHints?.proxyHeaders?.request || {};

    return {
      server: _server || "Auto (Best Quality)",
      headers: {
        "User-Agent": requestHeaders["User-Agent"] || "Mozilla/5.0",
        ...(requestHeaders["Referer"] ? { Referer: requestHeaders["Referer"] } : {}),
      },
      videoSources: streams.map((s: any, idx: number) => ({
        url: s.url,
        type: s.url.includes(".m3u8") ? "m3u8" : "mp4",
        quality: s.name || s.title?.split("\n")[0] || `Stream ${idx + 1}`,
        subtitles: (s.subtitles || []).map((sub: any, sIdx: number) => ({
          id: String(sIdx),
          url: sub.url,
          language: sub.lang || "en",
          isDefault: sub.lang === "eng" || sub.lang === "en",
        })),
      })),
    };
  }
}
