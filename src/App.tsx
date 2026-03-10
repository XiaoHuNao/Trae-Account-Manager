import { useState, useEffect, useCallback, useRef } from "react";
import { Sidebar } from "./components/Sidebar";
import { AccountCard } from "./components/AccountCard";
import { AccountListItem } from "./components/AccountListItem";
import { AddAccountModal } from "./components/AddAccountModal";
import { ContextMenu } from "./components/ContextMenu";
import { DetailModal } from "./components/DetailModal";
import { Toast } from "./components/Toast";
import { ConfirmModal } from "./components/ConfirmModal";
import { InfoModal } from "./components/InfoModal";
import { UpdateTokenModal } from "./components/UpdateTokenModal";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { About } from "./pages/About";
import { CustomModelProxy } from "./pages/CustomModelProxy";
import { useToast } from "./hooks/useToast";
import * as api from "./api";
import type { AccountBrief, AppSettings, UsageSummary } from "./types";
import "./App.css";

interface AccountWithUsage extends AccountBrief {
  usage?: UsageSummary | null;
  password?: string | null;
}

type ViewMode = "grid" | "list";

function App() {
  const [accounts, setAccounts] = useState<AccountWithUsage[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState("dashboard");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [appSettings, setAppSettings] = useState<AppSettings>({
    quick_register_show_window: false,
    auto_register_threads: 1,
    official_site_use_system_browser: false,
    accounts_data_path: "",
  });

  // 使用自定义 Toast hook
  const { toasts, addToast, removeToast } = useToast();
  const previousAccountsPathRef = useRef<string | null>(null);

  // 确认弹窗状态
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: "danger" | "warning" | "info";
    onConfirm: () => void;
  } | null>(null);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    accountId: string;
  } | null>(null);

  // 详情弹窗状态
  const [detailAccount, setDetailAccount] = useState<AccountWithUsage | null>(null);

  // 刷新中的账号 ID
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());

  // 更新 Token 弹窗状态
  const [updateTokenModal, setUpdateTokenModal] = useState<{
    accountId: string;
    accountName: string;
  } | null>(null);

  // 信息展示弹窗状态
  const [infoModal, setInfoModal] = useState<{
    isOpen: boolean;
    title: string;
    icon: string;
    sections: Array<{
      title?: string;
      content: string;
      type?: "text" | "code" | "list";
    }>;
    confirmText: string;
    onConfirm: () => void;
  } | null>(null);

  // 加载账号列表（先显示列表，再后台加载使用量）
  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.getAccounts();

      // 先立即显示账号列表（不等待使用量加载）
      setAccounts(list.map((account) => ({ ...account, usage: undefined })));
      setLoading(false);

      // 后台并行加载使用量
      if (list.length > 0) {
        const usageResults = await Promise.allSettled(
          list.map((account) => api.getAccountUsage(account.id))
        );

        setAccounts((prev) =>
          prev.map((account, index) => {
            const result = usageResults[index];
            return {
              ...account,
              usage: result.status === 'fulfilled' ? result.value : null
            };
          })
        );
      }
    } catch (err: any) {
      setError(err.message || "加载账号失败");
      setLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    api.getSettings()
      .then((settings) => setAppSettings(settings))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const nextPath = (appSettings.accounts_data_path || "").trim();
    const previousPath = previousAccountsPathRef.current;
    if (previousPath === null) {
      previousAccountsPathRef.current = nextPath;
      return;
    }
    if (previousPath !== nextPath) {
      previousAccountsPathRef.current = nextPath;
      loadAccounts();
    }
  }, [appSettings.accounts_data_path, loadAccounts]);

  // 自动刷新即将过期的 Token
  useEffect(() => {
    // 启动时刷新
    api.refreshAllTokens().then((refreshed) => {
      if (refreshed.length > 0) {
        console.log(`[INFO] 启动时自动刷新了 ${refreshed.length} 个 Token`);
        loadAccounts();
      }
    }).catch(console.error);

    // 每30分钟刷新一次
    const interval = setInterval(() => {
      api.refreshAllTokens().then((refreshed) => {
        if (refreshed.length > 0) {
          console.log(`[INFO] 定时自动刷新了 ${refreshed.length} 个 Token`);
          loadAccounts();
        }
      }).catch(console.error);
    }, 30 * 60 * 1000);

    return () => clearInterval(interval);
  }, [loadAccounts]);

  // 添加账号
  const handleAddAccount = async (token: string, cookies?: string) => {
    await api.addAccountByToken(token, cookies);
    addToast("success", "账号添加成功");
    await loadAccounts();
  };

  // 删除账号
  const handleDeleteAccount = async (accountId: string) => {
    setConfirmModal({
      isOpen: true,
      title: "删除账号",
      message: "确定要删除此账号吗？删除后无法恢复。",
      type: "danger",
      onConfirm: async () => {
        try {
          await api.removeAccount(accountId);
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(accountId);
            return next;
          });
          addToast("success", "账号已删除");
          await loadAccounts();
        } catch (err: any) {
          addToast("error", err.message || "删除账号失败");
        }
        setConfirmModal(null);
      },
    });
  };

  // 刷新单个账号
  const handleRefreshAccount = async (accountId: string) => {
    // 防止重复刷新
    if (refreshingIds.has(accountId)) {
      return;
    }

    setRefreshingIds((prev) => new Set(prev).add(accountId));

    try {
      const usage = await api.getAccountUsage(accountId);
      setAccounts((prev) =>
        prev.map((a) => (a.id === accountId ? { ...a, usage } : a))
      );
      addToast("success", "数据刷新成功");
    } catch (err: any) {
      addToast("error", err.message || "刷新失败");
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    }
  };

  // 选择账号
  const handleSelectAccount = (accountId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  };

  // 全选/取消全选
  const handleSelectAll = () => {
    if (selectedIds.size === accounts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(accounts.map((a) => a.id)));
    }
  };

  // 右键菜单
  const handleContextMenu = (e: React.MouseEvent, accountId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, accountId });
  };

  // 复制 Token
  const handleCopyToken = async (accountId: string) => {
    try {
      const account = await api.getAccount(accountId);
      if (account.jwt_token) {
        await navigator.clipboard.writeText(account.jwt_token);
        addToast("success", "Token 已复制到剪贴板");
      } else {
        addToast("warning", "该账号没有有效的 Token");
      }
    } catch (err: any) {
      addToast("error", err.message || "获取 Token 失败");
    }
  };

  const handleOpenOfficialSite = async (accountId: string) => {
    try {
      const account = await api.getAccount(accountId);
      await api.openOfficialSite(
        appSettings.official_site_use_system_browser,
        account.email || null,
        account.password || null
      );
      if (appSettings.official_site_use_system_browser) {
        addToast("info", "默认浏览器模式下不支持自动填充，请手动登录");
      } else if (!account.email || !account.password) {
        addToast("warning", "账号邮箱或密码为空，已打开登录页请手动输入");
      } else {
        addToast("success", "已打开登录页并尝试自动填写账号密码");
      }
    } catch (err: any) {
      addToast("error", err.message || "打开官网失败");
    }
  };

  const handleSwitchAccount = async (
    accountId: string,
    options?: { mode?: "switch" | "relogin"; force?: boolean }
  ) => {
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;

    const mode = options?.mode ?? "switch";
    const force = options?.force ?? mode === "relogin";
    const title = mode === "relogin" ? "重新登录" : "切换账号";
    const message =
      mode === "relogin"
        ? `确定要重新登录账号 "${account.email || account.name}" 吗？\n\n系统将自动关闭 Trae IDE 并重新写入登录信息。`
        : `确定要切换到账号 "${account.email || account.name}" 吗？\n\n系统将自动关闭 Trae IDE 并切换登录信息。`;
    const infoToast = mode === "relogin" ? "正在重新登录，请稍候..." : "正在切换账号，请稍候...";
    const successToast = mode === "relogin" ? "账号重新登录完成，请重新打开 Trae IDE" : "账号切换成功，请重新打开 Trae IDE";
    const errorToast = mode === "relogin" ? "重新登录失败" : "切换账号失败";

    setConfirmModal({
      isOpen: true,
      title,
      message,
      type: "warning",
      onConfirm: async () => {
        setConfirmModal(null);
        addToast("info", infoToast);
        try {
          await api.switchAccount(accountId, { force });
          await loadAccounts();
          setContextMenu(null);
          addToast("success", successToast);
        } catch (err: any) {
          addToast("error", api.getErrorMessage(err, errorToast));
        }
      },
    });
  };

  // 查看详情
  const handleViewDetail = async (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    if (account) {
      try {
        // 获取完整的账号信息（包含 token 和 cookies）
        const fullAccount = await api.getAccount(accountId);
        setDetailAccount({ ...account, ...fullAccount });
      } catch (err: any) {
        addToast("error", "获取账号详情失败");
        console.error("获取账号详情失败:", err);
      }
    }
  };

  // 更新 Token
  const handleUpdateToken = async (accountId: string, token: string) => {
    try {
      const usage = await api.updateAccountToken(accountId, token);
      setAccounts((prev) =>
        prev.map((a) => (a.id === accountId ? { ...a, usage } : a))
      );
      addToast("success", "Token 更新成功，数据已刷新");
    } catch (err: any) {
      throw err; // 让弹窗显示错误
    }
  };

  // 更新密码
  const handleSavePassword = async (accountId: string, password: string) => {
    await api.updateAccountPassword(accountId, password);
    setDetailAccount((prev) => {
      if (!prev || prev.id !== accountId) return prev;
      return { ...prev, password };
    });
    addToast("success", password ? "密码已保存" : "密码已清空");
  };

  // 打开更新 Token 弹窗
  const handleOpenUpdateToken = (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    if (account) {
      setUpdateTokenModal({
        accountId,
        accountName: account.email || account.name,
      });
    }
  };

  // 显示导出说明
  const handleShowExportInfo = () => {
    if (accounts.length === 0) {
      addToast("warning", "没有账号可以导出");
      return;
    }

    setInfoModal({
      isOpen: true,
      title: "导出账号说明",
      icon: "📤",
      sections: [
        {
          title: "📄 导出格式",
          content: "JSON 文件 (.json)",
          type: "text"
        },
        {
          title: "📁 保存位置",
          content: "浏览器默认下载文件夹\n文件名格式：trae-accounts-YYYY-MM-DD.json",
          type: "text"
        },
        {
          title: "📋 文件内容",
          content: `<ul>
<li>所有账号的完整信息</li>
<li>Token 和 Cookies 数据</li>
<li>使用量统计信息</li>
<li>账号创建和更新时间</li>
</ul>`,
          type: "list"
        },
        {
          title: "✅ 导出后可以",
          content: `<ul>
<li>备份账号数据</li>
<li>迁移到其他设备</li>
<li>恢复误删的账号</li>
<li>分享给其他设备使用</li>
</ul>`,
          type: "list"
        },
        {
          title: "⚠️ 安全提示",
          content: `<ul>
<li><strong>导出文件包含敏感信息</strong></li>
<li><strong>请妥善保管导出的文件</strong></li>
<li><strong>不要分享给他人</strong></li>
<li>建议加密存储导出文件</li>
</ul>`,
          type: "list"
        },
        {
          content: `当前将导出 ${accounts.length} 个账号`,
          type: "text"
        }
      ],
      confirmText: "开始导出",
      onConfirm: () => {
        setInfoModal(null);
        handleExportAccounts();
      }
    });
  };

  // 导出账号
  const handleExportAccounts = async () => {
    try {
      const data = await api.exportAccounts();
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const fileName = `trae-accounts-${new Date().toISOString().split("T")[0]}.json`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast("success", `已导出 ${accounts.length} 个账号到下载文件夹：${fileName}`);
    } catch (err: any) {
      addToast("error", err.message || "导出失败");
    }
  };

  // 显示导入说明
  const handleShowImportInfo = () => {
    setInfoModal({
      isOpen: true,
      title: "导入账号说明",
      icon: "📥",
      sections: [
        {
          title: "📄 文件格式",
          content: "JSON 文件 (.json)",
          type: "text"
        },
        {
          title: "📋 文件结构示例",
          content: `{
  "accounts": [
    {
      "id": "账号ID",
      "name": "用户名",
      "email": "邮箱地址",
      "jwt_token": "Token字符串",
      "cookies": "Cookies字符串",
      "plan_type": "套餐类型",
      "created_at": 时间戳,
      "is_active": true,
      ...
    }
  ],
  "active_account_id": "当前活跃账号ID",
  "current_account_id": "当前使用账号ID"
}`,
          type: "code"
        },
        {
          title: "✅ 导入步骤",
          content: `<ul>
<li>确认后选择 JSON 文件</li>
<li>系统自动验证格式</li>
<li>导入所有有效账号</li>
</ul>`,
          type: "list"
        },
        {
          title: "⚠️ 注意事项",
          content: `<ul>
<li>仅支持本应用导出的格式</li>
<li>导入会自动跳过重复账号</li>
<li>建议定期备份账号数据</li>
</ul>`,
          type: "list"
        }
      ],
      confirmText: "选择文件",
      onConfirm: () => {
        setInfoModal(null);
        handleImportAccounts();
      }
    });
  };

  // 导入账号
  const handleImportAccounts = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const count = await api.importAccounts(text);
        addToast("success", `成功导入 ${count} 个账号`);
        await loadAccounts();
      } catch (err: any) {
        addToast("error", err.message || "导入失败");
      }
    };
    input.click();
  };

  // 批量刷新选中账号（优化：并行处理，添加进度反馈）
  const handleBatchRefresh = async () => {
    if (selectedIds.size === 0) {
      addToast("warning", "请先选择要刷新的账号");
      return;
    }

    const ids = Array.from(selectedIds);
    addToast("info", `正在刷新 ${ids.length} 个账号...`);

    // 并行刷新所有选中的账号
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        try {
          const usage = await api.getAccountUsage(id);
          setAccounts((prev) =>
            prev.map((a) => (a.id === id ? { ...a, usage } : a))
          );
          return { id, success: true };
        } catch (err: any) {
          return { id, success: false, error: err.message };
        }
      })
    );

    // 统计结果
    const successCount = results.filter(
      (r) => r.status === 'fulfilled' && r.value.success
    ).length;
    const failCount = ids.length - successCount;

    if (failCount === 0) {
      addToast("success", `成功刷新 ${successCount} 个账号`);
    } else {
      addToast("warning", `刷新完成：${successCount} 成功，${failCount} 失败`);
    }
  };

  // 批量删除选中账号（优化：改进错误处理和反馈）
  const handleBatchDelete = () => {
    if (selectedIds.size === 0) {
      addToast("warning", "请先选择要删除的账号");
      return;
    }

    const ids = Array.from(selectedIds);
    setConfirmModal({
      isOpen: true,
      title: "批量删除",
      message: `确定要删除选中的 ${ids.length} 个账号吗？此操作无法撤销。`,
      type: "danger",
      onConfirm: async () => {
        setConfirmModal(null);
        addToast("info", `正在删除 ${ids.length} 个账号...`);

        // 并行删除所有选中的账号
        const results = await Promise.allSettled(
          ids.map((id) => api.removeAccount(id))
        );

        // 统计结果
        const successCount = results.filter((r) => r.status === 'fulfilled').length;
        const failCount = ids.length - successCount;

        setSelectedIds(new Set());
        await loadAccounts();

        if (failCount === 0) {
          addToast("success", `成功删除 ${successCount} 个账号`);
        } else {
          addToast("warning", `删除完成：${successCount} 成功，${failCount} 失败`);
        }
      },
    });
  };

  // 删除过期/失效账号
  const handleDeleteExpiredAccounts = () => {
    // 筛选出过期或失效的账号
    const expiredAccounts = accounts.filter((account) => {
      if (!account.token_expired_at) return false;
      const expiry = new Date(account.token_expired_at).getTime();
      if (isNaN(expiry)) return false;
      return expiry < Date.now(); // Token 已过期
    });

    if (expiredAccounts.length === 0) {
      addToast("info", "没有找到过期或失效的账号");
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: "删除过期账号",
      message: `检测到 ${expiredAccounts.length} 个过期账号，确定要删除吗？此操作无法撤销。`,
      type: "warning",
      onConfirm: async () => {
        setConfirmModal(null);
        addToast("info", `正在删除 ${expiredAccounts.length} 个过期账号...`);

        // 并行删除所有过期账号
        const results = await Promise.allSettled(
          expiredAccounts.map((account) => api.removeAccount(account.id))
        );

        // 统计结果
        const successCount = results.filter((r) => r.status === 'fulfilled').length;
        const failCount = expiredAccounts.length - successCount;

        setSelectedIds(new Set());
        await loadAccounts();

        if (failCount === 0) {
          addToast("success", `成功删除 ${successCount} 个过期账号`);
        } else {
          addToast("warning", `删除完成：${successCount} 成功，${failCount} 失败`);
        }
      },
    });
  };

  return (
    <div className="app">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />

      <div className="app-content">
        {error && (
          <div className="error-banner">
            {error}
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        {currentPage === "dashboard" && (
          <Dashboard accounts={accounts} />
        )}

        {currentPage === "accounts" && (
          <>
            <header className="page-header">
              <div className="header-left">
                <h2 className="page-title">账号管理</h2>
                <p>管理您的账号</p>
              </div>
              <div className="header-right">
                <span className="account-count">共 {accounts.length} 个账号</span>
                <button
                  className="header-btn danger"
                  onClick={handleDeleteExpiredAccounts}
                  title="删除所有过期账号"
                  disabled={accounts.length === 0}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    <line x1="10" y1="11" x2="10" y2="17"/>
                    <line x1="14" y1="11" x2="14" y2="17"/>
                  </svg>
                  删除过期
                  {(() => {
                    const expiredCount = accounts.filter((account) => {
                      if (!account.token_expired_at) return false;
                      const expiry = new Date(account.token_expired_at).getTime();
                      if (isNaN(expiry)) return false;
                      return expiry < Date.now();
                    }).length;
                    return expiredCount > 0 ? <span className="badge-count">{expiredCount}</span> : null;
                  })()}
                </button>
                <button className="header-btn" onClick={handleShowImportInfo} title="导入账号">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                  </svg>
                  导入
                </button>
                <button className="header-btn" onClick={handleShowExportInfo} title="导出账号" disabled={accounts.length === 0}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                  </svg>
                  导出
                </button>
                <button className="add-btn" onClick={() => setShowAddModal(true)}>
                  <span>+</span> 添加账号
                </button>
              </div>
            </header>

            <main className="app-main">
              {accounts.length > 0 && (
                <div className="toolbar">
                  <div className="toolbar-left">
                    <label className="select-all">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === accounts.length && accounts.length > 0}
                        onChange={handleSelectAll}
                      />
                      全选 ({selectedIds.size}/{accounts.length})
                    </label>
                    {selectedIds.size > 0 && (
                      <div className="batch-actions">
                        <button className="batch-btn" onClick={handleBatchRefresh}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                          </svg>
                          刷新
                        </button>
                        <button className="batch-btn danger" onClick={handleBatchDelete}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                          删除
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="toolbar-right">
                    <div className="view-toggle">
                      <button
                        className={`view-btn ${viewMode === "grid" ? "active" : ""}`}
                        onClick={() => setViewMode("grid")}
                        title="卡片视图"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                          <rect x="3" y="3" width="7" height="7"/>
                          <rect x="14" y="3" width="7" height="7"/>
                          <rect x="3" y="14" width="7" height="7"/>
                          <rect x="14" y="14" width="7" height="7"/>
                        </svg>
                      </button>
                      <button
                        className={`view-btn ${viewMode === "list" ? "active" : ""}`}
                        onClick={() => setViewMode("list")}
                        title="列表视图"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                          <line x1="8" y1="6" x2="21" y2="6"/>
                          <line x1="8" y1="12" x2="21" y2="12"/>
                          <line x1="8" y1="18" x2="21" y2="18"/>
                          <line x1="3" y1="6" x2="3.01" y2="6"/>
                          <line x1="3" y1="12" x2="3.01" y2="12"/>
                          <line x1="3" y1="18" x2="3.01" y2="18"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {loading ? (
                <div className="loading">
                  <div className="spinner"></div>
                  <p>加载中...</p>
                </div>
              ) : accounts.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📋</div>
                  <h3>暂无账号</h3>
                  <p>点击上方按钮添加账号，或导入已有账号</p>
                  <div className="empty-actions">
                    <button className="empty-btn primary" onClick={() => setShowAddModal(true)}>
                      添加账号
                    </button>
                    <button className="empty-btn" onClick={handleImportAccounts}>
                      导入账号
                    </button>
                  </div>
                </div>
              ) : viewMode === "grid" ? (
                <div className="account-grid">
                  {accounts.map((account) => (
                    <AccountCard
                      key={account.id}
                      account={account}
                      usage={account.usage || null}
                      selected={selectedIds.has(account.id)}
                      onSelect={handleSelectAccount}
                      onContextMenu={handleContextMenu}
                    />
                  ))}
                </div>
              ) : (
                <div className="account-list">
                  <div className="list-header">
                    <div className="list-col checkbox"></div>
                    <div className="list-col avatar"></div>
                    <div className="list-col info">账号信息</div>
                    <div className="list-col plan">套餐</div>
                    <div className="list-col usage">使用量</div>
                    <div className="list-col reset">重置时间</div>
                    <div className="list-col status">状态</div>
                    <div className="list-col actions"></div>
                  </div>
                  {accounts.map((account) => (
                    <AccountListItem
                      key={account.id}
                      account={account}
                      usage={account.usage || null}
                      selected={selectedIds.has(account.id)}
                      onSelect={handleSelectAccount}
                      onContextMenu={handleContextMenu}
                    />
                  ))}
                </div>
              )}
            </main>
          </>
        )}

        {currentPage === "settings" && (
          <>
            <header className="page-header">
              <div className="header-left">
                <h2 className="page-title">设置</h2>
                <p>配置应用程序选项</p>
              </div>
            </header>
            <Settings
              onToast={addToast}
              settings={appSettings}
              onSettingsChange={setAppSettings}
              onRefreshAccounts={loadAccounts}
            />
          </>
        )}

        {currentPage === "custom-model-proxy" && (
          <>
            <header className="page-header">
              <div className="header-left">
                <h2 className="page-title">自定义模型代理</h2>
                <p>服务管理、证书管理、规则管理与测试 POST</p>
              </div>
            </header>
            <main className="app-main">
              <CustomModelProxy onToast={addToast} />
            </main>
          </>
        )}

        {currentPage === "about" && (
          <>
            <header className="page-header">
              <div className="header-left">
                <h2 className="page-title">关于</h2>
                <p>应用程序信息</p>
              </div>
            </header>
            <About />
          </>
        )}
      </div>

      {/* Toast 通知 */}
      <Toast messages={toasts} onRemove={removeToast} />

      {/* 确认弹窗 */}
      {confirmModal && (
        <ConfirmModal
          isOpen={confirmModal.isOpen}
          title={confirmModal.title}
          message={confirmModal.message}
          type={confirmModal.type}
          confirmText="确定"
          cancelText="取消"
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {/* 信息展示弹窗 */}
      {infoModal && (
        <InfoModal
          isOpen={infoModal.isOpen}
          title={infoModal.title}
          icon={infoModal.icon}
          sections={infoModal.sections}
          confirmText={infoModal.confirmText}
          onConfirm={infoModal.onConfirm}
          onCancel={() => setInfoModal(null)}
        />
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onRelogin={() => {
            handleSwitchAccount(contextMenu.accountId, { mode: "relogin", force: true });
          }}
          onViewDetail={() => {
            handleViewDetail(contextMenu.accountId);
            setContextMenu(null);
          }}
          onRefresh={() => {
            handleRefreshAccount(contextMenu.accountId);
            setContextMenu(null);
          }}
          onUpdateToken={() => {
            handleOpenUpdateToken(contextMenu.accountId);
            setContextMenu(null);
          }}
          onCopyToken={() => {
            handleCopyToken(contextMenu.accountId);
            setContextMenu(null);
          }}
          onOpenOfficialSite={() => {
            handleOpenOfficialSite(contextMenu.accountId);
            setContextMenu(null);
          }}
          onSwitchAccount={() => {
            handleSwitchAccount(contextMenu.accountId);
          }}
          onDelete={() => {
            handleDeleteAccount(contextMenu.accountId);
            setContextMenu(null);
          }}
          isCurrent={accounts.find(a => a.id === contextMenu.accountId)?.is_current || false}
        />
      )}

      {/* 添加账号弹窗 */}
      <AddAccountModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={handleAddAccount}
        onToast={addToast}
        onAccountAdded={loadAccounts}
        quickRegisterShowWindow={appSettings.quick_register_show_window}
        autoRegisterThreads={appSettings.auto_register_threads}
        officialSiteUseSystemBrowser={appSettings.official_site_use_system_browser}
      />

      {/* 详情弹窗 */}
      <DetailModal
        isOpen={!!detailAccount}
        onClose={() => setDetailAccount(null)}
        onSavePassword={handleSavePassword}
        account={detailAccount}
        usage={detailAccount?.usage || null}
      />

      {/* 更新 Token 弹窗 */}
      <UpdateTokenModal
        isOpen={!!updateTokenModal}
        accountId={updateTokenModal?.accountId || ""}
        accountName={updateTokenModal?.accountName || ""}
        onClose={() => setUpdateTokenModal(null)}
        onUpdate={handleUpdateToken}
      />
    </div>
  );
}

export default App;
