import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { TerminalHeader, TerminalPrompt, TerminalWindow } from "@/components/SecureTerminal";

const Contact = () => {
  const [formState, setFormState] = useState({
    name: "",
    email: "",
    message: "",
  });
  const [honeypot, setHoneypot] = useState("");
  const [timestamp] = useState(() => Math.floor(Date.now() / 1000));
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [turnstileWidgetId, setTurnstileWidgetId] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [csrfProof, setCsrfProof] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);

  const resetTurnstile = () => {
    if (window.turnstile && turnstileWidgetId) {
      window.turnstile.reset(turnstileWidgetId);
    }
    setTurnstileToken(null);
  };

  const teardownTurnstile = () => {
    if (window.turnstile && turnstileWidgetId) {
      window.turnstile.remove?.(turnstileWidgetId);
    }
    setTurnstileWidgetId(null);
    setTurnstileToken(null);
  };

  useEffect(() => {
    const title = "Contact | My Stupid Website";
    const description = "Get in touch with us.";
    document.title = title;
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = description;

    // Fetch session for CSRF token
    fetch("/api/session", { method: "POST", credentials: "include" })
      .then(res => res.json())
      .then(session => {
        setCsrfToken(session.csrfToken);
        setCsrfProof(session.csrfProof);
      })
      .catch(() => {
        setError("Failed to initialize session. Please refresh the page.");
      });

    // Fetch frontend config
    fetch("/api/config")
      .then(res => res.json())
      .then(config => {
        if (config.turnstileSiteKey) {
          setTurnstileSiteKey(config.turnstileSiteKey);
        }
      })
      .catch(() => {
        // Turnstile not configured, continue without it
      });
  }, []);

  useEffect(() => {
    // Load Turnstile if site key is available
    if (!turnstileSiteKey || success) return;

    const renderWidget = () => {
      if (window.turnstile && turnstileRef.current && !turnstileWidgetId) {
        let renderedId: string | null = null;
        const resetLocal = () => {
          if (window.turnstile && renderedId) {
            window.turnstile.reset(renderedId);
          }
          setTurnstileToken(null);
        };

        const widgetId = window.turnstile.render(turnstileRef.current, {
          sitekey: turnstileSiteKey,
          callback: (token: string) => {
            setTurnstileToken(token);
          },
          "error-callback": () => {
            setError("Turnstile verification failed. Please refresh the page.");
            resetLocal();
          },
          "expired-callback": () => {
            setError("Turnstile token expired. Please complete the challenge again.");
            resetLocal();
          },
          "timeout-callback": () => {
            setError("Turnstile timed out. Please complete the challenge again.");
            resetLocal();
          },
        });
        renderedId = widgetId;
        setTurnstileWidgetId(widgetId);
      }
    };

    // Check if Turnstile is already loaded
    if (window.turnstile) {
      window.turnstile.ready(renderWidget);
      return;
    }

    // Check if script already exists in DOM
    const existingScript = document.querySelector(
      'script[src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"]'
    );

    if (existingScript) {
      existingScript.addEventListener("load", renderWidget);
      return () => {
        existingScript.removeEventListener("load", renderWidget);
      };
    }

    const preconnect = document.querySelector(
      'link[rel="preconnect"][href="https://challenges.cloudflare.com"]'
    );
    if (!preconnect) {
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = "https://challenges.cloudflare.com";
      document.head.appendChild(link);
    }

    // Load script only if not already present
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = renderWidget;
    document.head.appendChild(script);

    return () => {
      script.onload = null;
    };
  }, [turnstileSiteKey, turnstileWidgetId, success]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const payload = {
        name: formState.name.trim(),
        email: formState.email.trim() || undefined,
        message: formState.message.trim(),
        honeypot: honeypot || undefined,
        timestamp,
        turnstileToken: turnstileToken || undefined,
      };

      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken && csrfProof ? {
            "x-gateway-csrf": csrfToken,
            "x-gateway-csrf-proof": csrfProof,
          } : {}),
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: "Unknown error" }));
        resetTurnstile();
        throw new Error(data.error || `Request failed with status ${response.status}`);
      }

      await response.json();
      setSuccess(true);
      setFormState({ name: "", email: "", message: "" });

      teardownTurnstile();
    } catch (err) {
      resetTurnstile();
      setError(err instanceof Error ? err.message : "Failed to submit contact form");
    } finally {
      setLoading(false);
    }
  };

  const charCount = formState.message.length;
  const maxChars = 2000;

  return (
    <div className="h-screen bg-black">
      <TerminalWindow aria-label="Contact form">
        <TerminalHeader displayCwd="~/contact" />
        <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-terminal-white sm:p-6 sm:text-sm space-y-4">
          <TerminalPrompt path="~">
            <Link
              to="/"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            >
              cd ..
            </Link>
          </TerminalPrompt>

          <TerminalPrompt command="cat contact.txt" />

          {success ? (
            <div className="space-y-3 pl-2 sm:pl-4">
              <p className="text-terminal-green font-semibold">✓ Message received</p>
              <p className="opacity-80">We'll get back to you if needed.</p>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setSuccess(false);
                }}
                className="text-terminal-blue hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-blue"
              >
                Send another message
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 pl-2 sm:pl-4">
              {/* Honeypot field - hidden from users */}
              <input
                type="text"
                name="website"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
                style={{
                  position: "absolute",
                  left: "-9999px",
                  width: "1px",
                  height: "1px",
                }}
                aria-hidden="true"
              />

              <div className="space-y-2">
                <label htmlFor="name" className="block text-terminal-green">
                  Name: <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  id="name"
                  value={formState.name}
                  onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                  required
                  maxLength={80}
                  disabled={loading}
                  className="w-full rounded-none border border-terminal-green/70 bg-black px-3 py-2 text-terminal-white focus:border-terminal-green focus:outline-none focus:ring-2 focus:ring-terminal-green disabled:opacity-50"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="email" className="block text-terminal-green">
                  Email: <span className="text-xs opacity-70">(optional)</span>
                </label>
                <input
                  type="email"
                  id="email"
                  value={formState.email}
                  onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                  maxLength={120}
                  disabled={loading}
                  className="w-full rounded-none border border-terminal-green/70 bg-black px-3 py-2 text-terminal-white focus:border-terminal-green focus:outline-none focus:ring-2 focus:ring-terminal-green disabled:opacity-50"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="message" className="block text-terminal-green">
                  Message: <span className="text-red-400">*</span>
                </label>
                <textarea
                  id="message"
                  value={formState.message}
                  onChange={(e) => setFormState({ ...formState, message: e.target.value })}
                  required
                  maxLength={maxChars}
                  rows={8}
                  disabled={loading}
                  className="w-full rounded-none border border-terminal-green/70 bg-black px-3 py-2 text-terminal-white focus:border-terminal-green focus:outline-none focus:ring-2 focus:ring-terminal-green disabled:opacity-50 resize-none"
                />
                <p className="text-xs opacity-70">
                  {charCount} / {maxChars} characters
                </p>
              </div>

              {turnstileSiteKey && (
                <div ref={turnstileRef} className="my-4" />
              )}

              {error && (
                <div className="rounded-none border border-red-500/70 bg-red-500/10 px-3 py-2 text-red-400">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !formState.name.trim() || !formState.message.trim() || !csrfToken || !csrfProof || (turnstileSiteKey && !turnstileToken)}
                className="inline-flex items-center rounded-none border border-terminal-green/70 px-4 py-2 text-sm font-semibold text-terminal-green transition hover:bg-terminal-green/10 focus:outline-none focus:ring-2 focus:ring-terminal-green disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Sending..." : !csrfToken ? "Initializing..." : (turnstileSiteKey && !turnstileToken) ? "Complete challenge..." : "Send Message"}
              </button>

              <p className="text-xs opacity-70 mt-4">
                By submitting, you agree that we may store your message for review. See our{" "}
                <Link to="/privacy" className="text-terminal-blue hover:underline">
                  privacy policy
                </Link>
                .
              </p>
            </form>
          )}
        </div>
      </TerminalWindow>
    </div>
  );
};

export default Contact;

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string;
        callback: (token: string) => void;
        "error-callback": () => void;
        "expired-callback": () => void;
        "timeout-callback": () => void;
      }) => string;
      reset: (widgetId: string) => void;
      ready: (callback: () => void) => void;
      remove?: (widgetId: string) => void;
    };
  }
}
