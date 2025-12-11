import { useEffect, useRef, useState } from "preact/hooks";

const FALLBACK_STREAM = "https://stream-relay-geo.ntslive.net/stream";

const Radio = () => {
  const [url, setUrl] = useState(FALLBACK_STREAM);
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [useHls, setUseHls] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<null | { destroy: () => void }>(null);

  useEffect(() => {
    return () => {
      hlsRef.current?.destroy?.();
    };
  }, []);

  const play = async (target: string) => {
    setStatus("loading");
    hlsRef.current?.destroy?.();
    hlsRef.current = null;

    const isHls = target.endsWith(".m3u8");
    const audio = audioRef.current;
    if (!audio) return;

    if (isHls) {
      setUseHls(true);
      try {
        const Hls = (await import("hls.js")).default;
        const hls = new Hls({ enableWorker: false });
        hlsRef.current = hls;
        hls.loadSource(target);
        hls.attachMedia(audio);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          audio.play().then(() => setStatus("playing")).catch(() => setStatus("error"));
        });
      } catch {
        setStatus("error");
      }
      return;
    }

    setUseHls(false);
    audio.src = target;
    audio
      .play()
      .then(() => setStatus("playing"))
      .catch(() => setStatus("error"));
  };

  return (
    <section className="card">
      <h1>Radio</h1>
      <p>Paste a stream URL (MP3/AAC/OGG or HLS). Press play to start.</p>
      <label className="field">
        <span>Stream URL</span>
        <input
          value={url}
          onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
          placeholder="https://example.com/stream.mp3"
        />
      </label>
      <button className="btn" onClick={() => play(url)}>
        Play
      </button>
      <p className="muted">
        Status: {status} {useHls ? "(HLS)" : ""}
      </p>
      <audio ref={audioRef} controls className="audio" />
    </section>
  );
};

export default Radio;
