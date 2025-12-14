import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

const CONSENT_COOKIE_NAME = "zaraz-consent";
const ANALYTICS_PURPOSE_ID = "analytics";
const OPEN_EVENT = "openCookieConsentBar";

declare global {
  interface Window {
    zaraz?: {
      consent?: {
        APIReady?: boolean;
        modal?: boolean;
        purposes?: Record<string, unknown>;
        get?: (purposeId: string) => boolean | undefined;
        set?: (consentPreferences: Record<string, boolean>) => void;
        setAll?: (status: boolean) => void;
        sendQueuedEvents?: () => void;
      };
    };
  }
}

function getCookie(name: string) {
  if (typeof document === "undefined") {
    return null;
  }

  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()?.split(";").shift() ?? null;
  }

  return null;
}

const CookieConsentBanner = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const hasConsentCookie = Boolean(getCookie(CONSENT_COOKIE_NAME));
    setVisible(!hasConsentCookie);

    const handleChoicesUpdated = () => {
      if (getCookie(CONSENT_COOKIE_NAME)) {
        setVisible(false);
      }
    };

    const handleOpenRequest = () => {
      setVisible(true);
    };

    document.addEventListener("zarazConsentChoicesUpdated", handleChoicesUpdated);
    document.addEventListener(OPEN_EVENT, handleOpenRequest);

    return () => {
      document.removeEventListener("zarazConsentChoicesUpdated", handleChoicesUpdated);
      document.removeEventListener(OPEN_EVENT, handleOpenRequest);
    };
  }, []);

  const whenConsentAPIReady = useCallback((fn: () => void) => {
    if (typeof window === "undefined") {
      return;
    }

    if (window.zaraz?.consent?.APIReady) {
      fn();
      return;
    }

    const onReady = () => {
      fn();
      document.removeEventListener("zarazConsentAPIReady", onReady);
    };

    document.addEventListener("zarazConsentAPIReady", onReady);
  }, []);

  const applyConsent = useCallback(
    (granted: boolean) => {
      setVisible(false);

      whenConsentAPIReady(() => {
        const consent = window.zaraz?.consent;
        if (!consent) {
          return;
        }

        if (typeof consent.modal === "boolean") {
          consent.modal = false;
        }

        const hasAnalyticsPurpose =
          Boolean(consent.purposes) && Object.prototype.hasOwnProperty.call(consent.purposes, ANALYTICS_PURPOSE_ID);

        if (hasAnalyticsPurpose && typeof consent.set === "function") {
          consent.set({ [ANALYTICS_PURPOSE_ID]: granted });
        } else if (typeof consent.setAll === "function") {
          consent.setAll(granted);
        }

        if (granted && typeof consent.sendQueuedEvents === "function") {
          consent.sendQueuedEvents();
        }
      });
    },
    [whenConsentAPIReady],
  );

  if (!visible) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3 sm:px-4">
      <div className="mx-auto max-w-5xl border border-terminal-green/40 bg-black/95 text-terminal-white shadow-[0_0_20px_rgba(0,255,0,0.2)]">
        <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-terminal-green">Cookies</p>
            <p className="text-xs leading-relaxed opacity-80">
              We use a single analytics cookie via Cloudflare Zaraz. No ads, no profiling, no cross-site tracking. You
              can update your choice any time.
            </p>
            <Link
              to="/privacy"
              className="inline-flex text-xs font-semibold text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
            >
              Privacy &amp; Cookies Policy
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-none border border-terminal-green/70 px-3 py-2 text-xs font-semibold text-terminal-green transition hover:bg-terminal-green/10 focus:outline-none focus:ring-2 focus:ring-terminal-green"
              onClick={() => applyConsent(false)}
            >
              Reject all
            </button>
            <button
              type="button"
              className="rounded-none border border-terminal-green bg-terminal-green/90 px-3 py-2 text-xs font-semibold text-black transition hover:bg-terminal-green focus:outline-none focus:ring-2 focus:ring-terminal-green"
              onClick={() => applyConsent(true)}
            >
              Accept analytics
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CookieConsentBanner;
