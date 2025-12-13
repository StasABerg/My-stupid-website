function gen(r) {
  var base = "https://" + r.headersIn.host;
  var routes = [
      "/",
      "/games",
      "/games/do-nothing",
      "/terminal",
      "/radio",
      "/docs",
      "/swagger",
      "/konami",
      "/motivation",
      "/begud",
      "/gitgud",
      "/how-to",
      "/how-to/setup-nginx",
      "/how-to/deploy-k8s",
      "/how-to/roll-back",
      "/how-to/monitor-prometheus",
      "/how-to/configure-ci",
      "/how-to/docker-hardening",
      "/how-to/helm-upgrade",
      "/how-to/ssl-renewal",
      "/how-to/redis-scale",
      "/how-to/postgres-backup",
      "/how-to/logging-stack",
      "/how-to/secret-rotation",
      "/how-to/load-test",
      "/how-to/argo-rollouts",
      "/how-to/cdn-cache"

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
