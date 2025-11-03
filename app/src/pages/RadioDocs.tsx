import { useEffect } from "react";

const TARGET_URL = "/api/radio/docs";

const RadioDocs = () => {
  useEffect(() => {
    const id = window.setTimeout(() => {
      window.location.replace(TARGET_URL);
    }, 0);

    return () => window.clearTimeout(id);
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Radio API Documentation</h1>
      <p className="text-muted-foreground">
        Redirecting you to the Swagger UI. If nothing happens,{" "}
        <a className="text-primary underline" href={TARGET_URL}>
          open the documentation manually
        </a>
        .
      </p>
    </main>
  );
};

export default RadioDocs;

