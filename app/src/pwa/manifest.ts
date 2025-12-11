import icon192 from "../assets/pwa/icon-192.png";
import icon512 from "../assets/pwa/icon-512.png";

const manifest = {
  name: "Gitgud Radio",
  short_name: "Gitgud Radio",
  description: "Listen to the Gitgud radio experience on mobile.",
  start_url: "/radio",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#020305",
  theme_color: "#0bff96",
  icons: [
    {
      src: icon192,
      sizes: "192x192",
      type: "image/png",
      purpose: "any maskable",
    },
    {
      src: icon512,
      sizes: "512x512",
      type: "image/png",
      purpose: "any maskable",
    },
  ],
};

export default manifest;
