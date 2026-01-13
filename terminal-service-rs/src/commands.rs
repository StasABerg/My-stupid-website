use crate::config::Config;
use crate::sandbox::{format_timestamp, resolve_virtual_path, safe_metadata, sanitize_virtual_path, split_lines, to_display_path, to_real_path};

use serde::Serialize;
use std::collections::HashSet;
use std::os::unix::fs::MetadataExt;
use std::time::SystemTime;
use sysinfo::System;

const MAX_COMMAND_LENGTH: usize = 256;
const MAX_ARGS: usize = 32;

#[derive(Debug)]
pub struct CommandHandlers {
    config: Config,
}

impl CommandHandlers {
    pub fn new(config: Config) -> Self {
        Self { config }
    }

    pub async fn handle_execute(&self, input: &str, cwd: Option<&str>) -> CommandOutcome {
        let trimmed = input.trim();
        let default_cwd = &self.config.default_virtual_home;

        if trimmed.is_empty() {
            let sanitized = sanitize_virtual_path(cwd, default_cwd).unwrap_or_else(|_| default_cwd.clone());
            return CommandOutcome::from_result(
                input,
                default_cwd,
                CommandResult::new(sanitized, vec![], false, false),
                200,
            );
        }

        if trimmed.len() > MAX_COMMAND_LENGTH {
            return CommandOutcome::validation_error(format!(
                "Command length exceeds limit of {MAX_COMMAND_LENGTH}"
            ));
        }

        let current_cwd = match sanitize_virtual_path(cwd, default_cwd) {
            Ok(cwd) => cwd,
            Err(_) => {
                return CommandOutcome::from_sandbox_error(
                    input,
                    default_cwd,
                    default_cwd,
                    SandboxError::new("Invalid working directory", 422),
                );
            }
        };

        let mut parts = trimmed.split_whitespace();
        let raw_command = parts.next().unwrap_or("");
        let args: Vec<&str> = parts.collect();
        if args.len() > MAX_ARGS {
            return CommandOutcome::validation_error(format!(
                "Too many arguments; maximum is {MAX_ARGS}"
            ));
        }

        let command = raw_command.to_lowercase();
        let result = match command.as_str() {
            "help" => Ok(CommandResult::new(
                current_cwd.clone(),
                self.config.help_text.clone(),
                false,
                false,
            )),
            "clear" => Ok(CommandResult::new(current_cwd.clone(), vec![], false, true)),
            "ls" => handle_ls(&self.config, &current_cwd, &args).await,
            "pwd" => {
                let display = to_display_path(&current_cwd, default_cwd).unwrap_or_else(|_| current_cwd.clone());
                Ok(CommandResult::new(current_cwd.clone(), vec![display], false, false))
            }
            "whoami" => Ok(CommandResult::new(
                current_cwd.clone(),
                vec!["sandbox-runner".to_string()],
                false,
                false,
            )),
            "cat" => handle_cat(&self.config, &current_cwd, &args).await,
            "cd" => handle_cd(&self.config, &current_cwd, &args)
                .await
                .map(|new_cwd| CommandResult::new(new_cwd, vec![], false, false)),
            "history" => Ok(CommandResult::new(
                current_cwd.clone(),
                vec!["History is tracked client-side for each session.".to_string()],
                false,
                false,
            )),
            "echo" => Ok(CommandResult::new(
                current_cwd.clone(),
                vec![args.join(" ")],
                false,
                false,
            )),
            "motd" => {
                let (output, error) = self.read_motd().await;
                Ok(CommandResult::new(current_cwd.clone(), output, error, false))
            }
            "uname" => handle_uname(&self.config, &args)
                .await
                .map(|output| CommandResult::new(current_cwd.clone(), vec![output], false, false)),
            _ => {
                let result = CommandResult::new(
                    current_cwd.clone(),
                    vec![
                        format!("Command \"{}\" is not available in this sandbox.", command),
                        "Type `help` to see supported commands.".to_string(),
                    ],
                    true,
                    false,
                );
                return CommandOutcome::from_result(input, default_cwd, result, 400);
            }
        };

        match result {
            Ok(result) => CommandOutcome::from_result(input, default_cwd, result, 200),
            Err(error) => CommandOutcome::from_sandbox_error(
                input,
                &current_cwd,
                default_cwd,
                error,
            ),
        }
    }

    pub async fn handle_info(&self, motd: Vec<String>) -> InfoResponse {
        let display = to_display_path(&self.config.default_virtual_home, &self.config.default_virtual_home)
            .unwrap_or_else(|_| "~".to_string());
        InfoResponse {
            display_cwd: display,
            virtual_cwd: self.config.default_virtual_home.clone(),
            supported_commands: supported_commands(),
            motd,
        }
    }

    async fn read_motd(&self) -> (Vec<String>, bool) {
        if self.config.motd_virtual_path.is_empty() {
            return (vec![], false);
        }
        match tokio::fs::read_to_string(&self.config.motd_virtual_path).await {
            Ok(content) => (
                content
                    .lines()
                    .map(|line| line.trim())
                    .filter(|line| !line.is_empty())
                    .map(|line| line.to_string())
                    .collect(),
                false,
            ),
            Err(_) => (
                vec!["motd: Failed to read message of the day.".to_string()],
                true,
            ),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct InfoResponse {
    #[serde(rename = "displayCwd")]
    pub display_cwd: String,
    #[serde(rename = "virtualCwd")]
    pub virtual_cwd: String,
    #[serde(rename = "supportedCommands")]
    pub supported_commands: Vec<String>,
    pub motd: Vec<String>,
}

#[derive(Debug)]
pub struct CommandOutcome {
    pub status: u16,
    pub payload: serde_json::Value,
}

impl CommandOutcome {
    fn from_result(command: &str, display_base: &str, result: CommandResult, status: u16) -> Self {
        let display = to_display_path(&result.cwd, display_base).unwrap_or_else(|_| result.cwd.clone());
        let mut payload = serde_json::json!({
            "command": command,
            "displayCwd": display,
            "cwd": result.cwd,
            "output": result.output,
            "error": result.error
        });
        if result.clear {
            payload["clear"] = serde_json::json!(true);
        }
        Self { status, payload }
    }

    fn from_sandbox_error(
        command: &str,
        current_cwd: &str,
        display_base: &str,
        error: SandboxError,
    ) -> Self {
        let result = CommandResult::new(
            current_cwd.to_string(),
            vec![error.message.clone()],
            true,
            false,
        );
        Self::from_result(command, display_base, result, error.status)
    }

    pub fn validation_error(message: String) -> Self {
        Self {
            status: 422,
            payload: serde_json::json!({ "message": message }),
        }
    }

    pub fn malformed_body() -> Self {
        Self {
            status: 400,
            payload: serde_json::json!({ "message": "Malformed JSON body" }),
        }
    }

    pub fn invalid_json() -> Self {
        Self {
            status: 400,
            payload: serde_json::json!({ "message": "Invalid JSON payload" }),
        }
    }
}

#[derive(Debug)]
struct CommandResult {
    output: Vec<String>,
    error: bool,
    cwd: String,
    clear: bool,
}

impl CommandResult {
    fn new(cwd: String, output: Vec<String>, error: bool, clear: bool) -> Self {
        Self {
            output,
            error,
            cwd,
            clear,
        }
    }
}

#[derive(Debug)]
struct SandboxError {
    message: String,
    status: u16,
}

impl SandboxError {
    fn new(message: &str, status: u16) -> Self {
        Self {
            message: message.to_string(),
            status,
        }
    }
}

async fn handle_ls(config: &Config, current_cwd: &str, args: &[&str]) -> std::result::Result<CommandResult, SandboxError> {
    let flags = parse_ls_args(config, args)?;
    let show_all = flags.iter().any(|flag| flag.contains('a'));
    let long_format = flags.iter().any(|flag| flag.contains('l'));
    let human_readable = flags.iter().any(|flag| flag.contains('h'));
    let path_arg = args.iter().find(|arg| !arg.starts_with('-')).copied();
    let target_virtual = if let Some(path_arg) = path_arg {
        resolve_virtual_path(current_cwd, Some(path_arg), &config.default_virtual_home)
            .map_err(|_| SandboxError::new("ls: invalid path", 422))?
    } else {
        current_cwd.to_string()
    };
    let real_target = to_real_path(&target_virtual, config)
        .map_err(|_| SandboxError::new("ls: invalid path", 422))?;
    let target_metadata = safe_metadata(&real_target)
        .await
        .map_err(|_| SandboxError::new("ls: failed to read path", 500))?;

    let Some(target_metadata) = target_metadata else {
        let label = path_arg.unwrap_or(".");
        return Err(SandboxError::new(
            &format!("ls: {label}: No such file or directory"),
            404,
        ));
    };

    if target_metadata.is_dir() {
        let mut results = Vec::new();
        if show_all {
            results.push(entry_line(".", &target_metadata, long_format, human_readable));
            let parent_virtual = resolve_virtual_path(&target_virtual, Some(".."), &config.default_virtual_home)
                .map_err(|_| SandboxError::new("ls: invalid path", 422))?;
            if let Some(parent_metadata) = safe_metadata(&to_real_path(&parent_virtual, config).map_err(|_| SandboxError::new("ls: invalid path", 422))?)
                .await
                .map_err(|_| SandboxError::new("ls: failed to read path", 500))?
            {
                results.push(entry_line("..", &parent_metadata, long_format, human_readable));
            }
        }

        let mut entries = tokio::fs::read_dir(real_target)
            .await
            .map_err(|_| SandboxError::new("ls: failed to read directory", 500))?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|_| SandboxError::new("ls: failed to read directory", 500))?
        {
            let name = entry.file_name().to_string_lossy().to_string();
            if !show_all && name.starts_with('.') {
                continue;
            }
            if let Some(metadata) = safe_metadata(&entry.path())
                .await
                .map_err(|_| SandboxError::new("ls: failed to read directory", 500))?
            {
                results.push(entry_line(&name, &metadata, long_format, human_readable));
            }
        }

        return Ok(CommandResult::new(
            current_cwd.to_string(),
            results,
            false,
            false,
        ));
    }

    let name = path_arg.unwrap_or(&target_virtual);
    let output = if long_format {
        vec![entry_line(name, &target_metadata, true, human_readable)]
    } else {
        vec![name.to_string()]
    };

    Ok(CommandResult::new(
        current_cwd.to_string(),
        output,
        false,
        false,
    ))
}

fn entry_line(name: &str, metadata: &std::fs::Metadata, long_format: bool, human_readable: bool) -> String {
    if !long_format {
        return name.to_string();
    }

    let permissions = format_permissions(metadata);
    let links = format!("{:>2}", metadata.nlink());
    let owner = format!("{:<5}", metadata.uid());
    let group = format!("{:<5}", metadata.gid());
    let size_value = if human_readable {
        format_human_readable_size(metadata.len())
    } else {
        metadata.len().to_string()
    };
    let size = if human_readable {
        format!("{:>5}", size_value)
    } else {
        format!("{:>8}", size_value)
    };
    let mtime = metadata.modified().unwrap_or(SystemTime::now());
    let mtime = format_timestamp(mtime);
    format!("{permissions} {links} {owner} {group} {size} {mtime} {name}")
}

fn format_permissions(metadata: &std::fs::Metadata) -> String {
    let mode = metadata.mode();
    let mut modes = Vec::with_capacity(10);
    modes.push(if metadata.is_dir() { 'd' } else { '-' });
    modes.push(if mode & 0o400 != 0 { 'r' } else { '-' });
    modes.push(if mode & 0o200 != 0 { 'w' } else { '-' });
    modes.push(if mode & 0o100 != 0 { 'x' } else { '-' });
    modes.push(if mode & 0o040 != 0 { 'r' } else { '-' });
    modes.push(if mode & 0o020 != 0 { 'w' } else { '-' });
    modes.push(if mode & 0o010 != 0 { 'x' } else { '-' });
    modes.push(if mode & 0o004 != 0 { 'r' } else { '-' });
    modes.push(if mode & 0o002 != 0 { 'w' } else { '-' });
    modes.push(if mode & 0o001 != 0 { 'x' } else { '-' });
    modes.iter().collect()
}

fn format_human_readable_size(bytes: u64) -> String {
    let units = ["B", "K", "M", "G", "T"];
    let mut size = bytes as f64;
    let mut index = 0;
    while size >= 1024.0 && index < units.len() - 1 {
        size /= 1024.0;
        index += 1;
    }
    if index == 0 {
        format!("{}{}", size as u64, units[index])
    } else {
        format!("{:.1}{}", size, units[index])
    }
}

fn parse_ls_args(config: &Config, args: &[&str]) -> std::result::Result<Vec<String>, SandboxError> {
    let allowed: HashSet<&str> = config.ls_allowed_flags.iter().map(|s| s.as_str()).collect();
    let mut flags = Vec::new();
    let mut positional = Vec::new();

    for arg in args {
        if arg.starts_with('-') {
            if !allowed.contains(*arg) {
                return Err(SandboxError::new(&format!("Flag \"{}\" is not allowed", arg), 422));
            }
            flags.push((*arg).to_string());
        } else {
            positional.push(*arg);
        }
    }

    if positional.len() > 1 {
        return Err(SandboxError::new(
            "ls accepts at most a single path in this sandbox",
            422,
        ));
    }

    Ok(flags)
}

async fn handle_cat(config: &Config, current_cwd: &str, args: &[&str]) -> std::result::Result<CommandResult, SandboxError> {
    if args.is_empty() {
        return Ok(CommandResult::new(
            current_cwd.to_string(),
            vec!["cat: missing file operand".to_string()],
            true,
            false,
        ));
    }
    if args.len() > 1 {
        return Ok(CommandResult::new(
            current_cwd.to_string(),
            vec!["cat: multiple files are not supported in this sandbox".to_string()],
            true,
            false,
        ));
    }

    let target_virtual = resolve_virtual_path(current_cwd, Some(args[0]), &config.default_virtual_home)
        .map_err(|_| SandboxError::new("Invalid working directory", 422))?;
    let real_path = to_real_path(&target_virtual, config)
        .map_err(|_| SandboxError::new("Invalid working directory", 422))?;
    match tokio::fs::read_to_string(real_path).await {
        Ok(content) => Ok(CommandResult::new(
            current_cwd.to_string(),
            split_lines(&content),
            false,
            false,
        )),
        Err(error) => {
            let message = if error.kind() == std::io::ErrorKind::NotFound {
                "No such file"
            } else {
                "Cannot read file"
            };
            Ok(CommandResult::new(
                current_cwd.to_string(),
                vec![format!("cat: {}: {}", args[0], message)],
                true,
                false,
            ))
        }
    }
}

async fn handle_cd(config: &Config, current_cwd: &str, args: &[&str]) -> std::result::Result<String, SandboxError> {
    if args.is_empty() {
        return Ok(config.default_virtual_home.clone());
    }
    if args.len() > 1 {
        return Err(SandboxError::new("cd: too many arguments", 422));
    }

    let target_virtual = resolve_virtual_path(current_cwd, Some(args[0]), &config.default_virtual_home)
        .map_err(|_| SandboxError::new("cd: invalid path", 422))?;
    let real_path = to_real_path(&target_virtual, config)
        .map_err(|_| SandboxError::new("cd: invalid path", 422))?;
    let metadata = safe_metadata(&real_path)
        .await
        .map_err(|_| SandboxError::new("cd: failed to read path", 500))?;
    if metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false) {
        Ok(target_virtual)
    } else {
        Err(SandboxError::new(
            &format!("cd: {}: No such directory", args[0]),
            404,
        ))
    }
}

async fn handle_uname(config: &Config, args: &[&str]) -> std::result::Result<String, SandboxError> {
    let allowed: HashSet<&str> = config.uname_allowed_flags.iter().map(|s| s.as_str()).collect();
    for arg in args {
        if !allowed.contains(*arg) {
            return Err(SandboxError::new(&format!("Flag \"{}\" is not allowed", arg), 422));
        }
    }

    let kernel_name = System::name().unwrap_or_else(|| "Linux".to_string());
    let release = System::kernel_version().unwrap_or_else(|| "unknown".to_string());
    let machine = std::env::consts::ARCH.to_string();
    let hostname = hostname::get()
        .ok()
        .and_then(|value| value.into_string().ok())
        .unwrap_or_else(|| "unknown".to_string());
    let version = System::long_os_version().unwrap_or_default();

    if args.contains(&"-a") {
        return Ok(format!(
            "{} {} {} {} {}",
            kernel_name, hostname, release, version, machine
        )
        .trim()
        .to_string());
    }
    if args.contains(&"-r") {
        return Ok(release);
    }
    if args.contains(&"-m") {
        return Ok(machine);
    }
    if args.contains(&"-s") {
        return Ok(kernel_name);
    }
    Ok(kernel_name)
}

fn supported_commands() -> Vec<String> {
    vec![
        "help",
        "clear",
        "ls",
        "pwd",
        "whoami",
        "cat",
        "cd",
        "history",
        "echo",
        "motd",
        "uname",
    ]
    .into_iter()
    .map(|cmd| cmd.to_string())
    .collect()
}
