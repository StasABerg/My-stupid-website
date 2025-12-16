import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { TerminalWindow, TerminalHeader, TerminalPrompt } from "@/components/SecureTerminal";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_WIDTH = 300;
const MIN_WIDTH = 1;
const MAX_DECODED_PIXELS = 40_000_000;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/bmp",
  "image/gif",
]);

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "bmp", "gif"]);

const RAMP = "@%#*+=-:. ";

type ConvertState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; ascii: string; width: number; height: number }
  | { status: "error"; message: string };

function detectAllowed(file: File) {
  const typeOk = file.type ? ALLOWED_MIME_TYPES.has(file.type) : false;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const extOk = ext ? ALLOWED_EXTENSIONS.has(ext) : false;
  return typeOk || extOk;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyToClipboard(text: string) {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("Clipboard not available");
}

function luminance(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function pixelToChar(r: number, g: number, b: number) {
  const l = luminance(r, g, b);
  const t = l / 255;
  const idx = Math.min(RAMP.length - 1, Math.max(0, Math.floor((1 - t) * (RAMP.length - 1))));
  return RAMP[idx] ?? " ";
}

const ImageToAscii = () => {
  const [file, setFile] = useState<File | null>(null);
  const [width, setWidth] = useState<number>(MAX_WIDTH);
  const [state, setState] = useState<ConvertState>({ status: "idle" });
  const [toast, setToast] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    document.title = "Tools | Image → ASCII";
  }, []);

  const filename = useMemo(() => {
    const base = (file?.name || "image").replace(/\.[^.]+$/, "");
    return `${base || "image"}.txt`;
  }, [file]);

  const convert = useCallback(async () => {
    if (!file) {
      setState({ status: "error", message: "Choose an image file first" });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setState({ status: "error", message: "File too large (max 5 MiB)" });
      return;
    }
    if (!detectAllowed(file)) {
      setState({ status: "error", message: "Unsupported file type (jpg/jpeg/png/bmp/gif only)" });
      return;
    }

    const targetWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(width || MAX_WIDTH)));
    setState({ status: "loading" });
    setToast(null);

    try {
      const bitmap = await createImageBitmap(file);
      const decodedPixels = bitmap.width * bitmap.height;
      if (decodedPixels > MAX_DECODED_PIXELS) {
        bitmap.close();
        throw new Error("Image dimensions too large");
      }

      const ratio = bitmap.width > 0 ? targetWidth / bitmap.width : 1;
      const targetHeight = Math.max(1, Math.round(bitmap.height * ratio));

      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        bitmap.close();
        throw new Error("Canvas not available");
      }

      ctx.clearRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
      bitmap.close();

      const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const data = imageData.data;
      const lines: string[] = [];
      for (let y = 0; y < targetHeight; y += 1) {
        let line = "";
        const rowStart = y * targetWidth * 4;
        for (let x = 0; x < targetWidth; x += 1) {
          const i = rowStart + x * 4;
          const r = data[i] ?? 0;
          const g = data[i + 1] ?? 0;
          const b = data[i + 2] ?? 0;
          const a = data[i + 3] ?? 255;
          if (a === 0) {
            line += " ";
          } else {
            line += pixelToChar(r, g, b);
          }
        }
        lines.push(line);
      }

      const ascii = lines.join("\n");
      setState({ status: "success", ascii, width: targetWidth, height: targetHeight });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Conversion failed" });
    }
  }, [file, width]);

  const ascii = state.status === "success" ? state.ascii : "";

  return (
    <div className="h-screen bg-black">
      <TerminalWindow aria-label="Image to ASCII tool">
        <TerminalHeader displayCwd="~/tools/image-to-ascii" />
        <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-terminal-white sm:p-6 sm:text-sm space-y-4">
          <TerminalPrompt path="~">
            <Link
              to="/tools"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            >
              cd ../tools
            </Link>
          </TerminalPrompt>

          <TerminalPrompt command="img2ascii --width 300" />

          <div className="pl-2 sm:pl-4 space-y-3">
            <div className="space-y-2">
              <label htmlFor="file" className="block text-terminal-green">
                Image file (jpg/jpeg/png/bmp/gif, max 5 MiB):
              </label>
              <input
                id="file"
                type="file"
                accept=".jpg,.jpeg,.png,.bmp,.gif,image/jpeg,image/png,image/bmp,image/gif"
                onChange={(e) => {
                  const next = e.target.files?.[0] ?? null;
                  setFile(next);
                  setState({ status: "idle" });
                  setToast(null);
                }}
                className="block w-full text-terminal-white file:mr-3 file:rounded file:border file:border-terminal-green/30 file:bg-black file:px-3 file:py-2 file:text-terminal-cyan hover:file:bg-terminal-cyan/10 focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="width" className="block text-terminal-green">
                Width (1–300):
              </label>
              <input
                id="width"
                type="number"
                min={MIN_WIDTH}
                max={MAX_WIDTH}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                className="w-32 rounded border border-terminal-green/30 bg-black px-3 py-2 text-terminal-white focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void convert()}
                disabled={state.status === "loading"}
                className="rounded border border-terminal-cyan/50 px-3 py-1 text-terminal-cyan hover:bg-terminal-cyan/10 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
              >
                {state.status === "loading" ? "Converting..." : "Convert"}
              </button>
              <button
                type="button"
                disabled={state.status !== "success" || ascii.length === 0}
                onClick={() => {
                  void copyToClipboard(ascii)
                    .then(() => setToast("Copied to clipboard"))
                    .catch(() => setToast("Copy failed"));
                }}
                className="rounded border border-terminal-green/40 px-3 py-1 text-terminal-green hover:bg-terminal-green/10 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-terminal-green"
              >
                Copy
              </button>
              <button
                type="button"
                disabled={state.status !== "success" || ascii.length === 0}
                onClick={() => downloadText(filename, ascii)}
                className="rounded border border-terminal-magenta/40 px-3 py-1 text-terminal-magenta hover:bg-terminal-magenta/10 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
              >
                Download
              </button>
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setState({ status: "idle" });
                  setToast(null);
                }}
                className="rounded border border-terminal-white/20 px-3 py-1 text-terminal-white/80 hover:bg-terminal-white/10 focus:outline-none focus:ring-2 focus:ring-terminal-white/50"
              >
                Reset
              </button>
            </div>

            {toast ? <p className="text-terminal-green text-[0.75rem] sm:text-xs">{toast}</p> : null}
            {state.status === "error" ? <p className="text-red-400 break-words">{state.message}</p> : null}

            <TerminalPrompt command="cat output.txt" />
            <textarea
              readOnly
              value={ascii}
              className="w-full min-h-[40vh] rounded border border-terminal-green/20 bg-black p-3 text-terminal-white focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
              aria-label="ASCII output"
            />
          </div>

        </div>
      </TerminalWindow>

      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
    </div>
  );
};

export default ImageToAscii;

