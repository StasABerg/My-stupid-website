function gen(r) {
  const base = `${r.variables.scheme}://${r.headersIn.host}`;
  const routes = ["/"];
  const today = new Date().toISOString().slice(0, 10);

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
  for (const p of routes) {
    const priority = p === "/" ? "1.0" : "0.7";
    xml += `  <url><loc>${base}${p}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>${priority}</priority></url>\n`;
  }
  xml += `</urlset>\n`;

  r.headersOut["Content-Type"] = "application/xml; charset=utf-8";
  r.return(200, xml);
}

export default { gen };
