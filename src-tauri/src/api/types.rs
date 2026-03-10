use serde::{Deserialize, Serialize};

/// JWT Token 解析后的原始数据
#[derive(Debug, Clone, Deserialize)]
pub struct JwtPayloadRaw {
    pub data: JwtData,
    pub exp: i64,
    pub iat: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JwtData {
    pub id: String,
    pub source: String,
    pub source_id: String,
    pub tenant_id: String,
    #[serde(rename = "type")]
    pub data_type: String,
}

/// JWT Token 解析后的用户信息
#[derive(Debug, Clone)]
pub struct JwtPayload {
    pub user_id: String,
    pub tenant_id: String,
}

/// 通过 Token 获取的用户信息
#[derive(Debug, Clone)]
pub struct TokenUserInfo {
    pub user_id: String,
    pub tenant_id: String,
    pub screen_name: Option<String>,
    pub avatar_url: Option<String>,
    pub email: Option<String>,
}

/// 用户 Token 响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetUserTokenResponse {
    #[serde(rename = "ResponseMetadata")]
    pub response_metadata: ResponseMetadata,
    #[serde(rename = "Result")]
    pub result: UserTokenResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseMetadata {
    #[serde(rename = "RequestId")]
    pub request_id: String,
    #[serde(rename = "TraceID")]
    pub trace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserTokenResult {
    #[serde(rename = "Token")]
    pub token: String,
    #[serde(rename = "ExpiredAt")]
    pub expired_at: String,
    #[serde(rename = "UserID")]
    pub user_id: String,
    #[serde(rename = "TenantID")]
    pub tenant_id: String,
}

/// 用户信息响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetUserInfoResponse {
    #[serde(rename = "ResponseMetadata")]
    pub response_metadata: ResponseMetadata,
    #[serde(rename = "Result")]
    pub result: UserInfoResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfoResult {
    #[serde(rename = "ScreenName")]
    pub screen_name: String,
    #[serde(rename = "Gender")]
    pub gender: String,
    #[serde(rename = "AvatarUrl")]
    pub avatar_url: String,
    #[serde(rename = "UserID")]
    pub user_id: String,
    #[serde(rename = "Description")]
    pub description: String,
    #[serde(rename = "TenantID")]
    pub tenant_id: String,
    #[serde(rename = "RegisterTime")]
    pub register_time: String,
    #[serde(rename = "LastLoginTime")]
    pub last_login_time: String,
    #[serde(rename = "LastLoginType")]
    pub last_login_type: String,
    #[serde(rename = "Region")]
    pub region: String,
    #[serde(rename = "AIRegion")]
    pub ai_region: Option<String>,
    #[serde(rename = "NonPlainTextEmail")]
    pub non_plain_text_email: Option<String>,
    #[serde(rename = "StoreCountry")]
    pub store_country: Option<String>,
}

/// 用户配额/使用量响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntitlementListResponse {
    pub is_pay_freshman: bool,
    pub user_entitlement_pack_list: Vec<EntitlementPack>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntitlementPack {
    pub entitlement_base_info: EntitlementBaseInfo,
    pub expire_time: i64,
    pub is_last_period: bool,
    pub next_billing_time: i64,
    pub source_id: String,
    pub status: i32,
    pub usage: UsageInfo,
    pub yearly_expire_time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntitlementBaseInfo {
    pub charge_amount: i64,
    pub currency: i32,
    pub end_time: i64,
    pub entitlement_id: String,
    pub product_extra: ProductExtra,
    pub product_id: i32,
    pub product_type: i32,
    pub quota: Quota,
    pub start_time: i64,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductExtra {
    #[serde(default)]
    pub package_extra: Option<PackageExtra>,
    #[serde(default)]
    pub subscription_extra: Option<SubscriptionExtra>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageExtra {
    pub duration: i32,
    pub package_duration_type: i32,
    pub package_source_type: i32,
    pub quota: Quota,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionExtra {
    pub period_type: i32,
    pub quota: Quota,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quota {
    #[serde(default)]
    pub advanced_model_request_limit: i64,
    #[serde(default)]
    pub auto_completion_limit: i64,
    #[serde(default)]
    pub enable_solo_builder: bool,
    #[serde(default)]
    pub enable_solo_builder_v1: bool,
    #[serde(default)]
    pub enable_solo_coder: bool,
    #[serde(default)]
    pub enable_super_model: bool,
    #[serde(default)]
    pub premium_model_fast_request_limit: i64,
    #[serde(default)]
    pub premium_model_slow_request_limit: i64,
    #[serde(default)]
    pub basic_usage_limit: f64,
    #[serde(default)]
    pub bonus_usage_limit: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageInfo {
    #[serde(default)]
    pub advanced_model_amount: f64,
    #[serde(default)]
    pub advanced_model_request_usage: f64,
    #[serde(default)]
    pub auto_completion_amount: f64,
    #[serde(default)]
    pub auto_completion_usage: f64,
    #[serde(default)]
    pub is_flash_consuming: bool,
    #[serde(default)]
    pub premium_model_fast_amount: f64,
    #[serde(default)]
    pub premium_model_fast_request_usage: f64,
    #[serde(default)]
    pub premium_model_slow_amount: f64,
    #[serde(default)]
    pub premium_model_slow_request_usage: f64,
    #[serde(default)]
    pub basic_usage_amount: f64,
    #[serde(default)]
    pub bonus_usage_amount: f64,
}

/// 使用记录查询响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageQueryResponse {
    pub total: i64,
    pub user_usage_group_by_sessions: Vec<UsageSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSession {
    pub session_id: String,
    pub usage_time: i64,
    pub mode: String,
    pub model_name: String,
    pub amount_float: f64,
    pub cost_money_float: f64,
    pub use_max_mode: bool,
    pub product_type_list: Vec<i32>,
    pub extra_info: UsageExtraInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageExtraInfo {
    pub cache_read_token: i64,
    pub cache_write_token: i64,
    pub input_token: i64,
    pub output_token: i64,
}

/// 简化的使用量汇总（用于前端展示）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSummary {
    pub plan_type: String,
    pub reset_time: i64,
    pub extra_package_name: String,
    pub extra_expire_time: i64,
    pub basic_usage_used: f64,
    pub basic_usage_limit: f64,
    pub basic_usage_left: f64,
    pub bonus_usage_used: f64,
    pub bonus_usage_limit: f64,
    pub bonus_usage_left: f64,
    pub total_usage_used: f64,
    pub total_usage_limit: f64,
    pub total_usage_left: f64,
}

impl Default for UsageSummary {
    fn default() -> Self {
        Self {
            plan_type: "Free".to_string(),
            reset_time: 0,
            extra_package_name: String::new(),
            extra_expire_time: 0,
            basic_usage_used: 0.0,
            basic_usage_limit: 10.0,
            basic_usage_left: 10.0,
            bonus_usage_used: 0.0,
            bonus_usage_limit: 0.0,
            bonus_usage_left: 0.0,
            total_usage_used: 0.0,
            total_usage_limit: 10.0,
            total_usage_left: 10.0,
        }
    }
}
