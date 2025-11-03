import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";

const RadioDocs = () => (
  <div className="min-h-screen bg-slate-950 p-4 sm:p-8">
    <div className="mx-auto max-w-5xl rounded-lg bg-white p-4 shadow-lg">
      <SwaggerUI url="/api/radio/docs/json" docExpansion="list" deepLinking={false} />
    </div>
  </div>
);

export default RadioDocs;
