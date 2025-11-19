import { useEffect, useMemo, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";

type TopicConfig = {
  title: string;
  query: string;
  description: string;
};

const TOPICS: Record<string, TopicConfig> = {
  "setup-nginx": {
    title: "Configure Nginx Reverse Proxy",
    query: "how to configure nginx reverse proxy",
    description: "Virtual hosts, SSL, the works.",
  },
  "deploy-k8s": {
    title: "Deploy to Kubernetes",
    query: "how to deploy to kubernetes cluster",
    description: "Because kubectl apply fixes everything.",
  },
  "roll-back": {
    title: "Roll Back Deployment",
    query: "how to roll back kubernetes deployment",
    description: "Undo button for production panic.",
  },
  "monitor-prometheus": {
    title: "Prometheus + Grafana Monitoring",
    query: "how to monitor services with prometheus grafana",
    description: "Dashboards or it didn't happen.",
  },
  "configure-ci": {
    title: "GitHub Actions CI",
    query: "how to set up github actions ci pipeline",
    description: "Ship faster, break fewer things.",
  },
  "docker-hardening": {
    title: "Harden Docker Images",
    query: "how to secure docker container image best practices",
    description: "Stop shipping root shells.",
  },
  "helm-upgrade": {
    title: "Upgrade Helm Release",
    query: "how to upgrade helm release safely",
    description: "Tillers may be gone but fear remains.",
  },
  "ssl-renewal": {
    title: "Renew Let's Encrypt",
    query: "how to renew letsencrypt wildcard cert",
    description: "Because certificates expire faster than coffee.",
  },
  "redis-scale": {
    title: "Scale Redis",
    query: "how to scale redis cluster",
    description: "Cache harder.",
  },
  "postgres-backup": {
    title: "Postgres Backups",
    query: "how to backup postgres with wal-g",
    description: "Point-in-time sanity.",
  },
  "logging-stack": {
    title: "ELK Logging Stack",
    query: "how to build elk logging stack",
    description: "Kibana or chaos.",
  },
  "secret-rotation": {
    title: "Rotate Kubernetes Secrets",
    query: "how to rotate kubernetes secrets",
    description: "Rotate like it's laundry day.",
  },
  "load-test": {
    title: "Run k6 Load Test",
    query: "how to run k6 load test",
    description: "Break it before users do.",
  },
  "argo-rollouts": {
    title: "Argo Rollouts Canary",
    query: "how to use argo rollouts canary deploy",
    description: "Sightseeing between blue and green.",
  },
  "cdn-cache": {
    title: "Purge Cloudflare Cache",
    query: "how to purge cloudflare cache via api",
    description: "Because stale assets are cursed.",
  },
};

const HowTo = () => {
  const navigate = useNavigate();
  const { topic = "" } = useParams();
  const normalized = topic.toLowerCase();
  const topicInfo = TOPICS[normalized];
  const openedRef = useRef(false);

  useEffect(() => {
    if (!topicInfo || openedRef.current) {
      return;
    }
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(topicInfo.query)}`;
    const newWindow = window.open("", "_blank", "noopener,noreferrer");
    if (newWindow) {
      newWindow.location.href = googleUrl;
      openedRef.current = true;
    }
  }, [topicInfo]);

  const heading = topicInfo ? topicInfo.title : "Unknown Ritual";
  const message = useMemo(() => {
    if (!topicInfo) {
      return "We couldn't find that playbook, but Google probably can.";
    }
    return topicInfo.description;
  }, [topicInfo]);

  return (
    <div className="min-h-screen bg-black text-terminal-green flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-xl border border-terminal-green/40 bg-black/80 p-8 shadow-[0_0_30px_rgba(0,255,132,0.25)]">
        <p className="font-mono text-terminal-yellow text-xs uppercase tracking-[0.35em] mb-3">
          {topicInfo ? "Fetching wisdom from the tubes…" : "Choose your playbook."}
        </p>
        <h1 className="text-2xl font-mono mb-3 text-terminal-cyan">{heading}</h1>
        <p className="font-mono text-sm text-terminal-white/70 mb-6">{message}</p>
        {topicInfo ? (
          <div className="space-y-3">
            <p className="font-mono text-xs text-terminal-white/60">
              If nothing opens automatically,{" "}
              <a
                href={`https://www.google.com/search?q=${encodeURIComponent(topicInfo.query)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-terminal-yellow underline"
              >
                click here
              </a>
              .
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="font-mono text-xs text-terminal-white/60">
              Available briefs:
            </p>
            <ul className="text-left font-mono text-terminal-cyan text-sm space-y-1 max-h-60 overflow-y-auto">
              {Object.keys(TOPICS).map((slug) => (
                <li key={slug}>
                  <button
                    type="button"
                    onClick={() => navigate(`/how-to/${slug}`)}
                    className="hover:text-terminal-yellow underline"
                  >
                    {TOPICS[slug].title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-6">
          <Link to="/" className="font-mono text-xs text-terminal-cyan hover:text-terminal-yellow">
            Return home
          </Link>
        </div>
      </div>
    </div>
  );
};

export default HowTo;
