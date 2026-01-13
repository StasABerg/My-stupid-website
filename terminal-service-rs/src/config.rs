use anyhow::{Result, anyhow};
use std::env;
use std::path::{Path, PathBuf};

const DEFAULT_PORT: u16 = 8080;
const DEFAULT_MAX_PAYLOAD_BYTES: usize = 2048;
const DEFAULT_VIRTUAL_HOME: &str = "/home/demo";

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub sandbox_root: PathBuf,
    pub max_payload_bytes: usize,
    pub default_virtual_home: String,
    pub help_text: Vec<String>,
    pub motd_virtual_path: String,
    pub ls_allowed_flags: Vec<String>,
    pub uname_allowed_flags: Vec<String>,
    pub allowed_origins: Vec<String>,
    pub allow_all_origins: bool,
}

impl Config {
    pub fn load() -> Result<Self> {
        let port = parse_port("PORT", DEFAULT_PORT)?;
        let max_payload_bytes = parse_positive("MAX_PAYLOAD_BYTES", DEFAULT_MAX_PAYLOAD_BYTES)?;
        let sandbox_root = env::var("SANDBOX_ROOT").unwrap_or_else(|_| "/app/sandbox".to_string());
        let sandbox_root = PathBuf::from(sandbox_root);
        validate_sandbox_root(&sandbox_root)?;

        let default_virtual_home = env::var("DEFAULT_VIRTUAL_HOME")
            .unwrap_or_else(|_| DEFAULT_VIRTUAL_HOME.to_string());
        let motd_virtual_path = env::var("MOTD_PATH").unwrap_or_default();

        let allowed_origins = parse_list(&env::var("CORS_ALLOW_ORIGIN").unwrap_or_default());
        let allow_all_origins = env::var("ALLOW_ALL_ORIGINS")
            .unwrap_or_default()
            .eq_ignore_ascii_case("true");
        let allow_all_origins = allow_all_origins && allowed_origins.iter().any(|origin| origin == "*");

        if !allow_all_origins && allowed_origins.is_empty() {
            return Err(anyhow!(
                "CORS_ALLOW_ORIGIN must include at least one allowed origin (or set ALLOW_ALL_ORIGINS=true with \"*\")"
            ));
        }

        Ok(Self {
            port,
            sandbox_root,
            max_payload_bytes,
            default_virtual_home,
            help_text: help_text_lines(),
            motd_virtual_path,
            ls_allowed_flags: vec![
                "-a".into(),
                "-l".into(),
                "-la".into(),
                "-al".into(),
                "-lh".into(),
                "-hl".into(),
                "-lah".into(),
                "-hal".into(),
            ],
            uname_allowed_flags: vec!["-a".into(), "-s".into(), "-r".into(), "-m".into()],
            allowed_origins,
            allow_all_origins,
        })
    }
}

fn parse_port(name: &str, fallback: u16) -> Result<u16> {
    match env::var(name) {
        Ok(value) => {
            let parsed = value.trim().parse::<u16>().unwrap_or(0);
            if parsed == 0 {
                Err(anyhow!("{name} must be greater than zero"))
            } else {
                Ok(parsed)
            }
        }
        Err(_) => Ok(fallback),
    }
}

fn parse_positive(name: &str, fallback: usize) -> Result<usize> {
    match env::var(name) {
        Ok(value) => {
            let parsed = value.trim().parse::<usize>().unwrap_or(0);
            if parsed == 0 {
                Err(anyhow!("{name} must be greater than zero"))
            } else {
                Ok(parsed)
            }
        }
        Err(_) => Ok(fallback),
    }
}

fn parse_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(|item| item.to_string())
        .collect()
}

fn validate_sandbox_root(path: &Path) -> Result<()> {
    if !path.is_absolute() || path == Path::new("/") {
        return Err(anyhow!(
            "SANDBOX_ROOT must be an absolute, non-root path; got {}",
            path.display()
        ));
    }
    Ok(())
}

fn help_text_lines() -> Vec<String> {
    vec![
        "Available commands:".to_string(),
        "  help       Show this help".to_string(),
        "  clear      Clear the terminal output".to_string(),
        "  ls [path]  List directory contents (flags: -a, -l, -la, -lh, -lah)".to_string(),
        "  pwd        Print the current directory".to_string(),
        "  whoami     Show the simulated user".to_string(),
        "  cat FILE   Display a file inside the sandbox".to_string(),
        "  cd DIR     Change the current directory".to_string(),
        "  history    History is tracked in your browser".to_string(),
        "  echo TEXT  Print the provided text".to_string(),
        "  motd       Display the message of the day".to_string(),
        "".to_string(),
        "Commands run inside an isolated sandbox with no network access.".to_string(),
    ]
}
