import { Link } from "react-router-dom";

const topics = [
  "setup-nginx",
  "deploy-k8s",
  "roll-back",
  "monitor-prometheus",
  "configure-ci",
  "docker-hardening",
  "helm-upgrade",
  "ssl-renewal",
  "redis-scale",
  "postgres-backup",
  "logging-stack",
  "secret-rotation",
  "load-test",
  "argo-rollouts",
  "cdn-cache",
];

const HowToIndex = () => (
  <section className="card">
    <h1>How-to</h1>
    <ul className="list">
      {topics.map((topic) => (
        <li key={topic}>
          <Link href={`/how-to/${topic}`}>{topic}</Link>
        </li>
      ))}
    </ul>
  </section>
);

export default HowToIndex;
