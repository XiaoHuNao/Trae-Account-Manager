// 账号简要信息
export interface AccountBrief {
  id: string;
  name: string;
  email: string;
  avatar_url: string;
  plan_type: string;
  is_active: boolean;
  created_at: number;
  machine_id: string | null;
  is_current: boolean; // 是否是当前 Trae IDE 正在使用的账号
  token_expired_at: string | null; // Token 过期时间
}

// 完整账号信息
export interface Account {
  id: string;
  name: string;
  email: string;
  avatar_url: string;
  cookies: string;
  password: string | null;
  jwt_token: string | null;
  token_expired_at: string | null;
  user_id: string;
  tenant_id: string;
  region: string;
  plan_type: string;
  created_at: number;
  updated_at: number;
  is_active: boolean;
  machine_id: string | null;
}

export interface AppSettings {
  quick_register_show_window: boolean;
  auto_register_threads: number;
  official_site_use_system_browser: boolean;
  accounts_data_path: string;
}

// 使用量汇总
export interface UsageSummary {
  plan_type: string;
  reset_time: number;
  extra_package_name: string;
  extra_expire_time: number;
  basic_usage_used: number;
  basic_usage_limit: number;
  basic_usage_left: number;
  bonus_usage_used: number;
  bonus_usage_limit: number;
  bonus_usage_left: number;
  total_usage_used: number;
  total_usage_limit: number;
  total_usage_left: number;
}

// 使用事件
export interface UsageEvent {
  session_id: string;
  usage_time: number;
  mode: string;
  model_name: string;
  amount_float: number;
  cost_money_float: number;
  use_max_mode: boolean;
  product_type_list: number[];
  extra_info: {
    cache_read_token: number;
    cache_write_token: number;
    input_token: number;
    output_token: number;
  };
}

// 使用事件响应
export interface UsageEventsResponse {
  total: number;
  user_usage_group_by_sessions: UsageEvent[];
}

// API 错误
export interface ApiError {
  message: string;
}

export interface ProxyApiRule {
  name: string;
  provider: string;
  endpoint: string;
  api_key: string;
  custom_model_id: string;
  target_model_id: string;
  stream_mode: string | null;
  active: boolean;
}

export interface ProxyProviderConfig {
  name: string;
  endpoint: string;
  api_key: string;
  active: boolean;
}

export interface ProxyServerConfig {
  port: number;
  debug: boolean;
}

export interface ProxyCertConfig {
  domain: string;
  ca_cert_path: string;
  cert_path: string;
  key_path: string;
  installed: boolean;
}

export interface ProxyConfig {
  domain: string;
  apis: ProxyApiRule[];
  providers: ProxyProviderConfig[];
  server: ProxyServerConfig;
  mode: "transparent";
  cert: ProxyCertConfig;
}

export interface ProxyStatus {
  running: boolean;
  mode: string;
  port: number;
  base_url: string;
  last_error: string | null;
}

export interface CertStatus {
  generated: boolean;
  installed: boolean;
  domain: string;
  ca_cert_path: string;
  cert_path: string;
  key_path: string;
}

export interface CertOperationResult {
  success: boolean;
  message: string;
  detail: string | null;
  path: string | null;
}

export interface ProxyDiagnosticLog {
  timestamp: string;
  path: string;
  rule_name: string;
  source_model: string | null;
  target_model: string | null;
  upstream_status: number | null;
  duration_ms: number;
  error_summary: string | null;
}

export interface ProxyTestRequest {
  endpoint: string;
  method: string;
  body?: Record<string, unknown> | null;
}

export interface ProxyTestResult {
  success: boolean;
  method: string;
  url: string;
  status: number;
  duration_ms: number;
  request_body: Record<string, unknown> | null;
  response_body: string;
  error: string | null;
}
