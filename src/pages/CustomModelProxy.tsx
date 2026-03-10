import { Pencil, Plus, ToggleLeft, ToggleRight, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import * as api from "../api";
import type {
  ProxyApiRule,
  ProxyConfig,
  ProxyProviderConfig,
  ProxyStatus,
  CertStatus,
  ProxyTestResult,
} from "../types";

interface CustomModelProxyProps {
  onToast?: (type: "success" | "error" | "warning" | "info", message: string) => void;
}

const createEmptyRule = (): ProxyApiRule => ({
  name: "",
  provider: "",
  endpoint: "",
  api_key: "",
  custom_model_id: "",
  target_model_id: "",
  stream_mode: null,
  active: true,
});

const createEmptyProvider = (): ProxyProviderConfig => ({
  name: "",
  endpoint: "",
  api_key: "",
  active: true,
});

const createDefaultConfig = (): ProxyConfig => ({
  domain: "api.openai.com",
  mode: "transparent",
  server: {
    port: 443,
    debug: true,
  },
  cert: {
    domain: "api.openai.com",
    ca_cert_path: "config/certs/ca.crt",
    cert_path: "config/certs/api.openai.com.crt",
    key_path: "config/certs/api.openai.com.key",
    installed: false,
  },
  providers: [],
  apis: [],
});

type RuleModalState = {
  open: boolean;
  index: number | null;
  draft: ProxyApiRule;
};

type ProviderModalState = {
  open: boolean;
  index: number | null;
  draft: ProxyProviderConfig;
};

export function CustomModelProxy({ onToast }: CustomModelProxyProps) {
  const [config, setConfig] = useState<ProxyConfig>(createDefaultConfig());
  const [status, setStatus] = useState<ProxyStatus | null>(null);
  const [certStatus, setCertStatus] = useState<CertStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [testingPath, setTestingPath] = useState<"/v1/chat/completions" | "/v1/models" | null>(null);
  const [testBaseUrl, setTestBaseUrl] = useState("");
  const [testRuleKey, setTestRuleKey] = useState("");
  const [testResult, setTestResult] = useState<ProxyTestResult | null>(null);
  const [ruleModal, setRuleModal] = useState<RuleModalState>({
    open: false,
    index: null,
    draft: createEmptyRule(),
  });
  const [providerModal, setProviderModal] = useState<ProviderModalState>({
    open: false,
    index: null,
    draft: createEmptyProvider(),
  });
  const [ruleAdvanced, setRuleAdvanced] = useState(false);

  const sanitizeConfig = (source: ProxyConfig): ProxyConfig => {
    const providers = (source.providers || [])
      .map((provider) => ({
        ...provider,
        name: provider.name.trim(),
        endpoint: provider.endpoint.trim(),
        api_key: provider.api_key.trim(),
      }))
      .filter((provider) => provider.name.length > 0);
    const providerNames = new Set(providers.map((provider) => provider.name));
    const apis = (source.apis || [])
      .map((rule) => ({
        ...rule,
        name: rule.name.trim(),
        provider: providerNames.has(rule.provider.trim()) ? rule.provider.trim() : "",
        endpoint: rule.endpoint.trim(),
        api_key: rule.api_key.trim(),
        custom_model_id: rule.custom_model_id.trim(),
        target_model_id: rule.target_model_id.trim(),
      }))
      .filter((rule) => rule.custom_model_id.length > 0 || rule.name.length > 0);
    return { ...source, providers, apis };
  };

  const persistConfig = async (nextConfig: ProxyConfig, successMessage: string) => {
    setSaving(true);
    try {
      const payload = sanitizeConfig(nextConfig);
      const saved = await api.saveProxyConfig(payload);
      setConfig(saved);
      onToast?.("success", successMessage);
      return true;
    } catch (err: any) {
      onToast?.("error", err.message || "保存代理配置失败");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const loadAll = async () => {
    try {
      const [nextConfig, nextStatus, nextCert] = await Promise.all([
        api.getProxyConfig(),
        api.getProxyStatus(),
        api.getCertStatus(),
      ]);
      const sanitized = sanitizeConfig({
        ...nextConfig,
        providers: nextConfig.providers || [],
        apis: nextConfig.apis || [],
      });
      setConfig(sanitized);
      setStatus(nextStatus);
      setCertStatus(nextCert);
    } catch (err: any) {
      onToast?.("error", err.message || "加载代理配置失败");
    }
  };

  useEffect(() => {
    loadAll();
    const timer = setInterval(() => {
      api.getProxyStatus().then(setStatus).catch(() => null);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const canStart = useMemo(() => {
    return !!certStatus?.generated && !!certStatus?.installed;
  }, [certStatus]);

  const testRuleOptions = useMemo(() => {
    const source = (config.apis || []).filter((item) => item.active);
    const fallback = source.length > 0 ? source : config.apis || [];
    return fallback
      .map((item, index) => {
        const customModel = item.custom_model_id.trim();
        const targetModel = item.target_model_id.trim();
        const model = customModel || targetModel;
        if (!model) {
          return null;
        }
        const provider = item.provider.trim() || "未指定厂商";
        const ruleName = item.name.trim() || `规则 ${index + 1}`;
        const key = `${index}::${provider}::${model}`;
        const label = `${provider} / ${model}`;
        return {
          key,
          label,
          provider,
          ruleName,
          model,
        };
      })
      .filter((item): item is {
        key: string;
        label: string;
        provider: string;
        ruleName: string;
        model: string;
      } => item !== null);
  }, [config.apis]);

  useEffect(() => {
    if (testRuleOptions.length === 0) {
      if (testRuleKey) {
        setTestRuleKey("");
      }
      return;
    }
    const exists = testRuleOptions.some((item) => item.key === testRuleKey);
    if (!testRuleKey || !exists) {
      setTestRuleKey(testRuleOptions[0].key);
    }
  }, [testRuleOptions, testRuleKey]);

  const handleConfigChange = <K extends keyof ProxyConfig>(key: K, value: ProxyConfig[K]) => {
    setConfig((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleDeleteRule = async (index: number) => {
    const apis = config.apis.filter((_, i) => i !== index);
    await persistConfig({ ...config, apis }, "规则已删除");
  };

  const handleDeleteProvider = async (index: number) => {
    const targetName = config.providers[index]?.name || "";
    const providers = config.providers.filter((_, i) => i !== index);
    const apis = config.apis.map((rule) => (rule.provider === targetName ? { ...rule, provider: "" } : rule));
    await persistConfig({ ...config, providers, apis }, "厂商已删除");
  };

  const handleSaveServiceConfig = async () => {
    await persistConfig(config, "代理配置已保存");
  };

  const openAddProviderModal = () => {
    setProviderModal({
      open: true,
      index: null,
      draft: createEmptyProvider(),
    });
  };

  const openEditProviderModal = (index: number) => {
    setProviderModal({
      open: true,
      index,
      draft: { ...config.providers[index] },
    });
  };

  const applyProviderModal = async () => {
    const next = {
      ...providerModal.draft,
      name: providerModal.draft.name.trim(),
      endpoint: providerModal.draft.endpoint.trim(),
    };
    if (!next.name) {
      onToast?.("warning", "请先填写厂商名称");
      return;
    }
    const providers = [...config.providers];
    if (providerModal.index === null) {
      providers.push(next);
    } else {
      providers[providerModal.index] = next;
    }
    const ok = await persistConfig({ ...config, providers }, providerModal.index === null ? "厂商已新增" : "厂商已更新");
    if (ok) {
      setProviderModal({
        open: false,
        index: null,
        draft: createEmptyProvider(),
      });
    }
  };

  const openAddRuleModal = () => {
    setRuleAdvanced(false);
    const defaultProvider = config.providers.find((item) => item.active)?.name || config.providers[0]?.name || "";
    setRuleModal({
      open: true,
      index: null,
      draft: {
        ...createEmptyRule(),
        provider: defaultProvider,
      },
    });
  };

  const openEditRuleModal = (index: number) => {
    setRuleAdvanced(false);
    setRuleModal({
      open: true,
      index,
      draft: { ...config.apis[index] },
    });
  };

  const applyRuleModal = async () => {
    const model = ruleModal.draft.custom_model_id.trim();
    const next: ProxyApiRule = {
      ...ruleModal.draft,
      name: ruleModal.draft.name.trim() || model,
      custom_model_id: model,
      target_model_id: ruleModal.draft.target_model_id.trim() || model,
      endpoint: ruleModal.draft.endpoint.trim(),
      api_key: ruleModal.draft.api_key.trim(),
      provider: ruleModal.draft.provider.trim(),
    };
    if (!next.custom_model_id) {
      onToast?.("warning", "请先填写模型ID");
      return;
    }
    const apis = [...config.apis];
    if (ruleModal.index === null) {
      apis.push(next);
    } else {
      apis[ruleModal.index] = next;
    }
    const ok = await persistConfig({ ...config, apis }, ruleModal.index === null ? "规则已新增" : "规则已更新");
    if (ok) {
      setRuleModal({
        open: false,
        index: null,
        draft: createEmptyRule(),
      });
    }
  };

  const handleStartProxy = async () => {
    setStarting(true);
    try {
      const nextStatus = await api.startProxy();
      setStatus(nextStatus);
      onToast?.("success", "代理已启动");
    } catch (err: any) {
      onToast?.("error", err.message || "启动代理失败");
    } finally {
      setStarting(false);
    }
  };

  const handleStopProxy = async () => {
    setStopping(true);
    try {
      const nextStatus = await api.stopProxy();
      setStatus(nextStatus);
      onToast?.("success", "代理已停止");
    } catch (err: any) {
      onToast?.("error", err.message || "停止代理失败");
    } finally {
      setStopping(false);
    }
  };

  const runCertAction = async (action: "generate" | "install" | "uninstall" | "export") => {
    try {
      const result =
        action === "generate"
          ? await api.generateCert()
          : action === "install"
            ? await api.installCert()
            : action === "uninstall"
              ? await api.uninstallCert()
              : await api.exportCert();
      onToast?.("success", `${result.message}${result.path ? `: ${result.path}` : ""}`);
      const nextCertStatus = await api.getCertStatus();
      setCertStatus(nextCertStatus);
    } catch (err: any) {
      onToast?.("error", err.message || "证书操作失败");
    }
  };

  const handleTestPost = async (path: "/v1/chat/completions" | "/v1/models") => {
    if (!testBaseUrl.trim() && !status?.running) {
      onToast?.("warning", "请先启动代理，或填写可访问的POST基地址");
      return;
    }
    setTestingPath(path);
    try {
      const base = (testBaseUrl.trim() || status?.base_url || `http://127.0.0.1:${config.server.port}`).replace(/\/+$/, "");
      const endpoint = `${base}${path}`;
      const selectedRule = testRuleOptions.find((item) => item.key === testRuleKey) || testRuleOptions[0];
      const modelToTest = selectedRule?.model || "gpt-4";
      const requestBody = path === "/v1/chat/completions"
        ? {
            model: modelToTest,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }
        : null;
      const result = await api.testProxyPost({
        endpoint,
        method: path === "/v1/models" ? "GET" : "POST",
        body: requestBody,
      });
      setTestResult(result);
      onToast?.(result.success ? "success" : "warning", result.success ? "测试请求成功" : "测试请求失败");
    } catch (err: any) {
      const message = `${err?.message || err}`;
      if (message.includes("invoke")) {
        onToast?.("warning", "当前是浏览器预览环境，测试接口需在桌面应用中使用");
      } else {
        onToast?.("error", err.message || "测试请求失败");
      }
      setTestResult({
        success: false,
        method: "POST",
        url: "",
        status: 0,
        duration_ms: 0,
        request_body: null,
        response_body: "",
        error: err.message || "请求异常",
      });
    } finally {
      setTestingPath(null);
    }
  };

  return (
    <div className="proxy-page">
      <div className="proxy-section">
        <h3>服务管理</h3>
        <div className="proxy-grid">
          <label className="proxy-field">
            <span>代理模式</span>
            <input value="透明拦截模式" disabled />
          </label>
          <label className="proxy-field">
            <span>监听端口</span>
            <input
              type="number"
              value={config.server.port}
              onChange={(e) =>
                handleConfigChange("server", {
                  ...config.server,
                  port: Number(e.target.value || 0),
                })
              }
            />
          </label>
          <label className="proxy-field">
            <span>代理域名</span>
            <input
              value={config.domain}
              onChange={(e) => {
                handleConfigChange("domain", e.target.value);
                handleConfigChange("cert", { ...config.cert, domain: e.target.value });
              }}
            />
          </label>
        </div>
        <div className="proxy-actions">
          <button className="proxy-btn primary" onClick={handleSaveServiceConfig} disabled={saving}>
            {saving ? "保存中..." : "保存配置"}
          </button>
          {status?.running ? (
            <button className="proxy-btn danger" onClick={handleStopProxy} disabled={stopping}>
              {stopping ? "停止中..." : "停止代理"}
            </button>
          ) : (
            <button className="proxy-btn success" onClick={handleStartProxy} disabled={starting || !canStart}>
              {starting ? "启动中..." : "启动代理"}
            </button>
          )}
        </div>
        <div className="proxy-status-bar">
          <span className="proxy-run-indicator">
            <i className={`proxy-dot ${status?.running ? "running" : "stopped"}`}></i>
            {status?.running ? "运行中" : "已停止"}
          </span>
          <span>模式：透明拦截模式</span>
          <span>地址：{status?.base_url || `https://127.0.0.1:${config.server.port}`}</span>
        </div>
      </div>

      <div className="proxy-section">
        <h3>证书管理</h3>
        <div className="proxy-status-bar">
          <span>证书文件：{certStatus?.generated ? "已生成" : "未生成"}</span>
          <span>系统信任：{certStatus?.installed ? "已安装" : "未安装"}</span>
          <span>域名：{certStatus?.domain || config.cert.domain}</span>
        </div>
        <div className="proxy-actions">
          <button className="proxy-btn" onClick={() => runCertAction("generate")}>生成证书</button>
          <button className="proxy-btn" onClick={() => runCertAction("install")}>安装证书</button>
          <button className="proxy-btn" onClick={() => runCertAction("uninstall")}>卸载证书</button>
          <button className="proxy-btn" onClick={() => runCertAction("export")}>导出证书</button>
        </div>
      </div>

      <div className="proxy-section">
        <div className="proxy-header-inline">
          <h3>厂商配置</h3>
          <div className="proxy-actions">
            <button className="proxy-btn" onClick={openAddProviderModal}>
              <Plus size={14} />
              新增厂商
            </button>
          </div>
        </div>
        <div className="proxy-list">
          {config.providers.length === 0 ? (
            <div className="proxy-empty">暂无厂商，请点击“新增厂商”</div>
          ) : config.providers.map((provider, index) => (
            <div key={index} className="proxy-list-row">
              <div className="proxy-list-main">
                <span className="proxy-list-title">{provider.name || `厂商 ${index + 1}`}</span>
                <span className="proxy-list-sub">{provider.endpoint || "-"}</span>
                <span className="proxy-list-sub">Key：{provider.api_key ? "已填写" : "未填写"}</span>
              </div>
              <div className="proxy-list-actions">
                <button className="proxy-icon-btn" onClick={() => openEditProviderModal(index)}>
                  <Pencil size={14} />
                </button>
                <button className="proxy-icon-btn danger" onClick={() => handleDeleteProvider(index)}>
                  <Trash2 size={14} />
                </button>
                <button
                  className={`proxy-icon-btn ${provider.active ? "is-on" : "is-off"}`}
                  onClick={async () => {
                    const providers = [...config.providers];
                    providers[index] = { ...providers[index], active: !providers[index].active };
                    await persistConfig({ ...config, providers }, providers[index].active ? "厂商已启用" : "厂商已停用");
                  }}
                  title={provider.active ? "关闭" : "开启"}
                >
                  {provider.active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="proxy-section">
        <div className="proxy-header-inline">
          <h3>规则管理</h3>
          <div className="proxy-actions">
            <button className="proxy-btn" onClick={openAddRuleModal}>
              <Plus size={14} />
              新增规则
            </button>
          </div>
        </div>
        <div className="proxy-list">
          {config.apis.length === 0 ? (
            <div className="proxy-empty">暂无规则，请点击“新增规则”</div>
          ) : config.apis.map((rule, index) => (
            <div key={index} className="proxy-list-row">
              <div className="proxy-list-main">
                <span className="proxy-list-title">{rule.name || rule.custom_model_id || `规则 ${index + 1}`}</span>
                <span className="proxy-list-sub">厂商：{rule.provider || "-"}</span>
                <span className="proxy-list-sub">
                  模型：{rule.custom_model_id || "-"} → {rule.target_model_id || "-"}
                </span>
              </div>
              <div className="proxy-list-actions">
                <button className="proxy-icon-btn" onClick={() => openEditRuleModal(index)}>
                  <Pencil size={14} />
                </button>
                <button className="proxy-icon-btn danger" onClick={() => handleDeleteRule(index)}>
                  <Trash2 size={14} />
                </button>
                <button
                  className={`proxy-icon-btn ${rule.active ? "is-on" : "is-off"}`}
                  onClick={async () => {
                    const apis = [...config.apis];
                    apis[index] = { ...apis[index], active: !apis[index].active };
                    await persistConfig({ ...config, apis }, apis[index].active ? "规则已启用" : "规则已停用");
                  }}
                  title={rule.active ? "关闭" : "开启"}
                >
                  {rule.active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="proxy-section">
        <h3>测试POST</h3>
        <label className="proxy-field">
          <span>POST基地址（IP+端口）</span>
          <input
            value={testBaseUrl}
            onChange={(e) => setTestBaseUrl(e.target.value)}
            placeholder={status?.base_url || `http://127.0.0.1:${config.server.port}`}
          />
        </label>
        <label className="proxy-field">
          <span>测试模型</span>
          <select
            value={testRuleKey}
            onChange={(e) => setTestRuleKey(e.target.value)}
            disabled={!!testingPath || testRuleOptions.length === 0}
          >
            {testRuleOptions.length === 0 ? (
              <option value="">暂无可选模型，请先新增并启用规则</option>
            ) : (
              testRuleOptions.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))
            )}
          </select>
        </label>
        <div className="proxy-test-rows">
          <div className="proxy-test-row">
            <span className="proxy-test-path">/v1/chat/completions</span>
            <button
              className="proxy-btn primary"
              onClick={() => handleTestPost("/v1/chat/completions")}
              disabled={!!testingPath}
            >
              {testingPath === "/v1/chat/completions" ? "测试中..." : "测试"}
            </button>
          </div>
          <div className="proxy-test-row">
            <span className="proxy-test-path">/v1/models</span>
            <button
              className="proxy-btn primary"
              onClick={() => handleTestPost("/v1/models")}
              disabled={!!testingPath}
            >
              {testingPath === "/v1/models" ? "测试中..." : "测试"}
            </button>
          </div>
        </div>
        {testResult && (
          <details className="proxy-debug-details">
            <summary>查看调试结果</summary>
            <pre className="proxy-result">{JSON.stringify(testResult, null, 2)}</pre>
          </details>
        )}
      </div>

      {providerModal.open && (
        <div className="proxy-modal-mask">
          <div className="proxy-modal-card">
            <div className="proxy-modal-header">
              <h4>{providerModal.index === null ? "新增厂商" : "编辑厂商"}</h4>
              <button
                className="proxy-icon-btn"
                onClick={() =>
                  setProviderModal({
                    open: false,
                    index: null,
                    draft: createEmptyProvider(),
                  })
                }
              >
                <X size={14} />
              </button>
            </div>
            <div className="proxy-grid">
              <label className="proxy-field">
                <span>厂商名称</span>
                <input
                  value={providerModal.draft.name}
                  onChange={(e) =>
                    setProviderModal((prev) => ({
                      ...prev,
                      draft: { ...prev.draft, name: e.target.value },
                    }))
                  }
                />
              </label>
              <label className="proxy-field">
                <span>上游地址</span>
                <input
                  value={providerModal.draft.endpoint}
                  onChange={(e) =>
                    setProviderModal((prev) => ({
                      ...prev,
                      draft: { ...prev.draft, endpoint: e.target.value },
                    }))
                  }
                />
              </label>
              <label className="proxy-field">
                <span>API Key</span>
                <input
                  type="password"
                  value={providerModal.draft.api_key}
                  onChange={(e) =>
                    setProviderModal((prev) => ({
                      ...prev,
                      draft: { ...prev.draft, api_key: e.target.value },
                    }))
                  }
                />
              </label>
            </div>
            <div className="proxy-actions">
              <button className="proxy-btn primary" onClick={applyProviderModal}>保存</button>
            </div>
          </div>
        </div>
      )}

      {ruleModal.open && (
        <div className="proxy-modal-mask">
          <div className="proxy-modal-card">
            <div className="proxy-modal-header">
              <h4>{ruleModal.index === null ? "新增规则" : "编辑规则"}</h4>
              <button
                className="proxy-icon-btn"
                onClick={() =>
                  setRuleModal({
                    open: false,
                    index: null,
                    draft: createEmptyRule(),
                  })
                }
              >
                <X size={14} />
              </button>
            </div>
            <div className="proxy-grid">
              <label className="proxy-field">
                <span>厂商</span>
                <select
                  value={ruleModal.draft.provider}
                  onChange={(e) =>
                    setRuleModal((prev) => ({
                      ...prev,
                      draft: { ...prev.draft, provider: e.target.value },
                    }))
                  }
                >
                  <option value="">未选择厂商</option>
                  {config.providers.map((provider, index) => (
                    <option key={`${provider.name}-${index}`} value={provider.name}>
                      {provider.name || `厂商 ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="proxy-field">
                <span>模型ID</span>
                <input
                  value={ruleModal.draft.custom_model_id}
                  onChange={(e) =>
                    setRuleModal((prev) => ({
                      ...prev,
                      draft: {
                        ...prev.draft,
                        custom_model_id: e.target.value,
                        target_model_id: prev.draft.target_model_id || e.target.value,
                        name: prev.draft.name || e.target.value,
                      },
                    }))
                  }
                />
              </label>
            </div>
            <div className="proxy-actions">
              <button className="proxy-btn" onClick={() => setRuleAdvanced((prev) => !prev)}>
                {ruleAdvanced ? "收起高级设置" : "高级设置"}
              </button>
            </div>
            {ruleAdvanced && (
              <div className="proxy-grid">
                <label className="proxy-field">
                  <span>名称</span>
                  <input
                    value={ruleModal.draft.name}
                    onChange={(e) =>
                      setRuleModal((prev) => ({
                        ...prev,
                        draft: { ...prev.draft, name: e.target.value },
                      }))
                    }
                  />
                </label>
                <label className="proxy-field">
                  <span>目标模型ID</span>
                  <input
                    value={ruleModal.draft.target_model_id}
                    onChange={(e) =>
                      setRuleModal((prev) => ({
                        ...prev,
                        draft: { ...prev.draft, target_model_id: e.target.value },
                      }))
                    }
                  />
                </label>
                <label className="proxy-field">
                  <span>流模式</span>
                  <select
                    value={ruleModal.draft.stream_mode || "none"}
                    onChange={(e) =>
                      setRuleModal((prev) => ({
                        ...prev,
                        draft: {
                          ...prev.draft,
                          stream_mode: e.target.value === "none" ? null : e.target.value,
                        },
                      }))
                    }
                  >
                    <option value="none">保持请求值</option>
                    <option value="true">强制开启</option>
                    <option value="false">强制关闭</option>
                  </select>
                </label>
                <label className="proxy-field">
                  <span>规则专用上游地址（可选）</span>
                  <input
                    value={ruleModal.draft.endpoint}
                    onChange={(e) =>
                      setRuleModal((prev) => ({
                        ...prev,
                        draft: { ...prev.draft, endpoint: e.target.value },
                      }))
                    }
                  />
                </label>
                <label className="proxy-field">
                  <span>规则专用 Key（可选）</span>
                  <input
                    type="password"
                    value={ruleModal.draft.api_key}
                    onChange={(e) =>
                      setRuleModal((prev) => ({
                        ...prev,
                        draft: { ...prev.draft, api_key: e.target.value },
                      }))
                    }
                  />
                </label>
              </div>
            )}
            <div className="proxy-actions">
              <button className="proxy-btn primary" onClick={applyRuleModal}>保存</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
