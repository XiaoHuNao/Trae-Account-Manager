use anyhow::{anyhow, Result};
use chrono::Utc;
use rcgen::{CertificateParams, DistinguishedName, DnType, KeyPair};
pub mod types;
use reqwest::header::{
    HeaderMap as ReqHeaderMap, HeaderName as ReqHeaderName, HeaderValue as ReqHeaderValue,
    AUTHORIZATION, CONTENT_TYPE,
};
use reqwest::Client;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{oneshot, Mutex};
use tokio::task::JoinHandle;
use warp::http::header::{HeaderName as WarpHeaderName, HeaderValue as WarpHeaderValue};
use warp::http::{Response, StatusCode};
use warp::Filter;

pub use types::{
    CertOperationResult, CertStatus, ProxyApiRule, ProxyConfig, ProxyDiagnosticLog, ProxyProviderConfig, ProxyStatus,
    ProxyTestRequest, ProxyTestResult,
};

struct ProxyRuntime {
    shutdown_tx: Option<oneshot::Sender<()>>,
    server_handle: JoinHandle<()>,
}

#[derive(Clone)]
struct ProxyContext {
    config: ProxyConfig,
    diagnostics: Arc<Mutex<VecDeque<ProxyDiagnosticLog>>>,
    client: Client,
}

pub struct ProxyManager {
    config_path: PathBuf,
    config: ProxyConfig,
    runtime: Option<ProxyRuntime>,
    diagnostics: Arc<Mutex<VecDeque<ProxyDiagnosticLog>>>,
    last_error: Option<String>,
}

impl ProxyManager {
    pub fn new() -> Result<Self> {
        let config_path = resolve_proxy_config_path()?;
        let config = load_proxy_config_with_migration(&config_path)?;
        Ok(Self {
            config_path,
            config,
            runtime: None,
            diagnostics: Arc::new(Mutex::new(VecDeque::new())),
            last_error: None,
        })
    }

    pub fn get_proxy_config(&self) -> ProxyConfig {
        self.config.clone()
    }

    pub async fn save_proxy_config(&mut self, mut next: ProxyConfig) -> Result<ProxyConfig> {
        next.mode = "transparent".to_string();
        next.domain = if next.domain.trim().is_empty() {
            "api.openai.com".to_string()
        } else {
            next.domain.trim().to_string()
        };
        next.cert.domain = if next.cert.domain.trim().is_empty() {
            next.domain.clone()
        } else {
            next.cert.domain.trim().to_string()
        };

        let was_running = self.runtime.is_some();
        if was_running {
            let _ = self.stop_proxy().await;
        }

        self.config = next;
        persist_proxy_config(&self.config_path, &self.config)?;

        if was_running {
            let _ = self.start_proxy().await?;
        }

        Ok(self.config.clone())
    }

    pub async fn start_proxy(&mut self) -> Result<ProxyStatus> {
        if self.runtime.is_some() {
            return Ok(self.get_proxy_status());
        }

        let cert_status = self.get_cert_status()?;
        if !cert_status.generated || !cert_status.installed {
            let error = "透明拦截模式需要先完成证书生成并安装".to_string();
            self.last_error = Some(error.clone());
            return Err(anyhow!(error));
        }

        let context = ProxyContext {
            config: self.config.clone(),
            diagnostics: self.diagnostics.clone(),
            client: Client::builder().build()?,
        };

        let root_route = warp::path::end().and(warp::get()).map(|| {
            warp::reply::json(&json!({
                "message": "Welcome to the OpenAI API! Documentation is available at https://platform.openai.com/docs/api-reference"
            }))
        });

        let v1_route = warp::path!("v1").and(warp::get()).map(|| {
            warp::reply::json(&json!({
                "message": "OpenAI API v1 endpoint",
                "endpoints": {
                    "chat/completions": "/v1/chat/completions"
                }
            }))
        });

        let models_list_ctx = context.clone();
        let models_get_route = warp::path!("v1" / "models")
            .and(warp::get())
            .and_then(move || {
                let ctx = models_list_ctx.clone();
                async move { Ok::<_, warp::Rejection>(handle_models_get(ctx).await) }
            });

        let models_ctx = context.clone();
        let models_post_route = warp::path!("v1" / "models")
            .and(warp::post())
            .and(warp::body::bytes())
            .and(warp::header::headers_cloned())
            .and_then(move |body: bytes::Bytes, headers: warp::http::HeaderMap| {
                let ctx = models_ctx.clone();
                async move { Ok::<_, warp::Rejection>(handle_models_post(body, headers, ctx).await) }
            });

        let chat_ctx = context.clone();
        let chat_route = warp::path!("v1" / "chat" / "completions")
            .and(warp::post())
            .and(warp::body::bytes())
            .and(warp::header::headers_cloned())
            .and_then(move |body: bytes::Bytes, headers: warp::http::HeaderMap| {
                let ctx = chat_ctx.clone();
                async move { Ok::<_, warp::Rejection>(handle_chat(body, headers, ctx).await) }
            });

        let health_route = warp::path!("health").and(warp::get()).map(|| {
            warp::reply::json(&json!({
                "ok": true
            }))
        });

        let routes = root_route
            .or(v1_route)
            .or(models_get_route)
            .or(models_post_route)
            .or(chat_route)
            .or(health_route);
        let port = self.config.server.port;
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        let cert_path = resolve_relative_path(&self.config.cert.cert_path);
        let key_path = resolve_relative_path(&self.config.cert.key_path);
        let server_future = warp::serve(routes)
            .tls()
            .cert_path(cert_path)
            .key_path(key_path)
            .bind_with_graceful_shutdown(([127, 0, 0, 1], port), async move {
                let _ = shutdown_rx.await;
            })
            .1;
        let handle = tokio::spawn(async move {
            server_future.await;
        });

        self.runtime = Some(ProxyRuntime {
            shutdown_tx: Some(shutdown_tx),
            server_handle: handle,
        });
        self.last_error = None;
        Ok(self.get_proxy_status())
    }

    pub async fn stop_proxy(&mut self) -> Result<ProxyStatus> {
        if let Some(mut runtime) = self.runtime.take() {
            if let Some(tx) = runtime.shutdown_tx.take() {
                let _ = tx.send(());
            }
            let _ = runtime.server_handle.await;
        }
        Ok(self.get_proxy_status())
    }

    pub fn get_proxy_status(&self) -> ProxyStatus {
        let running = self.runtime.is_some();
        ProxyStatus {
            running,
            mode: "transparent".to_string(),
            port: self.config.server.port,
            base_url: format!(
                "{}://127.0.0.1:{}",
                "https",
                self.config.server.port
            ),
            last_error: self.last_error.clone(),
        }
    }

    pub fn get_cert_status(&self) -> Result<CertStatus> {
        let ca = resolve_relative_path(&self.config.cert.ca_cert_path);
        let cert = resolve_relative_path(&self.config.cert.cert_path);
        let key = resolve_relative_path(&self.config.cert.key_path);
        Ok(CertStatus {
            generated: ca.exists() && cert.exists() && key.exists(),
            installed: self.config.cert.installed,
            domain: self.config.cert.domain.clone(),
            ca_cert_path: ca.to_string_lossy().to_string(),
            cert_path: cert.to_string_lossy().to_string(),
            key_path: key.to_string_lossy().to_string(),
        })
    }

    pub fn generate_cert(&mut self) -> Result<CertOperationResult> {
        let cert_dir = resolve_relative_path("config/certs");
        fs::create_dir_all(&cert_dir)?;
        let domain = self.config.cert.domain.clone();
        let ca_path = resolve_relative_path(&self.config.cert.ca_cert_path);
        let cert_path = resolve_relative_path(&self.config.cert.cert_path);
        let key_path = resolve_relative_path(&self.config.cert.key_path);

        if copy_existing_cert_assets(&domain, &ca_path, &cert_path, &key_path).is_ok() {
            self.config.cert.installed = false;
            persist_proxy_config(&self.config_path, &self.config)?;
            return Ok(CertOperationResult {
                success: true,
                message: "证书生成成功（复用现有证书文件）".to_string(),
                detail: None,
                path: Some(cert_dir.to_string_lossy().to_string()),
            });
        }

        let mut params = CertificateParams::new(vec![domain.clone()])?;
        let mut dn = DistinguishedName::new();
        dn.push(DnType::CommonName, domain);
        params.distinguished_name = dn;
        let key_pair = KeyPair::generate()?;
        let cert = params.self_signed(&key_pair)?;
        let cert_pem = cert.pem();
        let key_pem = key_pair.serialize_pem();
        fs::write(&cert_path, cert_pem.as_bytes())?;
        fs::write(&key_path, key_pem.as_bytes())?;
        fs::write(&ca_path, cert_pem.as_bytes())?;
        self.config.cert.installed = false;
        persist_proxy_config(&self.config_path, &self.config)?;
        Ok(CertOperationResult {
            success: true,
            message: "证书生成成功".to_string(),
            detail: None,
            path: Some(cert_dir.to_string_lossy().to_string()),
        })
    }

    pub fn install_cert(&mut self) -> Result<CertOperationResult> {
        let status = self.get_cert_status()?;
        if !status.generated {
            return Err(anyhow!("请先生成证书"));
        }
        if cfg!(target_os = "windows") {
            let mut errors: Vec<String> = Vec::new();
            match std::process::Command::new("certutil")
                .args(["-addstore", "-f", "Root", &status.ca_cert_path])
                .output()
            {
                Ok(output) if output.status.success() => {}
                Ok(output) => {
                    errors.push(format!(
                        "certutil失败: {}{}",
                        String::from_utf8_lossy(&output.stderr),
                        String::from_utf8_lossy(&output.stdout)
                    ));
                }
                Err(err) => errors.push(format!("certutil不可用: {}", err)),
            }
            if !errors.is_empty() {
                let escaped_path = status.ca_cert_path.replace('\'', "''");
                let ps_cmd = format!(
                    "Import-Certificate -FilePath '{}' -CertStoreLocation Cert:\\CurrentUser\\Root | Out-Null",
                    escaped_path
                );
                match std::process::Command::new("powershell")
                    .args(["-NoProfile", "-Command", &ps_cmd])
                    .output()
                {
                    Ok(output) if output.status.success() => {}
                    Ok(output) => {
                        errors.push(format!(
                            "PowerShell导入失败: {}{}",
                            String::from_utf8_lossy(&output.stderr),
                            String::from_utf8_lossy(&output.stdout)
                        ));
                        return Err(anyhow!("证书安装失败: {}", errors.join(" | ")));
                    }
                    Err(err) => {
                        errors.push(format!("PowerShell不可用: {}", err));
                        return Err(anyhow!("证书安装失败: {}", errors.join(" | ")));
                    }
                }
            }
        }
        self.config.cert.installed = true;
        persist_proxy_config(&self.config_path, &self.config)?;
        Ok(CertOperationResult {
            success: true,
            message: "证书安装成功".to_string(),
            detail: None,
            path: Some(status.ca_cert_path),
        })
    }

    pub fn uninstall_cert(&mut self) -> Result<CertOperationResult> {
        if cfg!(target_os = "windows") {
            let _ = std::process::Command::new("certutil")
                .args(["-delstore", "Root", &self.config.cert.domain])
                .output();
        }
        self.config.cert.installed = false;
        persist_proxy_config(&self.config_path, &self.config)?;
        Ok(CertOperationResult {
            success: true,
            message: "证书卸载成功".to_string(),
            detail: None,
            path: None,
        })
    }

    pub fn export_cert(&self) -> Result<CertOperationResult> {
        let status = self.get_cert_status()?;
        if !status.generated {
            return Err(anyhow!("证书未生成，无法导出"));
        }
        Ok(CertOperationResult {
            success: true,
            message: "证书导出路径".to_string(),
            detail: None,
            path: Some(status.ca_cert_path),
        })
    }

    pub async fn test_post(&self, request: ProxyTestRequest) -> Result<ProxyTestResult> {
        let method = if request.method.trim().is_empty() {
            "POST".to_string()
        } else {
            request.method.to_uppercase()
        };
        let endpoint = if request.endpoint.trim().is_empty() {
            "/v1/models".to_string()
        } else {
            request.endpoint.trim().to_string()
        };
        let base = self.get_proxy_status().base_url;
        let url = if endpoint.starts_with("http://") || endpoint.starts_with("https://") {
            endpoint
        } else {
            format!("{}{}", base, endpoint)
        };
        let client = Client::builder()
            .danger_accept_invalid_certs(true)
            .build()?;
        let started = Instant::now();
        let mut effective_body = request.body.clone();
        if method == "POST"
            && effective_body.is_none()
            && (url.ends_with("/v1/chat/completions") || url.contains("/v1/chat/completions?"))
        {
            let fallback_model = self
                .config
                .apis
                .iter()
                .find(|rule| rule.active && !rule.target_model_id.trim().is_empty())
                .map(|rule| rule.target_model_id.clone())
                .unwrap_or_else(|| "gpt-4".to_string());
            effective_body = Some(json!({
                "model": fallback_model,
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 1
            }));
        }
        let mut req = match method.as_str() {
            "GET" => client.get(&url),
            _ => client.post(&url),
        };
        if let Some(body) = &effective_body {
            req = req.json(body);
        }
        let response = req.send().await;
        let duration_ms = started.elapsed().as_millis();
        match response {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let body = resp.text().await.unwrap_or_default();
                Ok(ProxyTestResult {
                    success: (200..300).contains(&status),
                    method,
                    url,
                    status,
                    duration_ms,
                    request_body: effective_body.clone(),
                    response_body: body,
                    error: None,
                })
            }
            Err(err) => Ok(ProxyTestResult {
                success: false,
                method,
                url,
                status: 0,
                duration_ms,
                request_body: effective_body,
                response_body: String::new(),
                error: Some(err.to_string()),
            }),
        }
    }

    pub async fn get_diagnostics(&self) -> Vec<ProxyDiagnosticLog> {
        let logs = self.diagnostics.lock().await;
        logs.iter().cloned().collect()
    }
}

async fn handle_models_get(context: ProxyContext) -> Response<Vec<u8>> {
    let mut models: Vec<Value> = Vec::new();
    for api in context.config.apis.iter() {
        if api.active {
            models.push(json!({
                "id": api.custom_model_id,
                "object": "model",
                "created": 1,
                "owned_by": "trae-proxy"
            }));
        }
    }
    if models.is_empty() {
        models.push(json!({
            "id": "gpt-4",
            "object": "model",
            "created": 1,
            "owned_by": "trae-proxy"
        }));
    }
    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/json")
        .body(
            serde_json::to_vec(&json!({
                "object": "list",
                "data": models
            }))
            .unwrap_or_default(),
        )
        .unwrap_or_else(|_| Response::builder().status(500).body(vec![]).unwrap())
}

async fn handle_models_post(
    body: bytes::Bytes,
    headers: warp::http::HeaderMap,
    context: ProxyContext,
) -> Response<Vec<u8>> {
    let selected = select_rule(None, None, None, &context.config);
    if let Some(rule) = selected {
        let (resolved_endpoint, resolved_api_key) = resolve_rule_upstream(&rule, &context.config);
        let upstream_url = format!("{}/v1/models", trim_endpoint(&resolved_endpoint));
        let started = Instant::now();
        let response = forward_request(
            &context.client,
            "POST",
            &upstream_url,
            body.to_vec(),
            &headers,
            resolved_api_key.as_deref(),
            false,
        )
        .await;
        match response {
            Ok((status, resp_headers, bytes)) => {
                push_log(
                    context.diagnostics,
                    "/v1/models",
                    &rule.name,
                    None,
                    None,
                    Some(status),
                    None,
                    started.elapsed().as_millis(),
                )
                .await;
                let reply =
                    append_response_headers(Response::builder().status(status), &resp_headers, false);
                reply
                    .body(bytes)
                    .unwrap_or_else(|_| Response::builder().status(500).body(vec![]).unwrap())
            }
            Err(err) => {
                push_log(
                    context.diagnostics,
                    "/v1/models",
                    &rule.name,
                    None,
                    None,
                    None,
                    Some(err.to_string()),
                    started.elapsed().as_millis(),
                )
                .await;
                response_json_error(StatusCode::BAD_GATEWAY, err.to_string())
            }
        }
    } else {
        response_json_error(StatusCode::BAD_REQUEST, "未找到可用规则".to_string())
    }
}

async fn handle_chat(
    body: bytes::Bytes,
    headers: warp::http::HeaderMap,
    context: ProxyContext,
) -> Response<Vec<u8>> {
    let content_type = headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !content_type.contains("application/json") {
        return response_json_error(StatusCode::BAD_REQUEST, "Content-Type必须为application/json".to_string());
    }

    let mut payload: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(err) => return response_json_error(StatusCode::BAD_REQUEST, err.to_string()),
    };
    if !payload.is_object() {
        return response_json_error(StatusCode::BAD_REQUEST, "无效的JSON请求体".to_string());
    }

    let source_model = payload
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let provider_hint = payload
        .get("_trae_provider")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let rule_hint = payload
        .get("_trae_rule")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    if let Some(obj) = payload.as_object_mut() {
        obj.remove("_trae_provider");
        obj.remove("_trae_rule");
    }
    let selected = select_rule(
        source_model.as_deref(),
        provider_hint.as_deref(),
        rule_hint.as_deref(),
        &context.config,
    );
    if let Some(rule) = selected {
        let (resolved_endpoint, resolved_api_key) = resolve_rule_upstream(&rule, &context.config);
        let target_model = rule.target_model_id.clone();
        payload["model"] = Value::String(target_model.clone());
        if let Some(stream_mode) = &rule.stream_mode {
            if stream_mode == "true" {
                payload["stream"] = Value::Bool(true);
            }
            if stream_mode == "false" {
                payload["stream"] = Value::Bool(false);
            }
        }
        let request_stream = payload
            .get("stream")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let request_bytes = serde_json::to_vec(&payload).unwrap_or_default();
        let upstream_url = format!("{}/v1/chat/completions", trim_endpoint(&resolved_endpoint));
        let started = Instant::now();
        let response = forward_request(
            &context.client,
            "POST",
            &upstream_url,
            request_bytes,
            &headers,
            resolved_api_key.as_deref(),
            true,
        )
        .await;
        match response {
            Ok((status, resp_headers, mut bytes)) => {
                push_log(
                    context.diagnostics,
                    "/v1/chat/completions",
                    &rule.name,
                    source_model,
                    Some(target_model),
                    Some(status),
                    None,
                    started.elapsed().as_millis(),
                )
                .await;

                if !request_stream {
                    if let Ok(mut response_json) = serde_json::from_slice::<Value>(&bytes) {
                        if let Some(model) = response_json.get_mut("model") {
                            *model = Value::String(rule.custom_model_id.clone());
                        }
                        if rule.stream_mode.as_deref() == Some("false") {
                            let simulated = simulate_stream(&response_json, &rule.custom_model_id);
                            let mut reply = Response::builder()
                                .status(status)
                                .header("content-type", "text/event-stream");
                            reply = append_response_headers(reply, &resp_headers, true);
                            return reply.body(simulated).unwrap_or_else(|_| {
                                Response::builder().status(500).body(vec![]).unwrap()
                            });
                        }
                        bytes = serde_json::to_vec(&response_json).unwrap_or(bytes);
                    }
                }

                let reply =
                    append_response_headers(Response::builder().status(status), &resp_headers, false);
                reply
                    .body(bytes)
                    .unwrap_or_else(|_| Response::builder().status(500).body(vec![]).unwrap())
            }
            Err(err) => {
                push_log(
                    context.diagnostics,
                    "/v1/chat/completions",
                    &rule.name,
                    source_model,
                    Some(target_model),
                    None,
                    Some(err.to_string()),
                    started.elapsed().as_millis(),
                )
                .await;
                response_json_error(StatusCode::BAD_GATEWAY, err.to_string())
            }
        }
    } else {
        response_json_error(StatusCode::BAD_REQUEST, "未找到可用规则".to_string())
    }
}

async fn forward_request(
    client: &Client,
    method: &str,
    url: &str,
    body: Vec<u8>,
    headers: &warp::http::HeaderMap,
    api_key: Option<&str>,
    force_json: bool,
) -> Result<(u16, ReqHeaderMap, Vec<u8>)> {
    let mut outgoing_headers = ReqHeaderMap::new();
    for (key, value) in headers.iter() {
        if key.as_str().eq_ignore_ascii_case("host") {
            continue;
        }
        if let (Ok(name), Ok(req_value)) = (
            ReqHeaderName::from_bytes(key.as_str().as_bytes()),
            ReqHeaderValue::from_bytes(value.as_bytes()),
        ) {
            outgoing_headers.insert(name, req_value);
        }
    }
    if force_json {
        outgoing_headers.insert(CONTENT_TYPE, ReqHeaderValue::from_static("application/json"));
    }
    if !outgoing_headers.contains_key(AUTHORIZATION) {
        if let Some(token) = api_key {
            let value = token.trim();
            if !value.is_empty() {
                let header_value = format!("Bearer {}", value);
                if let Ok(parsed) = ReqHeaderValue::from_str(&header_value) {
                    outgoing_headers.insert(AUTHORIZATION, parsed);
                }
            }
        }
    }
    let request_builder = if method == "GET" {
        client.get(url)
    } else {
        client.post(url).body(body)
    };
    let response = request_builder.headers(outgoing_headers).send().await?;
    let status = response.status().as_u16();
    let mut response_headers = ReqHeaderMap::new();
    for (key, value) in response.headers().iter() {
        response_headers.insert(key, value.clone());
    }
    let bytes = response.bytes().await?.to_vec();
    Ok((status, response_headers, bytes))
}

fn append_response_headers(
    mut reply: warp::http::response::Builder,
    headers: &ReqHeaderMap,
    skip_content_type: bool,
) -> warp::http::response::Builder {
    for (key, value) in headers.iter() {
        if skip_content_type && key.as_str().eq_ignore_ascii_case("content-type") {
            continue;
        }
        if let (Ok(name), Ok(warp_value)) = (
            WarpHeaderName::from_bytes(key.as_str().as_bytes()),
            WarpHeaderValue::from_bytes(value.as_bytes()),
        ) {
            reply = reply.header(name, warp_value);
        }
    }
    reply
}

fn select_rule(
    model: Option<&str>,
    provider_hint: Option<&str>,
    rule_hint: Option<&str>,
    config: &ProxyConfig,
) -> Option<ProxyApiRule> {
    if config.apis.is_empty() {
        return None;
    }
    if let Some(rule_name) = rule_hint {
        let target = rule_name.trim();
        if !target.is_empty() {
            if let Some(found) = config.apis.iter().find(|api| {
                api.active
                    && api.name.trim() == target
                    && model.map(|m| api.custom_model_id == m).unwrap_or(true)
            }) {
                return Some(found.clone());
            }
        }
    }
    if let Some(model_name) = model {
        if let Some(provider_name) = provider_hint {
            let target_provider = provider_name.trim();
            if !target_provider.is_empty() {
                if let Some(found) = config.apis.iter().find(|api| {
                    api.active
                        && api.custom_model_id == model_name
                        && api.provider.trim() == target_provider
                }) {
                    return Some(found.clone());
                }
            }
        }
        if let Some(found) = config
            .apis
            .iter()
            .find(|api| api.active && api.custom_model_id == model_name)
        {
            return Some(found.clone());
        }
    }
    if let Some(provider_name) = provider_hint {
        let target_provider = provider_name.trim();
        if !target_provider.is_empty() {
            if let Some(found) = config
                .apis
                .iter()
                .find(|api| api.active && api.provider.trim() == target_provider)
            {
                return Some(found.clone());
            }
        }
    }
    if let Some(active) = config.apis.iter().find(|api| api.active) {
        return Some(active.clone());
    }
    config.apis.first().cloned()
}

fn resolve_rule_upstream(rule: &ProxyApiRule, config: &ProxyConfig) -> (String, Option<String>) {
    let provider_name = rule.provider.trim();
    if !provider_name.is_empty() {
        if let Some(provider) = config
            .providers
            .iter()
            .find(|p| p.name == provider_name && p.active)
        {
            let endpoint = if provider.endpoint.trim().is_empty() {
                rule.endpoint.clone()
            } else {
                provider.endpoint.clone()
            };
            let api_key = if provider.api_key.trim().is_empty() {
                rule.api_key.clone()
            } else {
                provider.api_key.clone()
            };
            return (
                endpoint,
                if api_key.trim().is_empty() {
                    None
                } else {
                    Some(api_key)
                },
            );
        }
    }
    (
        rule.endpoint.clone(),
        if rule.api_key.trim().is_empty() {
            None
        } else {
            Some(rule.api_key.clone())
        },
    )
}

fn trim_endpoint(endpoint: &str) -> String {
    endpoint.trim_end_matches('/').to_string()
}

async fn push_log(
    logs: Arc<Mutex<VecDeque<ProxyDiagnosticLog>>>,
    path: &str,
    rule_name: &str,
    source_model: Option<String>,
    target_model: Option<String>,
    upstream_status: Option<u16>,
    error_summary: Option<String>,
    duration_ms: u128,
) {
    let mut guard = logs.lock().await;
    guard.push_front(ProxyDiagnosticLog {
        timestamp: Utc::now().to_rfc3339(),
        path: path.to_string(),
        rule_name: rule_name.to_string(),
        source_model,
        target_model,
        upstream_status,
        duration_ms,
        error_summary,
    });
    while guard.len() > 200 {
        guard.pop_back();
    }
}

fn response_json_error(status: StatusCode, message: String) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(
            serde_json::to_vec(&json!({
                "error": message
            }))
            .unwrap_or_default(),
        )
        .unwrap_or_else(|_| Response::builder().status(500).body(vec![]).unwrap())
}

fn simulate_stream(response_json: &Value, custom_model_id: &str) -> Vec<u8> {
    let mut out = Vec::new();
    let content = response_json
        .get("choices")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|v| v.get("message"))
        .and_then(|v| v.get("content"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    out.extend_from_slice(
        format!(
            "data: {{\"id\":\"chatcmpl-simulated\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"{}\",\"choices\":[{{\"index\":0,\"delta\":{{\"role\":\"assistant\"}},\"finish_reason\":null}}]}}\n\n",
            custom_model_id
        )
        .as_bytes(),
    );
    for chunk in content.as_bytes().chunks(4) {
        let chunk_text = String::from_utf8_lossy(chunk).replace('"', "\\\"");
        out.extend_from_slice(
            format!(
                "data: {{\"id\":\"chatcmpl-simulated\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"{}\",\"choices\":[{{\"index\":0,\"delta\":{{\"content\":\"{}\"}},\"finish_reason\":null}}]}}\n\n",
                custom_model_id, chunk_text
            )
            .as_bytes(),
        );
    }
    out.extend_from_slice(
        format!(
            "data: {{\"id\":\"chatcmpl-simulated\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"{}\",\"choices\":[{{\"index\":0,\"delta\":{{}},\"finish_reason\":\"stop\"}}]}}\n\n",
            custom_model_id
        )
        .as_bytes(),
    );
    out.extend_from_slice(b"data: [DONE]\n\n");
    out
}

fn resolve_proxy_config_path() -> Result<PathBuf> {
    let cwd = std::env::current_dir()?;
    let project_root = if cwd
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("src-tauri"))
        .unwrap_or(false)
    {
        cwd.parent().map(PathBuf::from).unwrap_or(cwd)
    } else {
        cwd
    };
    let config_dir = project_root.join("config");
    fs::create_dir_all(&config_dir)?;
    Ok(config_dir.join("proxy_config.json"))
}

fn resolve_relative_path(path: &str) -> PathBuf {
    let input = PathBuf::from(path);
    if input.is_absolute() {
        input
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(input)
    }
}

fn load_proxy_config_with_migration(path: &Path) -> Result<ProxyConfig> {
    if !path.exists() {
        let config = ProxyConfig::default();
        persist_proxy_config(path, &config)?;
        return Ok(config);
    }
    let content = fs::read_to_string(path)?;
    if content.trim().is_empty() {
        let config = ProxyConfig::default();
        persist_proxy_config(path, &config)?;
        return Ok(config);
    }
    let value: Value = serde_json::from_str(&content)?;
    let config = migrate_config(value);
    persist_proxy_config(path, &config)?;
    Ok(config)
}

fn migrate_config(value: Value) -> ProxyConfig {
    let mut config = ProxyConfig::default();
    if let Some(domain) = value.get("domain").and_then(|v| v.as_str()) {
        config.domain = domain.to_string();
    }
    config.mode = "transparent".to_string();
    if let Some(server) = value.get("server").and_then(|v| v.as_object()) {
        if let Some(port) = server.get("port").and_then(|v| v.as_u64()) {
            config.server.port = port as u16;
        }
        if let Some(debug) = server.get("debug").and_then(|v| v.as_bool()) {
            config.server.debug = debug;
        }
    }
    if let Some(apis) = value.get("apis").and_then(|v| v.as_array()) {
        let mut parsed = Vec::new();
        for item in apis {
            let mut rule = ProxyApiRule::default();
            if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                rule.name = name.to_string();
            }
            if let Some(endpoint) = item.get("endpoint").and_then(|v| v.as_str()) {
                rule.endpoint = endpoint.to_string();
            }
            if let Some(provider) = item.get("provider").and_then(|v| v.as_str()) {
                rule.provider = provider.to_string();
            }
            if let Some(api_key) = item.get("api_key").and_then(|v| v.as_str()) {
                rule.api_key = api_key.to_string();
            }
            if let Some(custom_model_id) = item.get("custom_model_id").and_then(|v| v.as_str()) {
                rule.custom_model_id = custom_model_id.to_string();
            }
            if let Some(target_model_id) = item.get("target_model_id").and_then(|v| v.as_str()) {
                rule.target_model_id = target_model_id.to_string();
            }
            if let Some(stream_mode) = item.get("stream_mode") {
                rule.stream_mode = if stream_mode.is_null() {
                    None
                } else {
                    stream_mode.as_str().map(|s| s.to_string())
                };
            }
            if let Some(active) = item.get("active").and_then(|v| v.as_bool()) {
                rule.active = active;
            }
            if !rule.name.trim().is_empty()
                || !rule.custom_model_id.trim().is_empty()
                || !rule.target_model_id.trim().is_empty()
                || !rule.provider.trim().is_empty()
                || !rule.endpoint.trim().is_empty()
                || !rule.api_key.trim().is_empty()
            {
                parsed.push(rule);
            }
        }
        config.apis = parsed;
    }
    if let Some(providers) = value.get("providers").and_then(|v| v.as_array()) {
        let mut parsed = Vec::new();
        for item in providers {
            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("").trim();
            if name.is_empty() {
                continue;
            }
            let endpoint = item
                .get("endpoint")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let api_key = item
                .get("api_key")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let active = item
                .get("active")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            parsed.push(ProxyProviderConfig {
                name: name.to_string(),
                endpoint,
                api_key,
                active,
            });
        }
        config.providers = parsed;
    }
    if let Some(cert) = value.get("cert").and_then(|v| v.as_object()) {
        if let Some(domain) = cert.get("domain").and_then(|v| v.as_str()) {
            config.cert.domain = domain.to_string();
        }
        if let Some(ca_cert_path) = cert.get("ca_cert_path").and_then(|v| v.as_str()) {
            config.cert.ca_cert_path = ca_cert_path.to_string();
        }
        if let Some(cert_path) = cert.get("cert_path").and_then(|v| v.as_str()) {
            config.cert.cert_path = cert_path.to_string();
        }
        if let Some(key_path) = cert.get("key_path").and_then(|v| v.as_str()) {
            config.cert.key_path = key_path.to_string();
        }
        if let Some(installed) = cert.get("installed").and_then(|v| v.as_bool()) {
            config.cert.installed = installed;
        }
    }
    if config.cert.domain.trim().is_empty() {
        config.cert.domain = config.domain.clone();
    }
    config
}

fn persist_proxy_config(path: &Path, config: &ProxyConfig) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(config)?;
    fs::write(path, content)?;
    Ok(())
}

fn copy_existing_cert_assets(
    domain: &str,
    ca_target: &Path,
    cert_target: &Path,
    key_target: &Path,
) -> Result<()> {
    let source_dirs = collect_cert_source_dirs()?;
    let mut selected: Option<(PathBuf, PathBuf, PathBuf)> = None;
    for source_dir in source_dirs {
        if !source_dir.exists() {
            continue;
        }
        let source_ca_candidates = [
            source_dir.join("trae-proxy-ca.crt"),
            source_dir.join("ca.crt"),
            source_dir.join(format!("{}.crt", domain)),
        ];
        let source_cert_candidates = [
            source_dir.join(format!("{}.crt", domain)),
            source_dir.join("api.openai.com.crt"),
        ];
        let source_key_candidates = [
            source_dir.join(format!("{}.key", domain)),
            source_dir.join("api.openai.com.key"),
            source_dir.join("ca.key"),
        ];
        let source_ca = source_ca_candidates.iter().find(|path| path.exists()).cloned();
        let source_cert = source_cert_candidates.iter().find(|path| path.exists()).cloned();
        let source_key = source_key_candidates.iter().find(|path| path.exists()).cloned();
        if let (Some(ca), Some(cert), Some(key)) = (source_ca, source_cert, source_key) {
            selected = Some((ca, cert, key));
            break;
        }
    }
    let (source_ca, source_cert, source_key) =
        selected.ok_or_else(|| anyhow!("未找到可复用证书文件"))?;
    if let Some(parent) = ca_target.parent() {
        fs::create_dir_all(parent)?;
    }
    if let Some(parent) = cert_target.parent() {
        fs::create_dir_all(parent)?;
    }
    if let Some(parent) = key_target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(source_ca, ca_target)?;
    fs::copy(source_cert, cert_target)?;
    fs::copy(source_key, key_target)?;
    Ok(())
}

fn collect_cert_source_dirs() -> Result<Vec<PathBuf>> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd.join("ca"));
        dirs.push(cwd.join("resources").join("Trae-Proxy").join("ca"));
        dirs.push(cwd.join("src-tauri").join("resources").join("Trae-Proxy").join("ca"));
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    dirs.push(manifest_dir.join("resources").join("Trae-Proxy").join("ca"));
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            dirs.push(exe_dir.join("resources").join("Trae-Proxy").join("ca"));
        }
    }
    let mut unique: Vec<PathBuf> = Vec::new();
    for dir in dirs {
        if !unique.iter().any(|p| p == &dir) {
            unique.push(dir);
        }
    }
    Ok(unique)
}

#[cfg(test)]
mod tests {
    use super::{migrate_config, select_rule, ProxyApiRule, ProxyConfig};
    use serde_json::json;

    #[test]
    fn test_rule_select_order() {
        let mut config = ProxyConfig::default();
        config.apis = vec![
            ProxyApiRule {
                name: "first".to_string(),
                provider: "OpenAI".to_string(),
                endpoint: "https://a.example.com".to_string(),
                custom_model_id: "gpt-4".to_string(),
                target_model_id: "a-model".to_string(),
                stream_mode: None,
                active: false,
                api_key: String::new(),
            },
            ProxyApiRule {
                name: "second".to_string(),
                provider: "OpenAI".to_string(),
                endpoint: "https://b.example.com".to_string(),
                custom_model_id: "gpt-5".to_string(),
                target_model_id: "b-model".to_string(),
                stream_mode: None,
                active: true,
                api_key: String::new(),
            },
        ];
        let exact = select_rule(Some("gpt-5"), None, None, &config).unwrap();
        assert_eq!(exact.name, "second");
        let active = select_rule(Some("no-hit"), None, None, &config).unwrap();
        assert_eq!(active.name, "second");
    }

    #[test]
    fn test_config_migration() {
        let value = json!({
            "domain": "api.openai.com",
            "server": {
                "port": 443,
                "debug": true
            },
            "apis": [
                {
                    "name": "demo",
                    "endpoint": "https://example.com",
                    "custom_model_id": "gpt-4",
                    "target_model_id": "deepseek-chat",
                    "stream_mode": "false",
                    "active": true
                }
            ]
        });
        let config = migrate_config(value);
        assert_eq!(config.server.port, 443);
        assert_eq!(config.apis[0].name, "demo");
        assert_eq!(config.mode, "transparent");
    }
}
