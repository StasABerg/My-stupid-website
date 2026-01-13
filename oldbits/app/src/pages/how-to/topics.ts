export type TopicConfig = {
  slug: string;
  title: string;
  query: string;
  description: string;
};

export const HOW_TO_TOPICS: TopicConfig[] = [
  {
    slug: "setup-nginx",
    title: "Configure Nginx Reverse Proxy",
    query: "how to configure nginx reverse proxy",
    description: "Virtual hosts, SSL, the works.",
  },
  {
    slug: "deploy-k8s",
    title: "Deploy to Kubernetes",
    query: "how to deploy to kubernetes cluster",
    description: "Because kubectl apply fixes everything.",
  },
  {
    slug: "roll-back",
    title: "Roll Back Deployment",
    query: "how to roll back kubernetes deployment",
    description: "Undo button for production panic.",
  },
  {
    slug: "monitor-prometheus",
    title: "Prometheus + Grafana Monitoring",
    query: "how to monitor services with prometheus grafana",
    description: "Dashboards or it didn't happen.",
  },
  {
    slug: "configure-ci",
    title: "GitHub Actions CI",
    query: "how to set up github actions ci pipeline",
    description: "Ship faster, break fewer things.",
  },
  {
    slug: "docker-hardening",
    title: "Harden Docker Images",
    query: "how to secure docker container image best practices",
    description: "Stop shipping root shells.",
  },
  {
    slug: "helm-upgrade",
    title: "Upgrade Helm Release",
    query: "how to upgrade helm release safely",
    description: "Tillers may be gone but fear remains.",
  },
  {
    slug: "ssl-renewal",
    title: "Renew Let's Encrypt",
    query: "how to renew letsencrypt wildcard cert",
    description: "Because certificates expire faster than coffee.",
  },
  {
    slug: "redis-scale",
    title: "Scale Redis",
    query: "how to scale redis cluster",
    description: "Cache harder.",
  },
  {
    slug: "postgres-backup",
    title: "Postgres Backups",
    query: "how to backup postgres with wal-g",
    description: "Point-in-time sanity.",
  },
  {
    slug: "logging-stack",
    title: "ELK Logging Stack",
    query: "how to build elk logging stack",
    description: "Kibana or chaos.",
  },
  {
    slug: "secret-rotation",
    title: "Rotate Kubernetes Secrets",
    query: "how to rotate kubernetes secrets",
    description: "Rotate like it's laundry day.",
  },
  {
    slug: "load-test",
    title: "Run k6 Load Test",
    query: "how to run k6 load test",
    description: "Break it before users do.",
  },
  {
    slug: "argo-rollouts",
    title: "Argo Rollouts Canary",
    query: "how to use argo rollouts canary deploy",
    description: "Sightseeing between blue and green.",
  },
  {
    slug: "cdn-cache",
    title: "Purge Cloudflare Cache",
    query: "how to purge cloudflare cache via api",
    description: "Because stale assets are cursed.",
  },
];
