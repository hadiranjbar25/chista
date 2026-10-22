use std::{env, path::{Path, PathBuf}, process::Command};

fn shell_quote(value: &str) -> String { format!("'{}'", value.replace('\'', "'\\''")) }
fn executable(path: &Path) -> bool {
    if !path.is_file() { return false; }
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; return path.metadata().map(|m| m.permissions().mode() & 0o111 != 0).unwrap_or(false); }
    #[cfg(not(unix))] { true }
}
fn resolve_claude(configured: &str) -> Result<PathBuf, String> {
    if !configured.trim().is_empty() {
        let path = PathBuf::from(configured);
        if !path.is_absolute() || !executable(&path) { return Err("Choose an absolute path to an executable Claude Code CLI.".into()); }
        return path.canonicalize().map_err(|_| "Cannot resolve Claude executable.".into());
    }
    let mut candidates = Vec::new();
    if let Some(home) = env::var_os("HOME") { candidates.push(PathBuf::from(home).join(".local/bin/claude")); }
    for path in ["/opt/homebrew/bin/claude", "/usr/local/bin/claude"] { candidates.push(PathBuf::from(path)); }
    if let Some(paths) = env::var_os("PATH") { candidates.extend(env::split_paths(&paths).map(|p| p.join("claude"))); }
    candidates.into_iter().find(|p| executable(p)).and_then(|p| p.canonicalize().ok()).ok_or_else(|| "Claude Code was not found. Set its executable path in Settings > Models, or install it separately.".into())
}
#[tauri::command]
pub fn claude_status(executable_path: String) -> Result<String, String> {
    resolve_claude(&executable_path).map(|p| p.to_string_lossy().into_owned())
}
#[tauri::command]
pub fn launch_claude(project_path: String, executable_path: String) -> Result<String, String> {
    let project = PathBuf::from(project_path);
    if !project.is_absolute() || !project.is_dir() { return Err("Select an existing absolute project directory.".into()); }
    let project = project.canonicalize().map_err(|_| "Project directory is inaccessible.")?;
    let binary = resolve_claude(&executable_path)?;
    // No prompt, debug file, context payload or credential is passed to the external agent.
    #[cfg(target_os = "macos")]
    {
        let command = format!("cd -- {} && {}", shell_quote(&project.to_string_lossy()), shell_quote(&binary.to_string_lossy()));
        // AppleScript receives the command as argv, never interpolated into AppleScript source.
        let script = "on run argv\ntell application \"Terminal\"\nactivate\ndo script (item 1 of argv)\nend tell\nend run";
        let result = Command::new("/usr/bin/osascript").args(["-e", script, "--", &command]).output().map_err(|_| "Could not open macOS Terminal.")?;
        if !result.status.success() { return Err("Terminal launch failed. Check macOS Automation permission for Chista.".into()); }
        return Ok("Opened Claude Code in Terminal. Complete sign-in and project trust in its native flow.".into());
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("x-terminal-emulator").current_dir(project).arg("-e").arg(binary).spawn().map_err(|_| "Install/configure x-terminal-emulator to launch Claude Code.")?;
        return Ok("Opened Claude Code in your terminal. Complete native sign-in there.".into());
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    { let _ = (project, binary); Err("Terminal launch is currently supported on macOS and Linux only.".into()) }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn quotes_shell_metacharacters() { assert_eq!(shell_quote("a'b;$(touch nope)"), "'a'\\''b;$(touch nope)'"); }
    #[test] fn rejects_relative_executable() { assert!(resolve_claude("./claude").is_err()); }
    #[test] fn rejects_missing_project() { assert!(launch_claude("/this-project-does-not-exist".into(), "".into()).is_err()); }
}
