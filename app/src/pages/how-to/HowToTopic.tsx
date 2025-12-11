import { useEffect, useRef } from "preact/hooks";
import { useParams, Link } from "react-router-dom";

const HowToTopic = () => {
  const { topic = "" } = useParams<{ topic?: string }>();
  const openedRef = useRef(false);
  const query = topic.replace(/-/g, " ") || "devops how to";
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

  useEffect(() => {
    if (openedRef.current) return;
    const timer = setTimeout(() => {
      openedRef.current = true;
      window.open(url, "_blank", "noopener,noreferrer");
    }, 3000);
    return () => clearTimeout(timer);
  }, [url]);

  return (
    <section className="card">
      <h1>{topic || "How-to"}</h1>
      <p>Launching a search tab in 3 seconds. Stay curious.</p>
      <a className="btn" href={url} target="_blank" rel="noreferrer">
        Open now
      </a>
      <Link href="/how-to" className="btn">
        Back
      </Link>
    </section>
  );
};

export default HowToTopic;
