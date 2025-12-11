import { useParams, Link } from "react-router-dom";

const HowToTopic = () => {
  const { topic } = useParams<{ topic?: string }>();
  return (
    <section className="card">
      <h1>{topic ?? "How-to"}</h1>
      <p>Keep it small. Steps are intentionally terse to save bytes.</p>
      <ol className="list">
        <li>Define the goal.</li>
        <li>Use existing tools first.</li>
        <li>Ship, measure, trim.</li>
      </ol>
      <Link href="/how-to" className="btn">
        Back
      </Link>
    </section>
  );
};

export default HowToTopic;
