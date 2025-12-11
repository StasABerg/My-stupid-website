import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Station, useFavorites, useStations } from "../hooks/useStations";

const API_BASE = "/api/radio";
const FALLBACK_STREAM = "https://stream-relay-geo.ntslive.net/stream";

const buildShareLink = (id: string) => `${window.location.origin}/radio?station=${encodeURIComponent(id)}`;

const Radio = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<null | { destroy: () => void }>(null);
  const [active, setActive] = useState<Station | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const { stations, loading, error, refresh } = useStations(API_BASE);
  const { favorites, toggle } = useFavorites();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stationId = params.get("station");
    if (stationId && stations.length > 0) {
      const match = stations.find((s) => s.id === stationId);
      if (match) {
        void play(match);
      }
    }
  }, [stations]);

  useEffect(() => {
    return () => {
      hlsRef.current?.destroy?.();
    };
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return stations;
    const q = search.toLowerCase();
    return stations.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.country ?? "").toLowerCase().includes(q) ||
        (s.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [stations, search]);

  const visible = useMemo(() => {
    const favs = filtered.filter((s) => favorites.has(s.id));
    const rest = filtered.filter((s) => !favorites.has(s.id));
    return [...favs, ...rest].slice(0, 200);
  }, [filtered, favorites]);

  const play = async (station: Station) => {
    setStatus("loading");
    setMessage(null);
    setActive(station);
    hlsRef.current?.destroy?.();
    hlsRef.current = null;

    const audio = audioRef.current;
    if (!audio) return;
    const src = station.streamUrl || FALLBACK_STREAM;
    const isHls = station.hls || src.endsWith(".m3u8");

    if (isHls) {
      try {
        const Hls = (await import("hls.js")).default;
        const hls = new Hls({ enableWorker: false });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(audio);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          audio.play().then(() => setStatus("playing")).catch(() => setStatus("error"));
        });
      } catch {
        setStatus("error");
        setMessage("HLS failed to start");
      }
      return;
    }

    audio.src = src;
    audio
      .play()
      .then(() => setStatus("playing"))
      .catch(() => {
        setStatus("error");
        setMessage("Playback failed");
      });
  };

  const copyShare = () => {
    if (!active) return;
    const link = buildShareLink(active.id);
    navigator.clipboard
      .writeText(link)
      .then(() => setMessage("Share link copied"))
      .catch(() => setMessage("Copy failed"));
  };

  return (
    <section className="card">
      <div className="row">
        <div>
          <h1>Radio</h1>
          <p className="muted">Click to play. Favorites bubble to the top.</p>
        </div>
        <button className="btn" onClick={refresh}>
          Refresh
        </button>
      </div>

      <label className="field">
        <span>Search name, tag, or country</span>
        <input value={search} onInput={(e) => setSearch((e.target as HTMLInputElement).value)} placeholder="lofi" />
      </label>

      <div className="table">
        <div className="table-head">
          <span>Fav</span>
          <span>Name</span>
          <span>Country</span>
          <span>Tags</span>
          <span>Codec</span>
        </div>
        <div className="table-body">
          {loading && <div className="table-row muted">Loading…</div>}
          {error && <div className="table-row muted">Error: {error}</div>}
          {!loading &&
            visible.map((s) => (
              <button key={s.id} className="table-row" onClick={() => void play(s)}>
                <span className={favorites.has(s.id) ? "fav active" : "fav"} onClick={(e) => (e.stopPropagation(), toggle(s.id))}>
                  ★
                </span>
                <span className="strong">{s.name}</span>
                <span>{s.country ?? "?"}</span>
                <span className="muted">{(s.tags ?? []).slice(0, 3).join(", ")}</span>
                <span className="muted">
                  {s.codec ?? "?"} {s.bitrate ? `${s.bitrate}kbps` : ""}
                </span>
              </button>
            ))}
        </div>
      </div>

      <div className="player">
        <div>
          <div className="strong">{active?.name ?? "No station selected"}</div>
          <div className="muted">
            Status: {status}
            {message ? ` — ${message}` : ""}
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={copyShare} disabled={!active}>
            Copy share
          </button>
          <button className="btn" onClick={() => active && toggle(active.id)}>
            {active && favorites.has(active.id) ? "Unfavorite" : "Favorite"}
          </button>
        </div>
      </div>

      <audio ref={audioRef} controls className="audio" />
    </section>
  );
};

export default Radio;
