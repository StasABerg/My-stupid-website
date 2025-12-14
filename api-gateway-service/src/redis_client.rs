use anyhow::{Context, Result, anyhow};
use redis::{Client, ConnectionAddr, IntoConnectionInfo, ProtocolVersion, RedisConnectionInfo};
use url::Url;

pub fn build_redis_client(url: &str, tls_reject_unauthorized: bool) -> Result<Client> {
    let parsed = Url::parse(url).context("invalid redis url")?;
    let host = parsed
        .host_str()
        .ok_or_else(|| anyhow!("redis url missing hostname"))?
        .to_string();
    let port = parsed.port().unwrap_or(6379);
    let username = if parsed.username().is_empty() {
        None
    } else {
        Some(parsed.username().to_string())
    };
    let password = parsed.password().map(|value| value.to_string());
    let db = parsed
        .path()
        .trim_start_matches('/')
        .parse::<i64>()
        .unwrap_or(0);

    let addr = match parsed.scheme() {
        "redis" => ConnectionAddr::Tcp(host, port),
        "rediss" => ConnectionAddr::TcpTls {
            host,
            port,
            insecure: !tls_reject_unauthorized,
            tls_params: None,
        },
        other => return Err(anyhow!("unsupported redis scheme: {other}")),
    };

    let redis_info = {
        let mut info = RedisConnectionInfo::default()
            .set_db(db)
            .set_protocol(ProtocolVersion::RESP2);

        if let Some(username) = username {
            info = info.set_username(username);
        }

        if let Some(password) = password {
            info = info.set_password(password);
        }

        info
    };

    let info = addr
        .into_connection_info()
        .context("failed to convert redis address into connection info")?
        .set_redis_settings(redis_info);

    Client::open(info).context("failed to open redis client")
}
