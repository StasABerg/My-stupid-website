import { useMemo } from "preact/hooks";
import { Link } from "react-router-dom";

const Home = () => {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  return (
    <section className="card terminal">
      <pre className="ascii">
{`██████╗ ██╗████████╗ ██████╗ ██╗   ██╗██████╗
██╔════╝ ██║╚══██╔══╝██╔════╝ ██║   ██║██╔══██╗
██║  ███╗██║   ██║   ██║  ███╗██║   ██║██║  ██║
██║   ██║██║   ██║   ██║   ██║██║   ██║██║  ██║
╚██████╔╝██║   ██║   ╚██████╔╝╚██████╔╝██████╔╝
 ╚═════╝ ╚═╝   ╚═╝    ╚═════╝  ╚═════╝ ╚═════╝`}
      </pre>

      <div className="mono block">
        <p>╔═══════════════════════════════════════════╗</p>
        <p>║ Welcome to my stupid website              ║</p>
        <p>║ System Status: ONLINE                     ║</p>
        <p>║ Security Level: GITGUD                    ║</p>
        <p>╚═══════════════════════════════════════════╝</p>
      </div>

      <div className="mono">
        <div>$ ls -la /home/user</div>
        <div className="list-like">
          <Link href="/documents">drwxr-xr-x documents/</Link>
          <Link href="/games">drwxr-xr-x games/</Link>
          <Link href="/radio">drwxr-xr-x radio/</Link>
          <Link href="/motivation">drwxr-xr-x motivation?/</Link>
          <Link href="/terminal">drwxr-xr-x ssh-sandbox/</Link>
          <Link href="/swagger">drwxr-xr-x swagger/</Link>
          <Link href="/how-to">drwxr-xr-x how-to/</Link>
          <Link href="/konami">drwxr----- .secrets/</Link>
        </div>
      </div>

      <div className="mono muted">fastfetch — {today}</div>
    </section>
  );
};

export default Home;
