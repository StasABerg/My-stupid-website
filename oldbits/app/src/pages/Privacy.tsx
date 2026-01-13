import { useEffect } from "react";
import { Link } from "react-router-dom";
import { TerminalHeader, TerminalPrompt, TerminalWindow } from "@/components/SecureTerminal";

const Privacy = () => {
  useEffect(() => {
    const title = "Privacy & Cookies | My Stupid Website";
    const description = "How we handle analytics, cookies, and consent on gitgud.";
    document.title = title;
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = description;
  }, []);

  const reopenConsent = () => {
    document.dispatchEvent(new Event("openCookieConsentBar"));
  };

  return (
    <div className="h-screen bg-black">
      <TerminalWindow aria-label="Privacy and cookies">
        <TerminalHeader displayCwd="~/privacy" />
        <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-terminal-white sm:p-6 sm:text-sm space-y-4">
          <TerminalPrompt path="~">
            <Link
              to="/"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            >
              cd ..
            </Link>
          </TerminalPrompt>

          <TerminalPrompt command="cat privacy.md" />

          <div className="space-y-3 pl-2 sm:pl-4">
            <p className="leading-relaxed">
              This site keeps tracking minimal. We only run basic analytics through Cloudflare Zaraz, and only after you
              choose to allow it. No ads, no cross-site profiling.
            </p>

            <div className="space-y-2">
              <p className="font-semibold text-terminal-green">What we collect</p>
              <ul className="list-disc space-y-1 pl-4">
                <li>Page views and simple engagement events (for performance and content insights).</li>
                <li>
                  Standard request metadata (IP, user agent) may be processed by our providers to keep the service
                  secure, but we do not build visitor profiles.
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <p className="font-semibold text-terminal-green">Cookies</p>
              <ul className="list-disc space-y-1 pl-4">
                <li>
                  `zaraz-consent` — stores whether you accepted or rejected analytics. Lifetime: 12 months or until you
                  clear it.
                </li>
                <li>No other consent or marketing cookies are set by this site.</li>
              </ul>
            </div>

            <div className="space-y-2">
              <p className="font-semibold text-terminal-green">Change your choice</p>
              <button
                type="button"
                onClick={reopenConsent}
                className="inline-flex items-center rounded-none border border-terminal-green/70 px-3 py-2 text-xs font-semibold text-terminal-green transition hover:bg-terminal-green/10 focus:outline-none focus:ring-2 focus:ring-terminal-green"
              >
                Reopen cookie banner
              </button>
              <p className="leading-relaxed opacity-80">
                You can also clear the `zaraz-consent` cookie in your browser settings to be asked again on your next
                visit.
              </p>
            </div>
          </div>
        </div>
      </TerminalWindow>
    </div>
  );
};

export default Privacy;
