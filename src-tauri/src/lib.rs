mod api;
mod account;
mod machine;
mod login;
mod proxy;

use anyhow::anyhow;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::Manager;
use tauri::State;

use account::{AccountBrief, AccountManager, Account};
use api::{UsageSummary, UsageQueryResponse};
use proxy::{
    CertOperationResult, CertStatus, ProxyConfig, ProxyDiagnosticLog, ProxyManager, ProxyStatus,
    ProxyTestRequest, ProxyTestResult,
};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub quick_register_show_window: bool,
    pub auto_register_threads: i32,
    pub official_site_use_system_browser: bool,
    pub accounts_data_path: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            quick_register_show_window: false,
            auto_register_threads: 1,
            official_site_use_system_browser: false,
            accounts_data_path: String::new(),
        }
    }
}

fn get_settings_path() -> std::result::Result<PathBuf, anyhow::Error> {
    let proj_dirs = directories::ProjectDirs::from("com", "sauce", "trae-auto")
        .ok_or_else(|| anyhow!("无法获取应用配置目录"))?;
    let config_dir = proj_dirs.config_dir();
    fs::create_dir_all(config_dir)?;
    Ok(config_dir.join("settings.json"))
}

fn load_settings_from_disk() -> std::result::Result<AppSettings, anyhow::Error> {
    let path = get_settings_path()?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let content = fs::read_to_string(path)?;
    if content.trim().is_empty() {
        return Ok(AppSettings::default());
    }
    Ok(serde_json::from_str::<AppSettings>(&content).unwrap_or_default())
}

fn save_settings_to_disk(settings: &AppSettings) -> std::result::Result<(), anyhow::Error> {
    let path = get_settings_path()?;
    let content = serde_json::to_string_pretty(settings)?;
    fs::write(path, content)?;
    Ok(())
}

fn get_app_data_dir() -> std::result::Result<PathBuf, anyhow::Error> {
    let proj_dirs = directories::ProjectDirs::from("com", "sauce", "trae-auto")
        .ok_or_else(|| anyhow!("无法获取应用数据目录"))?;
    let data_dir = proj_dirs.data_local_dir();
    fs::create_dir_all(data_dir)?;
    Ok(data_dir.to_path_buf())
}

fn locate_creator_source_dir(app: &tauri::AppHandle) -> std::result::Result<PathBuf, anyhow::Error> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let local_resource_dir = manifest_dir.join("resources").join("Trae-Account-Creator");
    if local_resource_dir.exists() {
        return Ok(local_resource_dir);
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled_dir = resource_dir.join("Trae-Account-Creator");
        if bundled_dir.exists() {
            return Ok(bundled_dir);
        }
    }
    Err(anyhow!("未找到内置 Trae-Account-Creator 目录"))
}

fn copy_if_exists(source: &Path, target: &Path) -> std::result::Result<(), anyhow::Error> {
    if source.exists() {
        fs::copy(source, target)?;
        return Ok(());
    }
    Err(anyhow!("缺少必要文件: {}", source.display()))
}

fn prepare_creator_runtime_dir(app: &tauri::AppHandle) -> std::result::Result<PathBuf, anyhow::Error> {
    let source_dir = locate_creator_source_dir(app)?;
    let runtime_dir = get_app_data_dir()?.join("Trae-Account-Creator");
    fs::create_dir_all(&runtime_dir)?;
    copy_if_exists(&source_dir.join("register.py"), &runtime_dir.join("register.py"))?;
    copy_if_exists(&source_dir.join("mail_client.py"), &runtime_dir.join("mail_client.py"))?;
    let requirements_source = source_dir.join("requirements.txt");
    if requirements_source.exists() {
        fs::copy(requirements_source, runtime_dir.join("requirements.txt"))?;
    }
    fs::create_dir_all(runtime_dir.join("cookies"))?;
    Ok(runtime_dir)
}

/// 应用状态
pub struct AppState {
    pub account_manager: Arc<Mutex<AccountManager>>,
    pub proxy_manager: Arc<Mutex<ProxyManager>>,
    pub settings: Arc<Mutex<AppSettings>>,
}

/// 错误类型
#[derive(Debug, serde::Serialize)]
pub struct ApiError {
    pub message: String,
}

impl From<anyhow::Error> for ApiError {
    fn from(err: anyhow::Error) -> Self {
        Self {
            message: err.to_string(),
        }
    }
}

type Result<T> = std::result::Result<T, ApiError>;

// ============ Tauri 命令 ============

/// 添加账号（通过 Token，可选 Cookies）
#[tauri::command]
async fn add_account_by_token(token: String, cookies: Option<String>, state: State<'_, AppState>) -> Result<Account> {
    let mut manager = state.account_manager.lock().await;
    manager.add_account_by_token(token, cookies).await.map_err(Into::into)
}

/// 删除账号
#[tauri::command]
async fn remove_account(account_id: String, state: State<'_, AppState>) -> Result<()> {
    let mut manager = state.account_manager.lock().await;
    manager.remove_account(&account_id).map_err(Into::into)
}

/// 获取所有账号
#[tauri::command]
async fn get_accounts(state: State<'_, AppState>) -> Result<Vec<AccountBrief>> {
    let manager = state.account_manager.lock().await;
    Ok(manager.get_accounts())
}

/// 获取单个账号详情
#[tauri::command]
async fn get_account(account_id: String, state: State<'_, AppState>) -> Result<Account> {
    let manager = state.account_manager.lock().await;
    manager.get_account(&account_id).map_err(Into::into)
}

/// 切换账号（设置活跃账号并更新机器码）
#[tauri::command]
async fn switch_account(account_id: String, force: Option<bool>, state: State<'_, AppState>) -> Result<()> {
    let mut manager = state.account_manager.lock().await;
    let force = force.unwrap_or(false);
    manager
        .switch_account(&account_id, force)
        .map_err(Into::into)
}

/// 获取账号使用量
#[tauri::command]
async fn get_account_usage(account_id: String, state: State<'_, AppState>) -> Result<UsageSummary> {
    let mut manager = state.account_manager.lock().await;
    manager.get_account_usage(&account_id).await.map_err(Into::into)
}

/// 更新账号 Token
#[tauri::command]
async fn update_account_token(account_id: String, token: String, state: State<'_, AppState>) -> Result<UsageSummary> {
    let mut manager = state.account_manager.lock().await;
    manager.update_account_token(&account_id, token).await.map_err(Into::into)
}

/// 更新账号密码
#[tauri::command]
async fn update_account_password(account_id: String, password: String, state: State<'_, AppState>) -> Result<()> {
    let mut manager = state.account_manager.lock().await;
    manager
        .update_account_password(&account_id, password)
        .map_err(Into::into)
}

/// 导出账号
#[tauri::command]
async fn export_accounts(state: State<'_, AppState>) -> Result<String> {
    let manager = state.account_manager.lock().await;
    manager.export_accounts().map_err(Into::into)
}

/// 导入账号
#[tauri::command]
async fn import_accounts(data: String, state: State<'_, AppState>) -> Result<usize> {
    let mut manager = state.account_manager.lock().await;
    manager.import_accounts(&data).await.map_err(Into::into)
}

/// 获取使用事件
#[tauri::command]
async fn get_usage_events(
    account_id: String,
    start_time: i64,
    end_time: i64,
    page_num: i32,
    page_size: i32,
    state: State<'_, AppState>
) -> Result<UsageQueryResponse> {
    let mut manager = state.account_manager.lock().await;
    manager.get_usage_events(&account_id, start_time, end_time, page_num, page_size)
        .await
        .map_err(Into::into)
}

/// 从 Trae IDE号
#[tauri::command]
async fn read_trae_account(state: State<'_, AppState>) -> Result<Option<Account>> {
    let mut manager = state.account_manager.lock().await;
    manager.read_trae_ide_account().await.map_err(Into::into)
}

/// 获取当前系统机器码
#[tauri::command]
async fn get_machine_id() -> Result<String> {
    machine::get_machine_guid().map_err(Into::into)
}

/// 重置系统机器码（生成新的随机机器码）
#[tauri::command]
async fn reset_machine_id() -> Result<String> {
    machine::reset_machine_guid().map_err(Into::into)
}

/// 设置系统机器码为指定值
#[tauri::command]
async fn set_machine_id(machine_id: String) -> Result<()> {
    machine::set_machine_guid(&machine_id).map_err(Into::into)
}

/// 绑定账号机器码（保存当前系统机器码到账号）
#[tauri::command]
async fn bind_account_machine_id(account_id: String, state: State<'_, AppState>) -> Result<String> {
    let mut manager = state.account_manager.lock().await;
    manager.bind_machine_id(&account_id).map_err(Into::into)
}

/// 获取 Trae IDE 的机器码
#[tauri::command]
async fn get_trae_machine_id() -> Result<String> {
    machine::get_trae_machine_id().map_err(Into::into)
}

/// 设置 Trae IDE 的机器码
#[tauri::command]
async fn set_trae_machine_id(machine_id: String) -> Result<()> {
    machine::set_trae_machine_id(&machine_id).map_err(Into::into)
}

/// 清除 Trae IDE 登录状态（让 IDE 变成全新安装状态）
#[tauri::command]
async fn clear_trae_login_state() -> Result<()> {
    machine::clear_trae_login_state().map_err(Into::into)
}

/// 获取保存的 Trae IDE 路径
#[tauri::command]
async fn get_trae_path() -> Result<String> {
    machine::get_saved_trae_path().map_err(Into::into)
}

/// 设置 Trae IDE 路径
#[tauri::command]
async fn set_trae_path(path: String) -> Result<()> {
    machine::save_trae_path(&path).map_err(Into::into)
}

/// 自动扫描 Trae IDE 路径
#[tauri::command]
async fn scan_trae_path() -> Result<String> {
    machine::scan_trae_path().map_err(Into::into)
}

/// 刷新单个账号 Token
#[tauri::command]
async fn refresh_token(account_id: String, state: State<'_, AppState>) -> Result<()> {
    let mut manager = state.account_manager.lock().await;
    manager.refresh_token(&account_id).await.map_err(Into::into)
}

/// 批量刷新所有即将过期的 Token
#[tauri::command]
async fn refresh_all_tokens(state: State<'_, AppState>) -> Result<Vec<String>> {
    let mut manager = state.account_manager.lock().await;
    manager.refresh_all_tokens().await.map_err(Into::into)
}

/// 浏览器登录
#[tauri::command]
async fn start_browser_login(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<()> {
    let manager = state.account_manager.clone();
    login::start_login_flow(app, manager).await.map_err(|e| ApiError { message: e })?;
    Ok(())
}

#[tauri::command]
async fn open_official_site(
    use_default_browser: bool,
    email: Option<String>,
    password: Option<String>,
    app: tauri::AppHandle,
) -> Result<()> {
    login::open_official_site(app, use_default_browser, email, password).map_err(|e| ApiError { message: e })?;
    Ok(())
}

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings> {
    let settings = state.settings.lock().await;
    Ok(settings.clone())
}

#[tauri::command]
async fn get_accounts_data_path(state: State<'_, AppState>) -> Result<String> {
    let manager = state.account_manager.lock().await;
    Ok(manager.data_path().display().to_string())
}

#[tauri::command]
async fn update_settings(settings: AppSettings, state: State<'_, AppState>) -> Result<AppSettings> {
    let mut next = settings.clone();
    if next.auto_register_threads < 1 {
        next.auto_register_threads = 1;
    }
    next.accounts_data_path = next.accounts_data_path.trim().to_string();
    {
        let mut manager = state.account_manager.lock().await;
        manager
            .set_data_path(if next.accounts_data_path.is_empty() {
                None
            } else {
                Some(next.accounts_data_path.as_str())
            })
            .map_err(ApiError::from)?;
    }
    save_settings_to_disk(&next).map_err(ApiError::from)?;
    let mut current = state.settings.lock().await;
    *current = next.clone();
    Ok(next)
}

fn convert_cookie_json_to_header(content: &str) -> std::result::Result<String, anyhow::Error> {
    let cookies: Vec<serde_json::Value> = serde_json::from_str(content)?;
    let mut pairs: Vec<String> = Vec::new();
    for item in cookies {
        if let (Some(name), Some(value)) = (
            item.get("name").and_then(|v| v.as_str()),
            item.get("value").and_then(|v| v.as_str()),
        ) {
            pairs.push(format!("{}={}", name, value));
        }
    }
    if pairs.is_empty() {
        return Err(anyhow!("Cookie 文件为空或格式不正确"));
    }
    Ok(pairs.join("; "))
}

fn load_saved_accounts_password_map(path: &Path) -> HashMap<String, String> {
    let mut password_map = HashMap::new();
    let Ok(content) = fs::read_to_string(path) else {
        return password_map;
    };
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.to_ascii_lowercase().starts_with("email") {
            continue;
        }
        let mut parts = trimmed.split_whitespace();
        let Some(email) = parts.next() else {
            continue;
        };
        let Some(password) = parts.next() else {
            continue;
        };
        password_map.insert(email.to_string(), password.to_string());
    }
    password_map
}

#[tauri::command]
async fn quick_register(
    register_count: i32,
    thread_count: i32,
    show_window: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<Account>> {
    if register_count < 1 {
        return Err(anyhow!("注册账号数量必须大于 0").into());
    }
    if thread_count < 1 {
        return Err(anyhow!("自动注册账号线程数必须大于 0").into());
    }
    let use_system_browser = {
        let settings = state.settings.lock().await;
        settings.official_site_use_system_browser
    };
    let creator_dir = prepare_creator_runtime_dir(&app).map_err(ApiError::from)?;
    let accounts_file = creator_dir.join("accounts.txt");
    let cookies_dir = creator_dir.join("cookies");
    fs::create_dir_all(&cookies_dir).map_err(anyhow::Error::new)?;
    let before_files: HashSet<String> = fs::read_dir(&cookies_dir)
        .map_err(anyhow::Error::new)?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.file_name().to_str().map(|s| s.to_string()))
        .collect();
    let run_result = Command::new("py")
        .arg("register.py")
        .arg(register_count.to_string())
        .arg(thread_count.to_string())
        .arg(if show_window { "1" } else { "0" })
        .arg(if use_system_browser { "1" } else { "0" })
        .current_dir(&creator_dir)
        .output();
    let output = match run_result {
        Ok(value) => value,
        Err(_) => Command::new("python")
            .arg("register.py")
            .arg(register_count.to_string())
            .arg(thread_count.to_string())
            .arg(if show_window { "1" } else { "0" })
            .arg(if use_system_browser { "1" } else { "0" })
            .current_dir(&creator_dir)
            .output()
            .map_err(anyhow::Error::new)?,
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let message = if !stderr.is_empty() { stderr } else { stdout };
        return Err(anyhow!("自动注册执行失败: {}", message).into());
    }
    let mut new_cookie_files: Vec<PathBuf> = Vec::new();
    for entry in fs::read_dir(&cookies_dir).map_err(anyhow::Error::new)? {
        let item = entry.map_err(anyhow::Error::new)?;
        let file_name = item.file_name().to_string_lossy().to_string();
        if !before_files.contains(&file_name) && file_name.ends_with(".json") {
            new_cookie_files.push(item.path());
        }
    }
    if new_cookie_files.is_empty() {
        return Err(anyhow!("自动注册未产出新的 Cookie 文件").into());
    }
    new_cookie_files.sort();
    let password_map = load_saved_accounts_password_map(&accounts_file);
    let mut added_accounts: Vec<Account> = Vec::new();
    let mut error_messages: Vec<String> = Vec::new();
    let mut manager = state.account_manager.lock().await;
    for cookie_file in new_cookie_files {
        let content = fs::read_to_string(&cookie_file).map_err(anyhow::Error::new)?;
        let cookie_header = convert_cookie_json_to_header(&content)?;
        match manager.add_account(cookie_header).await {
            Ok(mut account) => {
                let email_from_file = cookie_file
                    .file_stem()
                    .and_then(|v| v.to_str())
                    .map(|v| v.to_string());
                let matched_password = email_from_file
                    .as_ref()
                    .and_then(|email| password_map.get(email))
                    .cloned();
                if let Some(password) = matched_password {
                    if let Err(err) = manager.update_account_password(&account.id, password.clone()) {
                        println!("[WARN] 自动注册密码保存失败: {}", err);
                    } else {
                        account.password = Some(password);
                    }
                }
                added_accounts.push(account);
            }
            Err(e) => {
                let file_name = cookie_file.file_name().unwrap_or_default().to_string_lossy();
                error_messages.push(format!("{}: {}", file_name, e));
            }
        }
    }
    if added_accounts.is_empty() {
        if !error_messages.is_empty() {
            return Err(anyhow!("自动注册完成，但账号导入失败:\n{}", error_messages.join("\n")).into());
        }
        return Err(anyhow!("自动注册完成，但账号导入失败").into());
    }
    Ok(added_accounts)
}

#[tauri::command]
async fn get_proxy_config(state: State<'_, AppState>) -> Result<ProxyConfig> {
    let manager = state.proxy_manager.lock().await;
    Ok(manager.get_proxy_config())
}

#[tauri::command]
async fn save_proxy_config(config: ProxyConfig, state: State<'_, AppState>) -> Result<ProxyConfig> {
    let mut manager = state.proxy_manager.lock().await;
    manager.save_proxy_config(config).await.map_err(Into::into)
}

#[tauri::command]
async fn start_proxy(state: State<'_, AppState>) -> Result<ProxyStatus> {
    let mut manager = state.proxy_manager.lock().await;
    manager.start_proxy().await.map_err(Into::into)
}

#[tauri::command]
async fn stop_proxy(state: State<'_, AppState>) -> Result<ProxyStatus> {
    let mut manager = state.proxy_manager.lock().await;
    manager.stop_proxy().await.map_err(Into::into)
}

#[tauri::command]
async fn get_proxy_status(state: State<'_, AppState>) -> Result<ProxyStatus> {
    let manager = state.proxy_manager.lock().await;
    Ok(manager.get_proxy_status())
}

#[tauri::command]
async fn get_cert_status(state: State<'_, AppState>) -> Result<CertStatus> {
    let manager = state.proxy_manager.lock().await;
    manager.get_cert_status().map_err(Into::into)
}

#[tauri::command]
async fn generate_cert(state: State<'_, AppState>) -> Result<CertOperationResult> {
    let mut manager = state.proxy_manager.lock().await;
    manager.generate_cert().map_err(Into::into)
}

#[tauri::command]
async fn install_cert(state: State<'_, AppState>) -> Result<CertOperationResult> {
    let mut manager = state.proxy_manager.lock().await;
    manager.install_cert().map_err(Into::into)
}

#[tauri::command]
async fn uninstall_cert(state: State<'_, AppState>) -> Result<CertOperationResult> {
    let mut manager = state.proxy_manager.lock().await;
    manager.uninstall_cert().map_err(Into::into)
}

#[tauri::command]
async fn export_cert(state: State<'_, AppState>) -> Result<CertOperationResult> {
    let manager = state.proxy_manager.lock().await;
    manager.export_cert().map_err(Into::into)
}

#[tauri::command]
async fn test_proxy_post(request: ProxyTestRequest, state: State<'_, AppState>) -> Result<ProxyTestResult> {
    let manager = state.proxy_manager.lock().await;
    manager.test_post(request).await.map_err(Into::into)
}

#[tauri::command]
async fn get_proxy_diagnostics(state: State<'_, AppState>) -> Result<Vec<ProxyDiagnosticLog>> {
    let manager = state.proxy_manager.lock().await;
    Ok(manager.get_diagnostics().await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = load_settings_from_disk().unwrap_or_default();
    let account_manager = AccountManager::new(if settings.accounts_data_path.trim().is_empty() {
        None
    } else {
        Some(settings.accounts_data_path.as_str())
    })
    .expect("无法初始化账号管理器");
    let proxy_manager = ProxyManager::new().expect("无法初始化代理管理器");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            account_manager: Arc::new(Mutex::new(account_manager)),
            proxy_manager: Arc::new(Mutex::new(proxy_manager)),
            settings: Arc::new(Mutex::new(settings)),
        })
        .invoke_handler(tauri::generate_handler![
            add_account_by_token,
            remove_account,
            get_accounts,
            get_account,
            switch_account,
            get_account_usage,
            update_account_token,
            update_account_password,
            export_accounts,
            import_accounts,
            get_usage_events,
            read_trae_account,
            get_machine_id,
            reset_machine_id,
            set_machine_id,
            bind_account_machine_id,
            get_trae_machine_id,
            set_trae_machine_id,
            clear_trae_login_state,
            get_trae_path,
            set_trae_path,
            scan_trae_path,
            refresh_token,
            refresh_all_tokens,
            start_browser_login,
            open_official_site,
            get_settings,
            get_accounts_data_path,
            update_settings,
            quick_register,
            get_proxy_config,
            save_proxy_config,
            start_proxy,
            stop_proxy,
            get_proxy_status,
            get_cert_status,
            generate_cert,
            install_cert,
            uninstall_cert,
            export_cert,
            test_proxy_post,
            get_proxy_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
