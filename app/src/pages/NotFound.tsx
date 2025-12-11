import { Link, useLocation } from "react-router-dom";

const NotFound = () => {
  const { pathname } = useLocation();
  return (
    <section className="card">
      <h1>404</h1>
      <p>Nothing here: {pathname}</p>
      <Link href="/" className="btn">
        Back home
      </Link>
    </section>
  );
};

export default NotFound;
