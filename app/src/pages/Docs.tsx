const Docs = () => (
  <section className="card">
    <h1>Docs</h1>
    <ul className="list">
      <li>
        <a href="/swagger" target="_blank" rel="noreferrer">
          Swagger directory
        </a>
      </li>
      <li>
        <a href="/gateway/docs" target="_blank" rel="noreferrer">
          Gateway docs
        </a>
      </li>
      <li>
        <a href="/radio/docs" target="_blank" rel="noreferrer">
          Radio docs
        </a>
      </li>
      <li>
        <a href="/terminal/docs" target="_blank" rel="noreferrer">
          Terminal docs
        </a>
      </li>
    </ul>
    <iframe title="Swagger" src="/swagger" className="frame" loading="lazy" />
  </section>
);

export default Docs;
