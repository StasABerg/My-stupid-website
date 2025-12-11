import { useState } from "preact/hooks";

const DoNothingGamePage = () => {
  const [count, setCount] = useState(0);
  return (
    <section className="card">
      <h1>Do Nothing Game</h1>
      <p>Press the button, watch the counter. Minimal bytes, maximal zen.</p>
      <button className="btn" onClick={() => setCount((c) => c + 1)}>
        Count {count}
      </button>
    </section>
  );
};

export default DoNothingGamePage;
