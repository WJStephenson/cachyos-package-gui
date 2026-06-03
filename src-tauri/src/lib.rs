use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader, Write};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::fs::File;
use std::os::unix::fs::PermissionsExt;
use tauri::Emitter;

// Dynamic setup of GUI askpass helper for password prompts inside paru transactions
fn setup_askpass() -> Result<String, String> {
    let path = "/tmp/cachyos-pkgmgr-askpass";
    let script_content = "#!/bin/bash\n/usr/bin/zenity --entry --title=\"CachyOS Package Manager\" --text=\"Authentication required to install packages:\" --hide-text\n";
    
    let mut file = File::create(path).map_err(|e| format!("Failed to create askpass file: {}", e))?;
    file.write_all(script_content.as_bytes()).map_err(|e| format!("Failed to write askpass file: {}", e))?;
    
    let mut perms = file.metadata().map_err(|e| format!("Failed to read metadata: {}", e))?.permissions();
    perms.set_mode(0o755); // Read, write, execute for owner; read and execute for group and others
    std::fs::set_permissions(path, perms).map_err(|e| format!("Failed to set permissions: {}", e))?;
    
    Ok(path.to_string())
}

// Structure for representing locally installed packages
#[derive(serde::Serialize, Clone)]
pub struct LocalPackage {
    pub name: String,
    pub version: String,
    pub repo_type: String,
}

// Structure for representing unified repository and AUR packages
#[derive(serde::Serialize, Clone)]
pub struct RepositoryPackage {
    pub name: String,
    pub version: String,
    pub repo: String,
    pub description: String,
    pub is_installed: bool,
    pub out_of_date: Option<String>,
}

// Structure representing pending system updates
#[derive(serde::Serialize, Clone)]
pub struct UpgradablePackage {
    pub name: String,
    pub current_version: String,
    pub new_version: String,
    pub repo_type: String,
}

// Structure representing a single line emitted to the transaction window
#[derive(serde::Serialize, Clone)]
pub struct TransactionLine {
    pub transaction_id: String,
    pub stream: String,
    pub content: String,
}

// Structure representing transaction completion status
#[derive(serde::Serialize, Clone)]
pub struct TransactionStatus {
    pub transaction_id: String,
    pub exit_code: i32,
    pub success: bool,
}

// State registry to manage and clean up active child processes
pub struct ActiveProcessState {
    pub processes: Arc<Mutex<HashMap<String, Arc<Mutex<std::process::Child>>>>>,
}

impl Default for ActiveProcessState {
    fn default() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// Retrieve explicitly installed packages via `pacman -Qe`
#[tauri::command]
fn get_installed_packages() -> Result<Vec<LocalPackage>, String> {
    // 1. Get foreign (AUR) packages list to determine repositories
    let foreign_output = Command::new("pacman")
        .args(["-Qm"])
        .output();

    let mut foreign_names = std::collections::HashSet::new();
    if let Ok(out) = foreign_output {
        if out.status.success() {
            let out_str = String::from_utf8_lossy(&out.stdout);
            for line in out_str.lines() {
                if let Some(first_word) = line.split_whitespace().next() {
                    foreign_names.insert(first_word.to_string());
                }
            }
        }
    }

    // 2. Fetch explicitly installed packages
    let output = Command::new("pacman")
        .args(["-Qe"])
        .output()
        .map_err(|e| format!("Failed to execute pacman: {}", e))?;

    if !output.status.success() {
        let err_str = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("pacman failed: {}", err_str));
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let mut packages = Vec::new();

    for line in stdout_str.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() >= 2 {
            let name = parts[0].to_string();
            let version = parts[1].to_string();
            let repo_type = if foreign_names.contains(&name) {
                "AUR".to_string()
            } else {
                "Official".to_string()
            };
            packages.push(LocalPackage {
                name,
                version,
                repo_type,
            });
        }
    }

    Ok(packages)
}

/// Search official repositories and AUR using `paru -Ss <query>`
/// Safely parses two-line native paru output into structured package definitions,
/// extracting AUR out-of-date flags if present.
#[tauri::command]
fn search_repositories(query: String) -> Result<Vec<RepositoryPackage>, String> {
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return Ok(Vec::new());
    }

    let output = Command::new("paru")
        .args(["-Ss", trimmed_query])
        .output()
        .map_err(|e| format!("Failed to execute paru: {}", e))?;

    // Note: paru/pacman returns exit code 1 if no packages match the query.
    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let mut packages = Vec::new();
    let mut current_package: Option<RepositoryPackage> = None;

    for line in stdout_str.lines() {
        if line.trim().is_empty() {
            continue;
        }

        // Indented lines represent the description of the package above
        if line.starts_with(' ') || line.starts_with('\t') {
            if let Some(ref mut pkg) = current_package {
                let trimmed = line.trim();
                if pkg.description.is_empty() {
                    pkg.description = trimmed.to_string();
                } else {
                    pkg.description.push_str(" ");
                    pkg.description.push_str(trimmed);
                }
            }
        } else {
            // Header line. First push any previously accumulated package.
            if let Some(pkg) = current_package.take() {
                packages.push(pkg);
            }

            // Parse repository, name, version, and installation status
            if let Some(slash_idx) = line.find('/') {
                let repo = line[..slash_idx].trim().to_string();
                let rest = &line[slash_idx + 1..];
                let parts: Vec<&str> = rest.split_whitespace().collect();
                if parts.len() >= 2 {
                    let name = parts[0].to_string();
                    let version = parts[1].to_string();
                    let is_installed = line.contains("[Installed]") || line.contains("[installed]");
                    
                    // Parse out-of-date flag (AUR-specific)
                    let out_of_date = if let Some(idx) = line.find("[Out-of-date: ") {
                        let rest_part = &line[idx + 14..];
                        if let Some(end_idx) = rest_part.find(']') {
                            Some(rest_part[..end_idx].to_string())
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    current_package = Some(RepositoryPackage {
                        name,
                        version,
                        repo,
                        description: "".to_string(),
                        is_installed,
                        out_of_date,
                    });
                }
            }
        }
    }

    // Push the final package if any remains
    if let Some(pkg) = current_package {
        packages.push(pkg);
    }

    Ok(packages)
}

/// Query official repos (`checkupdates`) and AUR (`paru -Qua`) for available upgrades.
#[tauri::command]
fn get_upgradable_packages() -> Result<Vec<UpgradablePackage>, String> {
    let mut upgrades = Vec::new();

    // 1. Query official repository updates (safe, non-blocking checkupdates utility)
    if let Ok(output) = Command::new("checkupdates").output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if let Some(pkg) = parse_upgrade_line(line, "Official") {
                upgrades.push(pkg);
            }
        }
    }

    // 2. Query AUR updates (paru -Qua)
    if let Ok(output) = Command::new("paru").args(["-Qua"]).output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if let Some(pkg) = parse_upgrade_line(line, "AUR") {
                upgrades.push(pkg);
            }
        }
    }

    Ok(upgrades)
}

// Parses "package-name current_version -> new_version" into structured upgrades
fn parse_upgrade_line(line: &str, repo_type: &str) -> Option<UpgradablePackage> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() >= 4 && parts[2] == "->" {
        Some(UpgradablePackage {
            name: parts[0].to_string(),
            current_version: parts[1].to_string(),
            new_version: parts[3].to_string(),
            repo_type: repo_type.to_string(),
        })
    } else {
        None
    }
}

/// Retrieve comprehensive package details by calling `pacman -Qi` (installed) or `paru -Si` (sync repos/AUR)
/// and parses it line-by-line into a key-value HashMap.
#[tauri::command]
fn get_package_details(pkg_name: String) -> Result<HashMap<String, String>, String> {
    // 1. Try pacman -Qi first (checks installed packages database)
    let output_installed = Command::new("pacman")
        .args(["-Qi", &pkg_name])
        .output();

    let mut stdout = match output_installed {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).to_string(),
        _ => String::new(),
    };

    // 2. If not installed or pacman failed, try paru -Si (checks remote sync database & AUR)
    if stdout.trim().is_empty() {
        let output_sync = Command::new("paru")
            .args(["-Si", &pkg_name])
            .output()
            .map_err(|e| format!("Failed to invoke paru details: {}", e))?;

        if !output_sync.status.success() {
            let err_str = String::from_utf8_lossy(&output_sync.stderr).to_string();
            return Err(format!("Package not found: {}", err_str));
        }

        stdout = String::from_utf8_lossy(&output_sync.stdout).to_string();
    }

    Ok(parse_metadata(&stdout))
}

// Helper to parse key-value pacman metadata output, handling multi-line wrapped values correctly
fn parse_metadata(raw_stdout: &str) -> HashMap<String, String> {
    let mut map: HashMap<String, String> = HashMap::new();
    let mut current_key = String::new();

    for line in raw_stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // If a line starts with whitespace, it's a continuation of the previous key's values (like dependencies lists)
        if line.starts_with(' ') || line.starts_with('\t') {
            if !current_key.is_empty() {
                if let Some(existing_val) = map.get_mut(&current_key) {
                    existing_val.push_str(" ");
                    existing_val.push_str(trimmed);
                }
            }
        } else if let Some(colon_idx) = line.find(':') {
            // Main metadata key value line
            let key = line[..colon_idx].trim().to_string();
            let val = line[colon_idx + 1..].trim().to_string();
            if !key.is_empty() {
                current_key = key.clone();
                map.insert(key, val);
            }
        }
    }

    map
}

#[derive(serde::Serialize)]
struct OnlineVersion {
    version: String,
    url: String,
}

/// Query the online Arch Linux Archive (ALA) for all historical versions of a package.
#[tauri::command]
fn get_online_archive_versions(pkg_name: String) -> Result<Vec<OnlineVersion>, String> {
    let first_char = pkg_name
        .chars()
        .next()
        .map(|c| c.to_ascii_lowercase())
        .unwrap_or('a');
    let url = format!(
        "https://archive.archlinux.org/packages/{}/{}/",
        first_char, pkg_name
    );

    let output = Command::new("curl")
        .args(&["-sL", &url])
        .output()
        .map_err(|e| format!("Failed to execute curl: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to retrieve archive index (curl status: {})",
            output.status
        ));
    }

    let html = String::from_utf8_lossy(&output.stdout);
    let mut versions = Vec::new();

    for line in html.lines() {
        if line.contains("href=\"")
            && (line.contains(".pkg.tar.zst\"")
                || line.contains(".pkg.tar.xz\"")
                || line.contains(".pkg.tar.zst>")
                || line.contains(".pkg.tar.xz>"))
        {
            if let Some(href_pos) = line.find("href=\"") {
                let start_pos = href_pos + 6;
                if let Some(end_pos) = line[start_pos..].find("\"") {
                    let filename = &line[start_pos..start_pos + end_pos];
                    
                    if filename.starts_with(&format!("{}-", pkg_name)) && !filename.ends_with(".sig") {
                        let has_valid_ext = filename.ends_with(".pkg.tar.zst") || filename.ends_with(".pkg.tar.xz");
                        if has_valid_ext {
                            let rest = &filename[pkg_name.len() + 1..];
                            let parts: Vec<&str> = rest.split('-').collect();
                            if parts.len() >= 2 {
                                let version_parts = &parts[..parts.len() - 1];
                                let version = version_parts.join("-");
                                let download_url = format!("{}{}", url, filename);
                                versions.push(OnlineVersion {
                                    version,
                                    url: download_url,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // Sort versions in descending order (newest first)
    versions.sort_by(|a, b| b.version.cmp(&a.version));
    versions.dedup_by(|a, b| a.version == b.version);

    Ok(versions)
}

/// Query local pacman package cache directory for cached version files of a specific package.
#[tauri::command]
fn get_cached_versions(pkg_name: String) -> Result<Vec<String>, String> {
    let cache_dir = "/var/cache/pacman/pkg/";
    let mut versions = Vec::new();

    let paths = std::fs::read_dir(cache_dir)
        .map_err(|e| format!("Failed to read pacman cache directory: {}", e))?;

    for path_res in paths {
        if let Ok(entry) = path_res {
            let filename = entry.file_name().to_string_lossy().to_string();
            
            // Match files like <pkg_name>-<version>-<arch>.pkg.tar.zst
            if filename.starts_with(&format!("{}-", pkg_name)) && filename.ends_with(".pkg.tar.zst") {
                let rest = &filename[pkg_name.len() + 1..];
                let parts: Vec<&str> = rest.split('-').collect();
                if parts.len() >= 2 {
                    // The last part is `<arch>.pkg.tar.zst`
                    let version_parts = &parts[..parts.len() - 1];
                    let version = version_parts.join("-");
                    versions.push(version);
                }
            }
        }
    }

    // Sort versions reverse alphabetically so newer releases appear first
    versions.sort_by(|a, b| b.cmp(a));
    versions.dedup();

    Ok(versions)
}

/// Spawns a background package installation or update process.
/// If `version` is Some, performs a local file installation (`pacman -U`) from cache.
/// If official repo: utilizes `pkexec pacman -S --noconfirm <pkg_name>`
/// If AUR: utilizes `paru -S --noconfirm <pkg_name>`
/// Emits real-time line-by-line output to the frontend via the "tx-log" event.
#[tauri::command]
fn execute_package_update(
    app: tauri::AppHandle,
    pkg_name: String,
    repo_type: String,
    transaction_id: String,
    version: Option<String>,
    state: tauri::State<'_, ActiveProcessState>,
) -> Result<String, String> {
    // Check if we are doing a system-wide upgrade, local file rollback, or standard sync installation/upgrade
    let mut cmd = if pkg_name == "__all__" {
        // System-wide update
        // Check if paru is available on the system
        let paru_exists = Command::new("paru").arg("--version").output().is_ok();
        if paru_exists {
            let mut c = Command::new("paru");
            c.args(["-Syu", "--noconfirm"]);
            if let Ok(askpass_path) = setup_askpass() {
                c.env("SUDO_ASKPASS", askpass_path);
                c.args(["--sudoflags", "-A"]);
            }
            c
        } else {
            let mut c = Command::new("pkexec");
            c.args(["pacman", "-Syu", "--noconfirm"]);
            c
        }
    } else if let Some(ver) = version {
        if ver.starts_with("http://") || ver.starts_with("https://") {
            // Online archive install directly from URL
            let mut c = Command::new("pkexec");
            c.args(["pacman", "-U", "--noconfirm", &ver]);
            c
        } else {
            // Local file rollback/installation of a specific version
            let cache_dir = "/var/cache/pacman/pkg/";
            let mut matching_file = None;

            if let Ok(paths) = std::fs::read_dir(cache_dir) {
                for path_res in paths {
                    if let Ok(entry) = path_res {
                        let filename = entry.file_name().to_string_lossy().to_string();
                        if filename.starts_with(&format!("{}-{}-", pkg_name, ver)) 
                           && (filename.ends_with(".pkg.tar.zst") || filename.ends_with(".pkg.tar.xz")) {
                            matching_file = Some(filename);
                            break;
                        }
                    }
                }
            }

            let filename = matching_file.ok_or_else(|| format!("Version {} of {} not found in local system cache", ver, pkg_name))?;
            let full_path = format!("{}{}", cache_dir, filename);

            let mut c = Command::new("pkexec");
            c.args(["pacman", "-U", "--noconfirm", &full_path]);
            c
        }
    } else {
        // Standard sync installation/upgrade
        let is_aur = repo_type.to_lowercase() == "aur";
        if is_aur {
            let mut c = Command::new("paru");
            c.args(["-S", "--noconfirm"]);
            if let Ok(askpass_path) = setup_askpass() {
                c.env("SUDO_ASKPASS", askpass_path);
                c.args(["--sudoflags", "-A"]);
            }
            c.arg(&pkg_name);
            c
        } else {
            let mut c = Command::new("pkexec");
            c.args(["pacman", "-Sy", "--noconfirm", &pkg_name]); // Added -y to synchronize databases first
            c
        }
    };

    // Pipe outputs to read in real time
    cmd.stdout(Stdio::piped())
       .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to initiate package spawner process: {}", e))?;

    let stdout = child.stdout.take().ok_or("Failed to attach to process stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to attach to process stderr")?;

    let child_arc = Arc::new(Mutex::new(child));

    // Register active transaction child handle for potential cancellation
    if let Ok(mut procs) = state.processes.lock() {
        procs.insert(transaction_id.clone(), child_arc.clone());
    } else {
        return Err("Failed to access active process state registry".to_string());
    }

    // Background thread for streaming stdout
    let app_stdout = app.clone();
    let tx_id_stdout = transaction_id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line_res in reader.lines() {
            if let Ok(line) = line_res {
                let _ = app_stdout.emit("tx-log", TransactionLine {
                    transaction_id: tx_id_stdout.clone(),
                    stream: "stdout".to_string(),
                    content: line,
                });
            }
        }
    });

    // Background thread for streaming stderr
    let app_stderr = app.clone();
    let tx_id_stderr = transaction_id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line_res in reader.lines() {
            if let Ok(line) = line_res {
                let _ = app_stderr.emit("tx-log", TransactionLine {
                    transaction_id: tx_id_stderr.clone(),
                    stream: "stderr".to_string(),
                    content: line,
                });
            }
        }
    });

    // Background thread to monitor process termination, clean up state, and notify exit code
    let app_status = app;
    let tx_id_status = transaction_id.clone();
    let procs_clone = state.processes.clone();
    std::thread::spawn(move || {
        let wait_result = {
            let mut child_lock = child_arc.lock().unwrap();
            child_lock.wait()
        };

        // Remove package transaction from active registry
        if let Ok(mut procs) = procs_clone.lock() {
            procs.remove(&tx_id_status);
        }

        let exit_code = match wait_result {
            Ok(status) => status.code().unwrap_or(-1),
            Err(_) => -1,
        };

        let _ = app_status.emit("tx-complete", TransactionStatus {
            transaction_id: tx_id_status,
            exit_code,
            success: exit_code == 0,
        });
    });

    Ok(format!("Transaction {} spawned successfully", transaction_id))
}

/// Spawns a background package uninstallation process using `pkexec pacman -Rns --noconfirm <pkg_name>`.
/// Emits output in real-time.
#[tauri::command]
fn execute_package_uninstall(
    app: tauri::AppHandle,
    pkg_name: String,
    transaction_id: String,
    state: tauri::State<'_, ActiveProcessState>,
) -> Result<String, String> {
    let mut cmd = Command::new("pkexec");
    cmd.args(["pacman", "-Rns", "--noconfirm", &pkg_name]);

    // Pipe outputs to read in real time
    cmd.stdout(Stdio::piped())
       .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to initiate pacman removal process: {}", e))?;

    let stdout = child.stdout.take().ok_or("Failed to attach to process stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to attach to process stderr")?;

    let child_arc = Arc::new(Mutex::new(child));

    // Register active transaction child handle
    if let Ok(mut procs) = state.processes.lock() {
        procs.insert(transaction_id.clone(), child_arc.clone());
    } else {
        return Err("Failed to access active process state registry".to_string());
    }

    // Background thread for streaming stdout
    let app_stdout = app.clone();
    let tx_id_stdout = transaction_id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line_res in reader.lines() {
            if let Ok(line) = line_res {
                let _ = app_stdout.emit("tx-log", TransactionLine {
                    transaction_id: tx_id_stdout.clone(),
                    stream: "stdout".to_string(),
                    content: line,
                });
            }
        }
    });

    // Background thread for streaming stderr
    let app_stderr = app.clone();
    let tx_id_stderr = transaction_id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line_res in reader.lines() {
            if let Ok(line) = line_res {
                let _ = app_stderr.emit("tx-log", TransactionLine {
                    transaction_id: tx_id_stderr.clone(),
                    stream: "stderr".to_string(),
                    content: line,
                });
            }
        }
    });

    // Background thread to monitor process termination, clean up state, and notify exit
    let app_status = app;
    let tx_id_status = transaction_id.clone();
    let procs_clone = state.processes.clone();
    std::thread::spawn(move || {
        let wait_result = {
            let mut child_lock = child_arc.lock().unwrap();
            child_lock.wait()
        };

        // Remove package transaction from active registry
        if let Ok(mut procs) = procs_clone.lock() {
            procs.remove(&tx_id_status);
        }

        let exit_code = match wait_result {
            Ok(status) => status.code().unwrap_or(-1),
            Err(_) => -1,
        };

        let _ = app_status.emit("tx-complete", TransactionStatus {
            transaction_id: tx_id_status,
            exit_code,
            success: exit_code == 0,
        });
    });

    Ok(format!("Uninstall transaction {} spawned successfully", transaction_id))
}

/// Forcefully terminates an active transaction's child process (e.g. user abort)
#[tauri::command]
fn cancel_transaction(
    transaction_id: String,
    state: tauri::State<'_, ActiveProcessState>,
) -> Result<String, String> {
    if let Ok(mut procs) = state.processes.lock() {
        if let Some(child_arc) = procs.remove(&transaction_id) {
            if let Ok(mut child) = child_arc.lock() {
                let _ = child.kill();
                return Ok("Process killed successfully".to_string());
            }
        }
    }
    Err("Transaction not found or already completed".to_string())
}

/// Reboots the system using systemd systemctl command
#[tauri::command]
fn reboot_system() -> Result<(), String> {
    Command::new("systemctl")
        .arg("reboot")
        .spawn()
        .map_err(|e| format!("Failed to initiate system reboot: {}", e))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ActiveProcessState::default())
        .invoke_handler(tauri::generate_handler![
            get_installed_packages,
            search_repositories,
            get_upgradable_packages,
            get_package_details,
            get_cached_versions,
            get_online_archive_versions,
            execute_package_update,
            execute_package_uninstall,
            cancel_transaction,
            reboot_system
        ])
        .run(tauri::generate_context!())
        .expect("Error while running CachyOS Package Manager application");
}
