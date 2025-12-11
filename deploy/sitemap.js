function gen(r) {
  var base = "https://" + r.headersIn.host;
  var routes = [
      "/",
      "/app",
      "/app/documents",
      "/app/games",
      "/app/games/do-nothing",
      "/app/terminal",
      "/app/terminal/docs",
      "/app/radio",
      "/app/radio/docs",
      "/app/gateway/docs",
      "/app/swagger",
      "/app/konami",
      "/app/motivation",
      "/app/begud",
      "/app/gitgud",
      "/app/how-to",
      "/app/how-to/setup-nginx",
      "/app/how-to/deploy-k8s",
      "/app/how-to/roll-back",
      "/app/how-to/monitor-prometheus",
      "/app/how-to/configure-ci",
      "/app/how-to/docker-hardening",
      "/app/how-to/helm-upgrade",
      "/app/how-to/ssl-renewal",
      "/app/how-to/redis-scale",
      "/app/how-to/postgres-backup",
      "/app/how-to/logging-stack",
      "/app/how-to/secret-rotation",
      "/app/how-to/load-test",
      "/app/how-to/argo-rollouts",
      "/app/how-to/cdn-cache"

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

export default { gen };
