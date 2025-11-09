use once_cell::sync::Lazy;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use url::Url;

const BLOCKED_HOSTNAMES: &[&str] = &["localhost", "localhost.", "127.0.0.1", "::1"];
const BLOCKED_SUFFIXES: &[&str] = &[
    ".localhost",
    ".localhost.",
    ".local",
    ".localdomain",
    ".home",
    ".home.arpa",
    ".internal",
    ".intranet",
];

const IPV4_BLOCKED_RANGES: &[(&str, &str)] = &[
    ("0.0.0.0", "255.0.0.0"),
    ("10.0.0.0", "255.0.0.0"),
    ("100.64.0.0", "255.192.0.0"),
    ("127.0.0.0", "255.0.0.0"),
    ("169.254.0.0", "255.255.0.0"),
    ("172.16.0.0", "255.240.0.0"),
    ("192.0.0.0", "255.255.255.0"),
    ("192.0.2.0", "255.255.255.0"),
    ("192.168.0.0", "255.255.0.0"),
    ("198.18.0.0", "255.254.0.0"),
    ("198.51.100.0", "255.255.255.0"),
    ("203.0.113.0", "255.255.255.0"),
    ("224.0.0.0", "240.0.0.0"),
    ("240.0.0.0", "240.0.0.0"),
];

static IPV4_RANGES: Lazy<Vec<(u32, u32)>> = Lazy::new(|| {
    IPV4_BLOCKED_RANGES
        .iter()
        .filter_map(
            |(base, mask)| match (base.parse::<Ipv4Addr>(), mask.parse::<Ipv4Addr>()) {
                (Ok(base), Ok(mask)) => Some((ipv4_to_u32(base), ipv4_to_u32(mask))),
                _ => None,
            },
        )
        .collect()
});

struct SanitizeOptions {
    force_https: bool,
    allow_insecure: bool,
    block_private_hosts: bool,
}

pub fn sanitize_stream_url(raw_url: &str) -> Option<String> {
    sanitize_url(
        raw_url,
        SanitizeOptions {
            force_https: true,
            allow_insecure: false,
            block_private_hosts: true,
        },
    )
}

pub fn sanitize_station_url(
    raw_url: Option<&str>,
    enforce_https_streams: bool,
    allow_insecure: bool,
) -> Option<String> {
    raw_url.and_then(|value| {
        sanitize_url(
            value,
            SanitizeOptions {
                force_https: enforce_https_streams,
                allow_insecure,
                block_private_hosts: false,
            },
        )
    })
}

pub fn sanitize_web_url(raw_url: &str, force_https: bool, allow_insecure: bool) -> Option<String> {
    sanitize_url(
        raw_url,
        SanitizeOptions {
            force_https,
            allow_insecure,
            block_private_hosts: false,
        },
    )
}

pub fn is_blocked_domain(url: &str) -> bool {
    Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|host| host.to_ascii_lowercase()))
        .map(|host| host.ends_with("stream.khz.se") || is_blocked_hostname(&host))
        .unwrap_or(false)
}

fn sanitize_url(raw_url: &str, options: SanitizeOptions) -> Option<String> {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized_input = if trimmed.starts_with("//") {
        format!("https:{trimmed}")
    } else {
        trimmed.to_string()
    };

    let mut parsed = Url::parse(&normalized_input).ok()?;
    if options.block_private_hosts && parsed.host_str().is_none_or(is_blocked_hostname) {
        return None;
    }

    match parsed.scheme() {
        "https" => Some(parsed.to_string()),
        "http" => {
            if options.force_https || !options.allow_insecure {
                parsed.set_scheme("https").ok()?;
                if options.block_private_hosts
                    && parsed.host_str().is_none_or(is_blocked_hostname)
                {
                    return None;
                }
                Some(parsed.to_string())
            } else if options.block_private_hosts
                && parsed.host_str().is_none_or(is_blocked_hostname)
            {
                None
            } else {
                Some(parsed.to_string())
            }
        }
        _ => {
            if !options.allow_insecure {
                return None;
            }
            if options.block_private_hosts && parsed.host_str().is_none_or(is_blocked_hostname) {
                return None;
            }
            Some(parsed.to_string())
        }
    }
}

fn is_blocked_hostname(hostname: &str) -> bool {
    if hostname.is_empty() {
        return true;
    }
    let normalized = hostname
        .trim_matches(|c| c == '[' || c == ']')
        .to_ascii_lowercase();

    if BLOCKED_HOSTNAMES.contains(&normalized.as_str()) {
        return true;
    }
    if BLOCKED_SUFFIXES
        .iter()
        .any(|suffix| normalized.ends_with(suffix))
    {
        return true;
    }
    if !normalized.contains('.') && normalized.parse::<IpAddr>().is_err() {
        return true;
    }

    if let Ok(ip) = normalized.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(addr) => is_ipv4_blocked(&addr),
            IpAddr::V6(addr) => is_ipv6_blocked(&addr),
        };
    }

    if let Some(mapped) = normalized.split("::ffff:").last() {
        if let Ok(addr) = mapped.parse::<Ipv4Addr>() {
            if is_ipv4_blocked(&addr) {
                return true;
            }
        }
    }

    false
}

fn is_ipv4_blocked(addr: &Ipv4Addr) -> bool {
    let value = ipv4_to_u32(*addr);
    IPV4_RANGES
        .iter()
        .any(|(base, mask)| (value & mask) == *base)
}

fn is_ipv6_blocked(addr: &Ipv6Addr) -> bool {
    if addr.is_loopback() || addr.is_unspecified() {
        return true;
    }
    if let Some(mapped) = addr.to_ipv4() {
        return is_ipv4_blocked(&mapped);
    }

    let segments = addr.segments();
    let first = segments[0];
    if (first & 0xff00) == 0xfc00 || (first & 0xfe00) == 0xfc00 {
        return true;
    }
    if (first & 0xffc0) == 0xfe80 {
        return true;
    }
    if (first & 0xff00) == 0xff00 {
        return true;
    }

    false
}

fn ipv4_to_u32(addr: Ipv4Addr) -> u32 {
    u32::from_be_bytes(addr.octets())
}
