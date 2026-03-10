# Trae Account Manager

<div align="center">

![Trae Account Manager](https://img.shields.io/badge/Trae-Account%20Manager-blue?style=for-the-badge)
![Version](https://img.shields.io/badge/version-1.0.0-green?style=for-the-badge)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-orange?style=for-the-badge)

**面向 Trae IDE 的多账号与自定义模型代理管理工具**

[功能概览](#-功能概览) • [快速开始](#-快速开始) • [使用指南](#-使用指南) • [自定义模型代理](#-自定义模型代理) • [安全提示](#-安全提示) • [贡献](#-贡献)

</div>

---

## 重要风险提示（必读）

> **本工具仅供学习与技术研究使用，使用前请务必了解以下内容：**
>
> - **风险自负**：使用者需自行承担系统损坏、数据丢失、账号异常等风险  
> - **法律风险**：请自行评估并遵守软件协议与相关法律法规  
> - **责任豁免**：作者不承担任何直接或间接损失  
> - **使用限制**：仅限个人学习研究，严禁商业用途  
> - **授权声明**：不得用于绕过软件正当授权机制  
> - **同意条款**：继续使用即表示您已理解并同意承担相应风险

---

## 项目简介

Trae Account Manager 是一款专为 Trae IDE 用户打造的多账号管理工具，提供账号切换、使用量监控、机器码管理与数据导入导出，同时内置自定义模型代理管理能力，覆盖从账号到模型代理的完整流程。

---

## 功能概览

### 账号管理

- **添加与更新账号**：通过 Token 添加与更新账号信息
- **账号切换**：自动关闭 Trae IDE、写入新账号信息并重新打开
- **账号详情**：查看邮箱、头像、套餐类型、创建时间与状态
- **快捷操作**：复制账号信息、删除账号、查看详情

### 使用量监控

- **使用量概览**：今日/总量/剩余使用量一览
- **使用记录**：按时间范围查看使用事件与模型信息

### 机器码管理

- **机器码查看与刷新**：查看与复制 Trae IDE 机器码
- **清除登录状态**：重置登录状态并恢复为干净环境

### 数据管理

- **导入导出**：支持 JSON 账号数据导入导出
- **数据保护提示**：导入导出前弹出安全说明

### 自定义模型代理

- **服务管理**：代理端口、域名配置与启动/停止
- **证书管理**：生成、安装、卸载证书并查看状态
- **厂商管理**：维护上游厂商地址与 API Key
- **规则管理**：自定义模型映射与流模式控制
- **请求测试**：快速测试模型与接口可用性

---

## 快速开始

### 系统要求

- Windows 10/11
- Trae IDE 已安装
- Node.js 16+

### 从源码构建

```bash
# 安装依赖
npm install

# 前端开发（仅 Web）
npm run dev

# 桌面开发（Tauri）
npm run tauri dev

# 构建前端
npm run build

# 构建桌面应用
npm run tauri build
```

---

## 使用指南

### 1. 配置 Trae IDE 路径

1. 打开应用后进入 **设置**
2. 点击 **自动扫描** 或 **手动设置** 选择 `Trae.exe`
3. 保存后即可完成路径配置

### 2. 添加与切换账号

1. 点击 **添加账号** 输入 Token
2. 系统自动拉取账号信息并绑定机器码
3. 切换账号时自动清理旧状态并重启 Trae IDE

### 3. 查看使用量与使用记录

1. 在仪表板查看今日/总量/剩余使用量
2. 在账号详情中查看使用记录与模型信息

### 4. 导入导出数据

1. 设置页进入 **数据管理**
2. 使用导出/导入按钮完成数据迁移

---

## 自定义模型代理

自定义模型代理用于将 Trae IDE 的 OpenAI 请求转发到自定义后端模型服务，并在本地进行证书与规则管理。

### 使用流程

1. **服务管理**：设置端口与域名，保存配置
2. **证书管理**：生成并安装证书，确保系统信任
3. **厂商管理**：添加上游地址与 API Key
4. **规则管理**：为模型配置映射规则与流模式
5. **测试请求**：测试 `/v1/chat/completions` 或 `/v1/models`
6. **IDE 配置**：在 Trae IDE 中选择 OpenAI 服务商并填写模型 ID

---

## 安全提示

- 账号 Token 与 Cookies 属于敏感信息，请勿外泄
- 导出数据包含敏感字段，建议加密保存
- 证书与密钥文件仅用于本地代理信任，不应提交到仓库

---

## 技术栈

### 前端

- React 19
- TypeScript
- Vite 7

### 后端

- Tauri 2
- Rust

---

## 项目结构

```
Trae-Account-Manager/
├── src/                      # 前端源码
│   ├── components/           # UI 组件
│   ├── pages/                # 页面组件
│   │   ├── Dashboard.tsx
│   │   ├── Settings.tsx
│   │   ├── CustomModelProxy.tsx
│   │   └── About.tsx
│   ├── api.ts                # API 调用
│   └── types/                # TypeScript 类型
├── src-tauri/                # Tauri 后端
│   ├── src/                  # Rust 逻辑
│   ├── resources/            # 代理与脚本资源
│   └── tauri.conf.json
└── README.md
```

---

## 免责声明

> **本工具仅供学习和技术研究使用，使用前请务必了解以下内容：**

- **风险自负**：使用者需自行承担所有风险
- **法律风险**：请遵守相关软件协议与法律法规
- **责任豁免**：作者不承担任何直接或间接损失
- **使用限制**：仅限个人学习研究，严禁商业用途
- **授权声明**：不得用于绕过软件正当授权机制
- **同意条款**：继续使用即表示您已理解并同意承担相应风险

---

## 贡献

欢迎贡献代码、报告问题或提出建议！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送分支 (`git push origin feature/AmazingFeature`)
5. 提交 Pull Request

---

##  许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 了解详情

---

## 联系方式

- GitHub: [@Yang-505](https://github.com/Yang-505)
- Issues: [项目 Issues](https://github.com/Yang-505/Trae-Account-Manager/issues)
