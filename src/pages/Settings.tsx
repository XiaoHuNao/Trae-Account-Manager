import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import * as api from "../api";
import type { AppSettings } from "../types";

interface SettingsProps {
  onToast?: (type: "success" | "error" | "warning" | "info", message: string) => void;
  settings: AppSettings;
  onSettingsChange?: (settings: AppSettings) => void;
  onRefreshAccounts?: () => Promise<void>;
}

export function Settings({ onToast, settings, onSettingsChange, onRefreshAccounts }: SettingsProps) {
  const [traeMachineId, setTraeMachineId] = useState<string>("");
  const [traeRefreshing, setTraeRefreshing] = useState(false);
  const [clearingTrae, setClearingTrae] = useState(false);
  const [traePath, setTraePath] = useState<string>("");
  const [traePathLoading, setTraePathLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [quickRegisterShowWindow, setQuickRegisterShowWindow] = useState<boolean>(settings.quick_register_show_window);
  const [autoRegisterThreads, setAutoRegisterThreads] = useState<string>(String(settings.auto_register_threads || 1));
  const [officialSiteUseSystemBrowser, setOfficialSiteUseSystemBrowser] = useState<boolean>(settings.official_site_use_system_browser);
  const [accountsDataPath, setAccountsDataPath] = useState<string>(settings.accounts_data_path || "");
  const [currentAccountsDataPath, setCurrentAccountsDataPath] = useState<string>("加载中...");
  const [updatingRegisterSettings, setUpdatingRegisterSettings] = useState(false);
  const [refreshingAccounts, setRefreshingAccounts] = useState(false);

  // 加载 Trae IDE 机器码
  const loadTraeMachineId = async () => {
    setTraeRefreshing(true);
    try {
      const id = await api.getTraeMachineId();
      setTraeMachineId(id);
    } catch (err: any) {
      console.error("获取 Trae IDE 机器码失败:", err);
      setTraeMachineId("未找到");
    } finally {
      setTraeRefreshing(false);
    }
  };

  // 加载 Trae IDE 路径
  const loadTraePath = async () => {
    setTraePathLoading(true);
    try {
      const path = await api.getTraePath();
      setTraePath(path);
    } catch (err: any) {
      console.error("获取 Trae IDE 路径失败:", err);
      setTraePath("");
    } finally {
      setTraePathLoading(false);
    }
  };

  const loadAccountsDataPath = async () => {
    try {
      const path = await api.getAccountsDataPath();
      setCurrentAccountsDataPath(path || "未设置");
    } catch {
      setCurrentAccountsDataPath("未设置");
    }
  };

  useEffect(() => {
    loadTraeMachineId();
    loadTraePath();
    loadAccountsDataPath();
  }, []);

  useEffect(() => {
    setQuickRegisterShowWindow(settings.quick_register_show_window);
    setAutoRegisterThreads(String(settings.auto_register_threads || 1));
    setOfficialSiteUseSystemBrowser(settings.official_site_use_system_browser);
    setAccountsDataPath(settings.accounts_data_path || "");
  }, [settings.quick_register_show_window, settings.auto_register_threads, settings.official_site_use_system_browser, settings.accounts_data_path]);

  // 复制 Trae IDE 机器码
  const handleCopyTraeMachineId = async () => {
    try {
      await navigator.clipboard.writeText(traeMachineId);
      onToast?.("success", "Trae IDE 机器码已复制到剪贴板");
    } catch {
      onToast?.("error", "复制失败");
    }
  };

  // 清除 Trae IDE 登录状态
  const handleClearTraeLoginState = async () => {
    if (!confirm("确定要清除 Trae IDE 登录状态吗？\n\n这将：\n• 重置 Trae IDE 机器码\n• 清除所有登录信息\n• 删除本地缓存数据\n\n操作后 Trae IDE 将变成全新安装状态，需要重新登录。\n\n请确保 Trae IDE 已关闭！")) {
      return;
    }

    setClearingTrae(true);
    try {
      await api.clearTraeLoginState();
      await loadTraeMachineId(); // 重新加载新的机器码
      onToast?.("success", "Trae IDE 登录状态已清除，请重新打开 Trae IDE 登录");
    } catch (err: any) {
      onToast?.("error", err.message || "清除失败");
    } finally {
      setClearingTrae(false);
    }
  };

  // 自动扫描 Trae IDE 路径
  const handleScanTraePath = async () => {
    setScanning(true);
    try {
      const path = await api.scanTraePath();
      setTraePath(path);
      onToast?.("success", "已找到 Trae IDE: " + path);
    } catch (err: any) {
      onToast?.("error", err.message || "未找到 Trae IDE，请手动设置路径");
    } finally {
      setScanning(false);
    }
  };

  // 手动设置 Trae IDE 路径
  const handleSetTraePath = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: "Trae IDE",
          extensions: ["exe"]
        }],
        title: "选择 Trae.exe 文件"
      });

      if (selected) {
        const path = selected as string;
        await api.setTraePath(path);
        setTraePath(path);
        onToast?.("success", "Trae IDE 路径已保存");
      }
    } catch (err: any) {
      onToast?.("error", err.message || "选择文件失败");
    }
  };

  const handleSaveRegisterSettings = async (next: AppSettings, refreshAccounts: boolean = false) => {
    setUpdatingRegisterSettings(true);
    try {
      const saved = await api.updateSettings(next);
      onSettingsChange?.(saved);
      setAccountsDataPath(saved.accounts_data_path || "");
      await loadAccountsDataPath();
      if (refreshAccounts) {
        await onRefreshAccounts?.();
      }
      onToast?.("success", "设置已保存");
    } catch (err: any) {
      onToast?.("error", err.message || "保存设置失败");
      setQuickRegisterShowWindow(settings.quick_register_show_window);
      setAutoRegisterThreads(String(settings.auto_register_threads || 1));
      setOfficialSiteUseSystemBrowser(settings.official_site_use_system_browser);
      setAccountsDataPath(settings.accounts_data_path || "");
      await loadAccountsDataPath();
    } finally {
      setUpdatingRegisterSettings(false);
    }
  };

  const handleToggleQuickRegisterShowWindow = async (checked: boolean) => {
    setQuickRegisterShowWindow(checked);
    const threads = Math.max(1, Number.parseInt(autoRegisterThreads, 10) || settings.auto_register_threads || 1);
    await handleSaveRegisterSettings({
      quick_register_show_window: checked,
      auto_register_threads: threads,
      official_site_use_system_browser: officialSiteUseSystemBrowser,
      accounts_data_path: accountsDataPath.trim(),
    });
  };

  const handleAutoRegisterThreadsBlur = async () => {
    const parsed = Math.max(1, Number.parseInt(autoRegisterThreads, 10) || 1);
    setAutoRegisterThreads(String(parsed));
    await handleSaveRegisterSettings({
      quick_register_show_window: quickRegisterShowWindow,
      auto_register_threads: parsed,
      official_site_use_system_browser: officialSiteUseSystemBrowser,
      accounts_data_path: accountsDataPath.trim(),
    });
  };

  const handleToggleOfficialSiteUseSystemBrowser = async (checked: boolean) => {
    setOfficialSiteUseSystemBrowser(checked);
    const threads = Math.max(1, Number.parseInt(autoRegisterThreads, 10) || settings.auto_register_threads || 1);
    await handleSaveRegisterSettings({
      quick_register_show_window: quickRegisterShowWindow,
      auto_register_threads: threads,
      official_site_use_system_browser: checked,
      accounts_data_path: accountsDataPath.trim(),
    });
  };

  const handleSetAccountsDataPath = async () => {
    const selected = await open({
      title: "设置账号数据文件路径",
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!selected) {
      return;
    }
    const normalized = String(selected).trim();
    const threads = Math.max(1, Number.parseInt(autoRegisterThreads, 10) || settings.auto_register_threads || 1);
    await handleSaveRegisterSettings({
      quick_register_show_window: quickRegisterShowWindow,
      auto_register_threads: threads,
      official_site_use_system_browser: officialSiteUseSystemBrowser,
      accounts_data_path: normalized,
    }, true);
  };

  const handleResetAccountsDataPath = async () => {
    const threads = Math.max(1, Number.parseInt(autoRegisterThreads, 10) || settings.auto_register_threads || 1);
    await handleSaveRegisterSettings({
      quick_register_show_window: quickRegisterShowWindow,
      auto_register_threads: threads,
      official_site_use_system_browser: officialSiteUseSystemBrowser,
      accounts_data_path: "",
    }, true);
  };

  const handleManualRefreshAccounts = async () => {
    if (!onRefreshAccounts) {
      return;
    }
    setRefreshingAccounts(true);
    try {
      await onRefreshAccounts();
      onToast?.("success", "账号列表已刷新");
    } catch (err: any) {
      onToast?.("error", err.message || "刷新账号列表失败");
    } finally {
      setRefreshingAccounts(false);
    }
  };

  return (
    <div className="settings-page">
      {/* 机器码 */}
      <div className="settings-section">
        <h3>机器码</h3>
        <div className="machine-id-card trae-card">
          <div className="machine-id-header">
            <div className="machine-id-icon trae-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div className="machine-id-title">
              <span>MachineId</span>
              <span className="machine-id-subtitle">客户端唯一标识符</span>
            </div>
          </div>
          <div className="machine-id-value">
            <code>{traeRefreshing ? "加载中..." : traeMachineId}</code>
          </div>
          <div className="machine-id-actions">
            <button
              className="machine-id-btn"
              onClick={loadTraeMachineId}
              disabled={traeRefreshing}
              title="刷新"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              刷新
            </button>
            <button
              className="machine-id-btn"
              onClick={handleCopyTraeMachineId}
              disabled={!traeMachineId || traeRefreshing || traeMachineId === "未找到"}
              title="复制"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              复制
            </button>
            <button
              className="machine-id-btn danger"
              onClick={handleClearTraeLoginState}
              disabled={clearingTrae || traeRefreshing}
              title="清除登录状态"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                <line x1="10" y1="11" x2="10" y2="17"/>
                <line x1="14" y1="11" x2="14" y2="17"/>
              </svg>
              {clearingTrae ? "清除中..." : "清除登录状态"}
            </button>
          </div>
          <div className="machine-id-tip warning">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>清除登录状态会重置机器码并删除所有登录信息，客户端将需要重新登录。请先关闭客户端。</span>
          </div>
        </div>
      </div>

      {/* 路径设置 */}
      <div className="settings-section">
        <h3>路径</h3>
        <div className="machine-id-card trae-card">
          <div className="machine-id-header">
            <div className="machine-id-icon trae-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div className="machine-id-title">
              <span>安装路径</span>
              <span className="machine-id-subtitle">用于自动打开客户端</span>
            </div>
          </div>
          <div className="machine-id-value">
            <code>{traePathLoading ? "加载中..." : (traePath || "未设置")}</code>
          </div>
          <div className="machine-id-title machine-id-title-with-icon">
            <div className="machine-id-title-row">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="machine-id-inline-icon">
                <path d="M3 7l9-4 9 4-9 4-9-4z"/>
                <path d="M3 12l9 4 9-4"/>
                <path d="M3 17l9 4 9-4"/>
              </svg>
              <span>账号数据文件路径</span>
            </div>
            <span className="machine-id-subtitle">当前 accounts.json 实际读写路径</span>
          </div>
          <div className="machine-id-value">
            <code>{currentAccountsDataPath}</code>
          </div>
          <div className="machine-id-actions">
            <button
              className="machine-id-btn"
              onClick={handleScanTraePath}
              disabled={scanning}
              title="自动扫描"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/>
                <path d="M21 21l-4.35-4.35"/>
              </svg>
              {scanning ? "扫描中..." : "自动扫描"}
            </button>
            <button
              className="machine-id-btn"
              onClick={handleSetTraePath}
              title="手动设置"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              手动设置
            </button>
            <button
              className="machine-id-btn"
              onClick={handleManualRefreshAccounts}
              disabled={refreshingAccounts || updatingRegisterSettings}
              title="刷新账号列表"
            >
              {refreshingAccounts ? "刷新中..." : "刷新账号列表"}
            </button>
            <button
              className="machine-id-btn"
              onClick={handleSetAccountsDataPath}
              disabled={updatingRegisterSettings}
              title="设置账号路径"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
              </svg>
              设置账号路径
            </button>
            <button
              className="machine-id-btn"
              onClick={handleResetAccountsDataPath}
              disabled={updatingRegisterSettings}
              title="重置默认账号路径"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 1 0 3-6.7"/>
                <path d="M3 3v6h6"/>
              </svg>
              重置默认账号路径
            </button>
          </div>
          <div className="machine-id-tip">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4"/>
              <path d="M12 8h.01"/>
            </svg>
            <span>切换账号后会自动打开客户端。如果自动扫描找不到，请手动设置 Trae.exe 的完整路径。</span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>通用设置</h3>
        <div className="setting-item">
          <div className="setting-info">
            <div className="setting-label">快速注册显示浏览器窗口</div>
            <div className="setting-desc">仅控制是否显示浏览器窗口；开启=有头，关闭=无头。两种模式都会随机设备指纹。</div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={quickRegisterShowWindow}
              onChange={(e) => handleToggleQuickRegisterShowWindow(e.target.checked)}
              disabled={updatingRegisterSettings}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <div className="setting-label">自动注册账号线程数</div>
            <div className="setting-desc">默认 1，建议根据网络稳定性逐步提高</div>
          </div>
          <input
            className="setting-input setting-input-sm"
            type="number"
            min={1}
            value={autoRegisterThreads}
            onChange={(e) => setAutoRegisterThreads(e.target.value)}
            onBlur={handleAutoRegisterThreadsBlur}
            disabled={updatingRegisterSettings}
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <div className="setting-label">浏览器途径</div>
            <div className="setting-desc">
              {officialSiteUseSystemBrowser
                ? "当前：官网登录使用系统默认浏览器；自动注册优先系统浏览器（失败时回退内置 Chromium）"
                : "当前：官网登录与自动注册均使用内置 Chromium"}
            </div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={officialSiteUseSystemBrowser}
              onChange={(e) => handleToggleOfficialSiteUseSystemBrowser(e.target.checked)}
              disabled={updatingRegisterSettings}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <div className="setting-label">自动刷新</div>
            <div className="setting-desc">定时自动刷新账号使用量数据</div>
          </div>
          <label className="toggle">
            <input type="checkbox" />
            <span className="toggle-slider"></span>
          </label>
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <div className="setting-label">刷新间隔</div>
            <div className="setting-desc">自动刷新的时间间隔（分钟）</div>
          </div>
          <select className="setting-select">
            <option value="5">5 分钟</option>
            <option value="10">10 分钟</option>
            <option value="30">30 分钟</option>
            <option value="60">60 分钟</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <h3>数据管理</h3>
        <div className="setting-item">
          <div className="setting-info">
            <div className="setting-label">导出数据</div>
            <div className="setting-desc">导出所有账号数据为 JSON 文件</div>
          </div>
          <button className="setting-btn">导出</button>
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <div className="setting-label">导入数据</div>
            <div className="setting-desc">从 JSON 文件导入账号数据</div>
          </div>
          <button className="setting-btn">导入</button>
        </div>

        <div className="setting-item danger">
          <div className="setting-info">
            <div className="setting-label">清空数据</div>
            <div className="setting-desc">删除所有账号数据（不可恢复）</div>
          </div>
          <button className="setting-btn danger">清空</button>
        </div>
      </div>
    </div>
  );
}
