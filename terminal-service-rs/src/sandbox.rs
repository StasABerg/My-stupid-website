use crate::config::Config;
use anyhow::{Result, anyhow};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tokio::fs::{self, OpenOptions};
use tokio::io::AsyncWriteExt;

const DEFAULT_FILES: &[(&str, &[&str])] = &[
    (
        "/home/demo/README.md",
        &[
            "# Welcome to the sandbox",
            "",
            "You are exploring a read-only environment managed by the gitgud terminal service.",
            "",
            "Try these commands:",
            "- help",
            "- ls",
            "- cat about.txt",
            "- cd projects",
            "- ls -la",
        ],
    ),
    (
        "/home/demo/about.txt",
        &[
            "User: sandbox-runner",
            "Role: Terminal explorer",
            "Shell: gitgudsh (restricted)",
            "Hint: Use `motd` for the message of the day.",
        ],
    ),
    (
        "/home/demo/projects/README.md",
        &[
            "# Projects",
            "",
            "- codex-terminal",
            "- potato-launcher",
            "- keyboard-navigator",
        ],
    ),
    (
        "/home/demo/projects/nebula.log",
        &[
            "== nebula status ==",
            "hyperdrive: ready",
            "shields: nominal",
            "cheese reserves: critical",
        ],
    ),
    (
        "/home/demo/secrets/classified.txt",
        &["Access denied. This sandbox is read-only."],
    ),
];

pub const DEFAULT_DIRECTORIES: &[&str] = &[
    "/home/demo",
    "/home/demo/projects",
    "/home/demo/secrets",
    "/usr/bin",
    "/etc",
];

pub fn normalize_virtual(value: &str) -> Result<String> {
    if value.contains('\0') {
        return Err(anyhow!("Invalid path character detected"));
    }
    if !value.starts_with('/') {
        return Err(anyhow!("Virtual paths must be absolute"));
    }

    let mut parts: Vec<&str> = Vec::new();
    for component in Path::new(value).components() {
        use std::path::Component;
        match component {
            Component::RootDir => {
                parts.clear();
            }
            Component::ParentDir => {
                parts.pop();
            }
            Component::CurDir => {}
            Component::Normal(segment) => {
                if let Some(segment) = segment.to_str() {
                    parts.push(segment);
                }
            }
            _ => {}
        }
    }

    let normalized = if parts.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", parts.join("/"))
    };

    Ok(normalized)
}

pub fn sanitize_virtual_path(input: Option<&str>, default_cwd: &str) -> Result<String> {
    let raw = input.unwrap_or("");
    if raw.trim().is_empty() {
        return normalize_virtual(default_cwd);
    }
    normalize_virtual(raw)
}

pub fn resolve_virtual_path(current: &str, input: Option<&str>, default_cwd: &str) -> Result<String> {
    let base = sanitize_virtual_path(Some(current), default_cwd)?;
    let input = input.unwrap_or("");
    if input.is_empty() || input == "." {
        return Ok(base);
    }
    if input.starts_with('/') {
        return sanitize_virtual_path(Some(input), default_cwd);
    }
    let combined = Path::new(&base).join(input);
    normalize_virtual(combined.to_string_lossy().as_ref())
}

pub fn to_real_path(virtual_path: &str, config: &Config) -> Result<PathBuf> {
    let normalized = sanitize_virtual_path(Some(virtual_path), &config.default_virtual_home)?;
    let resolved = config.sandbox_root.join(format!(".{normalized}"));
    if resolved != config.sandbox_root && !resolved.starts_with(&config.sandbox_root) {
        return Err(anyhow!("Resolved path escapes sandbox: {virtual_path}"));
    }
    Ok(resolved)
}

pub fn to_display_path(virtual_path: &str, default_cwd: &str) -> Result<String> {
    let normalized = sanitize_virtual_path(Some(virtual_path), default_cwd)?;
    if normalized == default_cwd || normalized.starts_with(&format!("{default_cwd}/")) {
        let suffix = normalized.strip_prefix(default_cwd).unwrap_or("");
        if suffix.is_empty() {
            return Ok("~".to_string());
        }
        return Ok(format!("~{suffix}"));
    }
    Ok(normalized)
}

pub fn split_lines(raw: &str) -> Vec<String> {
    if raw.is_empty() {
        return vec![];
    }
    raw.replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(|line| line.to_string())
        .collect()
}

pub async fn safe_metadata(real_path: &Path) -> Result<Option<std::fs::Metadata>> {
    match fs::metadata(real_path).await {
        Ok(metadata) => Ok(Some(metadata)),
        Err(_) => Ok(None),
    }
}

pub async fn ensure_sandbox_filesystem(config: &Config) -> Result<()> {
    for directory in DEFAULT_DIRECTORIES {
        let path = to_real_path(directory, config)?;
        fs::create_dir_all(path).await?;
    }

    for (virtual_path, lines) in DEFAULT_FILES {
        write_if_missing(config, virtual_path, lines.join("\n").as_str()).await?;
    }

    write_if_missing(
        config,
        &config.motd_virtual_path,
        "Welcome to gitgud.zip\nThis sandbox resets between sessions and has no network access.",
    )
    .await?;

    Ok(())
}

async fn write_if_missing(config: &Config, virtual_path: &str, content: &str) -> Result<()> {
    let path = to_real_path(virtual_path, config)?;
    if fs::metadata(&path).await.is_ok() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .await?;
    file.write_all(content.as_bytes()).await?;
    Ok(())
}

pub fn format_timestamp(time: SystemTime) -> String {
    let datetime = time::OffsetDateTime::from(time);
    let format = time::format_description::parse("[month repr:short] [day padding:space] [hour]:[minute]")
        .unwrap_or_else(|_| vec![]);
    datetime
        .format(&format)
        .unwrap_or_else(|_| datetime.to_string())
}
