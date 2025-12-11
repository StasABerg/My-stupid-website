const Terminal = () => (
  <section className="card">
    <h1>Terminal sandbox</h1>
    <p>
      The interactive sandbox lives at <code>/api/terminal</code>. Use your own terminal client or a curl POST with the
      command payload. This UI is kept light to stay under the 14 KB target.
    </p>
    <pre className="code">
{`curl -X POST /api/terminal \\
  -H "Content-Type: application/json" \\
  -d '{"cmd":"ls"}'`}
    </pre>
  </section>
);

export default Terminal;
