import { useEffect, useRef, useState } from "preact/hooks";

type TerminalResponse = { output: string; error?: string };

const Terminal = () => {
  const [cmd, setCmd] = useState("ls");
  const [history, setHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const run = async () => {
    if (!cmd.trim()) return;
    setBusy(true);
    try {
      const resp = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd }),
      });
      const data = (await resp.json()) as TerminalResponse;
      const out = data.error ? `❌ ${data.error}` : data.output;
      setHistory((h) => [`$ ${cmd}`, out, ...h].slice(0, 50));
    } catch {
      setHistory((h) => [`$ ${cmd}`, "❌ request failed", ...h].slice(0, 50));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h1>Terminal sandbox</h1>
      <div className="row">
        <input
          ref={inputRef}
          className="input"
          value={cmd}
          onInput={(e) => setCmd((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
        />
        <button className="btn" onClick={() => void run()} disabled={busy}>
          Run
        </button>
      </div>
      <div className="console">
        {history.length === 0 && <div className="muted">No output yet.</div>}
        {history.map((line, idx) => (
          <div key={idx} className="mono">
            {line}
          </div>
        ))}
      </div>
    </section>
  );
};

export default Terminal;
