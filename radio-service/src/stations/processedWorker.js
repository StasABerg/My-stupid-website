import { parentPort } from "node:worker_threads";
import { computeStationsMetadata } from "./processing.js";

parentPort?.on("message", (message) => {
  if (!message || message.type !== "process") {
    return;
  }

  try {
    const stations = Array.isArray(message.stations) ? message.stations : [];
    const metadata = computeStationsMetadata(stations);
    parentPort.postMessage({
      type: "result",
      id: message.id,
      metadata,
    });
  } catch (error) {
    parentPort.postMessage({
      type: "error",
      id: message.id,
      error: {
        message: error?.message ?? "Failed to process stations payload.",
      },
    });
  }
});
