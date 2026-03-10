import { invoke } from "@tauri-apps/api/core";
import type {
  Account,
  AccountBrief,
  AppSettings,
  UsageSummary,
  UsageEventsResponse,
  ProxyConfig,
  ProxyStatus,
  CertStatus,
  CertOperationResult,
  ProxyTestRequest,
  ProxyTestResult,
  ProxyDiagnosticLog,
} from "./types";

function invokeSafe<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const globalInvoke = (globalThis as any)?.__TAURI__?.core?.invoke;
  const caller = typeof globalInvoke === "function" ? globalInvoke : invoke;
  if (typeof caller !== "function") {
    return Promise.reject(new Error("当前环境不支持 Tauri invoke"));
  }
  return caller(command, args);
}

function pickMessage(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message || "";
  if (typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  const message = record.message;
  if (typeof message === "string" && message.trim()) {
    return message;
  }
  const error = record.error;
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (typeof error === "object" && error) {
    return pickMessage(error);
  }
  return "";
}

function normalizeMessage(message: string): string {
  const normalized = message.replace(/^Command\s+\w+\s+failed:\s*/i, "").trim();
  return normalized || message.trim();
}

export function getErrorMessage(error: unknown, fallback: string): string {
  const message = normalizeMessage(pickMessage(error));
  return message || fallback;
}

async function invokeWithReadableError<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  fallbackMessage: string
): Promise<T> {
  try {
    return await invoke(command, args);
  } catch (error) {
    throw new Error(getErrorMessage(error, fallbackMessage));
  }
}

// 添加账号（通过 Cookies）
export async function addAccount(cookies: string): Promise<Account> {
  return invoke("add_account", { cookies });
}

// 添加账号（通过 Token，可选 Cookies）
export async function addAccountByToken(token: string, cookies?: string): Promise<Account> {
  return invoke("add_account_by_token", { token, cookies });
}

// 删除账号
export async function removeAccount(accountId: string): Promise<void> {
  return invoke("remove_account", { accountId });
}

// 获取所有账号
export async function getAccounts(): Promise<AccountBrief[]> {
  return invoke("get_accounts");
}

// 获取单个账号详情（包含 token）
export async function getAccount(accountId: string): Promise<Account> {
  return invoke("get_account", { accountId });
}

// 设置活跃账号
export async function setActiveAccount(
  accountId: string,
  options?: { force?: boolean }
): Promise<void> {
  return switchAccount(accountId, options);
}

// 切换账号（设置活跃账号并更新机器码）
export async function switchAccount(
  accountId: string,
  options?: { force?: boolean }
): Promise<void> {
  return invokeWithReadableError(
    "switch_account",
    { accountId, force: options?.force },
    "切换账号失败"
  );
}

// 获取账号使用量
export async function getAccountUsage(accountId: string): Promise<UsageSummary> {
  return invoke("get_account_usage", { accountId });
}

// 更新账号 Token
export async function updateAccountToken(accountId: string, token: string): Promise<UsageSummary> {
  return invoke("update_account_token", { accountId, token });
}

// 刷新 Token
export async function refreshToken(accountId: string): Promise<void> {
  return invoke("refresh_token", { accountId });
}

// 更新 Cookies
export async function updateCookies(accountId: string, cookies: string): Promise<void> {
  return invoke("update_cookies", { accountId, cookies });
}

// 更新密码
export async function updateAccountPassword(accountId: string, password: string): Promise<void> {
  return invoke("update_account_password", { accountId, password });
}

// 导出账号
export async function exportAccounts(): Promise<string> {
  return invoke("export_accounts");
}

// 导入账号
export async function importAccounts(data: string): Promise<number> {
  return invoke("import_accounts", { data });
}

// 获取使用事件
export async function getUsageEvents(
  accountId: string,
  startTime: number,
  endTime: number,
  pageNum: number = 1,
  pageSize: number = 20
): Promise<UsageEventsResponse> {
  return invoke("get_usage_events", {
    accountId,
    startTime,
    endTime,
    pageNum,
    pageSize
  });
}

// 从 Trae IDE 读取当前登录账号
export async function readTraeAccount(): Promise<Account | null> {
  return invoke("read_trae_account");
}

// ============ 机器码相关 API ============

// 获取当前系统机器码
export async function getMachineId(): Promise<string> {
  return invoke("get_machine_id");
}

// 重置系统机器码（生成新的随机机器码）
export async function resetMachineId(): Promise<string> {
  return invoke("reset_machine_id");
}

// 设置系统机器码为指定值
export async function setMachineId(machineId: string): Promise<void> {
  return invoke("set_machine_id", { machineId });
}

// 绑定账号机器码（保存当前系统机器码到账号）
export async function bindAccountMachineId(accountId: string): Promise<string> {
  return invoke("bind_account_machine_id", { accountId });
}

// ============ Trae IDE 机器码相关 API ============

// 获取 Trae IDE 的机器码
export async function getTraeMachineId(): Promise<string> {
  return invoke("get_trae_machine_id");
}

// 设置 Trae IDE 的机器码
export async function setTraeMachineId(machineId: string): Promise<void> {
  return invoke("set_trae_machine_id", { machineId });
}

// 清除 Trae IDE 登录状态（让 IDE 变成全新安装状态）
export async function clearTraeLoginState(): Promise<void> {
  return invoke("clear_trae_login_state");
}

// ============ Trae IDE 路径相关 API ============

// 获取保存的 Trae IDE 路径
export async function getTraePath(): Promise<string> {
  return invoke("get_trae_path");
}

// 设置 Trae IDE 路径
export async function setTraePath(path: string): Promise<void> {
  return invoke("set_trae_path", { path });
}

// 自动扫描 Trae IDE 路径
export async function scanTraePath(): Promise<string> {
  return invoke("scan_trae_path");
}

// ============ Token 刷新相关 API ============

// 批量刷新所有即将过期的 Token
export async function refreshAllTokens(): Promise<string[]> {
  return invoke("refresh_all_tokens");
}

// ============ 浏览器登录 ============

// 打开浏览器登录窗口
export async function startBrowserLogin(): Promise<void> {
  return invoke("start_browser_login");
}

export async function openOfficialSite(
  useDefaultBrowser: boolean,
  email?: string | null,
  password?: string | null
): Promise<void> {
  return invoke("open_official_site", { useDefaultBrowser, email, password });
}

export async function quickRegister(
  registerCount: number,
  threadCount: number,
  showWindow: boolean
): Promise<Account[]> {
  return invoke("quick_register", { registerCount, threadCount, showWindow });
}

export async function getSettings(): Promise<AppSettings> {
  return invoke("get_settings");
}

export async function getAccountsDataPath(): Promise<string> {
  return invoke("get_accounts_data_path");
}

export async function updateSettings(settings: AppSettings): Promise<AppSettings> {
  return invoke("update_settings", { settings });
}

export async function getProxyConfig(): Promise<ProxyConfig> {
  return invokeSafe("get_proxy_config");
}

export async function saveProxyConfig(config: ProxyConfig): Promise<ProxyConfig> {
  return invokeSafe("save_proxy_config", { config });
}

export async function startProxy(): Promise<ProxyStatus> {
  return invokeSafe("start_proxy");
}

export async function stopProxy(): Promise<ProxyStatus> {
  return invokeSafe("stop_proxy");
}

export async function getProxyStatus(): Promise<ProxyStatus> {
  return invokeSafe("get_proxy_status");
}

export async function getCertStatus(): Promise<CertStatus> {
  return invokeSafe("get_cert_status");
}

export async function generateCert(): Promise<CertOperationResult> {
  return invokeSafe("generate_cert");
}

export async function installCert(): Promise<CertOperationResult> {
  return invokeSafe("install_cert");
}

export async function uninstallCert(): Promise<CertOperationResult> {
  return invokeSafe("uninstall_cert");
}

export async function exportCert(): Promise<CertOperationResult> {
  return invokeSafe("export_cert");
}

export async function testProxyPost(request: ProxyTestRequest): Promise<ProxyTestResult> {
  return invokeSafe("test_proxy_post", { request });
}

export async function getProxyDiagnostics(): Promise<ProxyDiagnosticLog[]> {
  return invokeSafe("get_proxy_diagnostics");
}
