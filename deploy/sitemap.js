function gen(r) {
  var base = "https://" + r.headersIn.host;
  var routes = [
      "/",
      "/documents",
      "/games",
      "/games/do-nothing",
      "/terminal",
      "/radio"

    ];
  var today = new Date().toISOString().slice(0, 10);

  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  for (var i = 0; i < routes.length; i++) {
    var p = routes[i];
    var priority = (p === "/") ? "1.0" : "0.7";
    xml += '  <url><loc>' + base + p + '</loc><lastmod>' + today +
           '</lastmod><changefreq>daily</changefreq><priority>' + priority +
           '</priority></url>\n';
  }

  xml += '</urlset>\n';

  r.headersOut['Content-Type'] = 'application/xml; charset=utf-8';
  r.return(200, xml);
}

function serviceAuthToken(r) {
  var token = ngx.env.SERVICE_AUTH_TOKEN || ngx.env.STATIONS_REFRESH_TOKEN || "";
  token = token.trim();
  return token;
}

export default { gen, serviceAuthToken };
