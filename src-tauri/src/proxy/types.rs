use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyApiRule {
    pub name: String,
    #[serde(default)]
    pub provider: String,
    pub endpoint: String,
    #[serde(default)]
    pub api_key: String,
    pub custom_model_id: String,
    pub target_model_id: String,
    pub stream_mode: Option<String>,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyProviderConfig {
    pub name: String,
    pub endpoint: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_true")]
    pub active: bool,
}

impl Default for ProxyApiRule {
    fn default() -> Self {
        Self {
            name: String::new(),
            provider: String::new(),
            endpoint: String::new(),
            api_key: String::new(),
            custom_model_id: String::new(),
            target_model_id: String::new(),
            stream_mode: None,
            active: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyServerConfig {
    pub port: u16,
    pub debug: bool,
}

impl Default for ProxyServerConfig {
    fn default() -> Self {
        Self {
            port: 443,
            debug: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyCertConfig {
    pub domain: String,
    pub ca_cert_path: String,
    pub cert_path: String,
    pub key_path: String,
    #[serde(default)]
    pub installed: bool,
}

impl Default for ProxyCertConfig {
    fn default() -> Self {
        Self {
            domain: "api.openai.com".to_string(),
            ca_cert_path: "config/certs/ca.crt".to_string(),
            cert_path: "config/certs/api.openai.com.crt".to_string(),
            key_path: "config/certs/api.openai.com.key".to_string(),
            installed: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    pub domain: String,
    pub apis: Vec<ProxyApiRule>,
    #[serde(default)]
    pub providers: Vec<ProxyProviderConfig>,
    pub server: ProxyServerConfig,
    pub mode: String,
    pub cert: ProxyCertConfig,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            domain: "api.openai.com".to_string(),
            apis: Vec::new(),
            providers: Vec::new(),
            server: ProxyServerConfig::default(),
            mode: "transparent".to_string(),
            cert: ProxyCertConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyStatus {
    pub running: bool,
    pub mode: String,
    pub port: u16,
    pub base_url: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertStatus {
    pub generated: bool,
    pub installed: bool,
    pub domain: String,
    pub ca_cert_path: String,
    pub cert_path: String,
    pub key_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertOperationResult {
    pub success: bool,
    pub message: String,
    pub detail: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyDiagnosticLog {
    pub timestamp: String,
    pub path: String,
    pub rule_name: String,
    pub source_model: Option<String>,
    pub target_model: Option<String>,
    pub upstream_status: Option<u16>,
    pub duration_ms: u128,
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyTestRequest {
    pub endpoint: String,
    pub method: String,
    pub body: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyTestResult {
    pub success: bool,
    pub method: String,
    pub url: String,
    pub status: u16,
    pub duration_ms: u128,
    pub request_body: Option<serde_json::Value>,
    pub response_body: String,
    pub error: Option<String>,
}

fn default_true() -> bool {
    true
}
