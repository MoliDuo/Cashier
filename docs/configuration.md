# 配置参考

本地开发从 `.env.local.example` 开始；Vercel 部署的环境变量从 `.env.example` 参考填写。
空字符串会被当作未配置，除非下面另有说明。

账号、账本和分账都不在环境变量里：空库首次启动时，服务端会打印一次性初始化代码，
在 `/setup` 向导中填入代码、邮箱、密码和分账名称即可创建。

## 应用与 AI

| 变量              | 必需 | 默认值                      | 说明                           |
| ----------------- | ---- | --------------------------- | ------------------------------ |
| `APP_URL`         | 否   | `http://localhost:3000`     | 用户访问 Cashier 的公开地址。  |
| `OPENAI_API_KEY`  | 是   | 无                          | OpenAI 或兼容服务的 API 密钥。 |
| `OPENAI_BASE_URL` | 否   | `https://api.openai.com/v1` | OpenAI 兼容 API 根地址。       |
| `AI_MODEL`        | 否   | `gpt-4o`                    | 用于票据解析和分类的模型名。   |
| `TZ`              | 否   | `Asia/Shanghai`             | 服务端默认时区。               |

## PostgreSQL

| 变量                | 必需 | 默认值 | 说明                                           |
| ------------------- | ---- | ------ | ---------------------------------------------- |
| `DATABASE_URL`      | 是   | 无     | 必须是 `postgres://` 或 `postgresql://` 地址。 |
| `DATABASE_POOL_MAX` | 否   | `2`    | 连接池上限，范围 1–50。                        |

`.env.local.example` 提供指向 `docker-compose.local.yml` 中 PostgreSQL 的 `DATABASE_URL`。

## S3 / Cloudflare R2

| 变量                   | 必需       | 默认值        | 说明                                   |
| ---------------------- | ---------- | ------------- | -------------------------------------- |
| `S3_ENDPOINT`          | 是         | 无            | 服务端访问的 S3 兼容端点。             |
| `S3_PUBLIC_ENDPOINT`   | 视部署而定 | `S3_ENDPOINT` | 浏览器直传时可访问的端点。             |
| `S3_REGION`            | 否         | `auto`        | R2 使用 `auto`；其他服务按供应商配置。 |
| `S3_BUCKET`            | 是         | 无            | 已经存在的私有存储桶名称。             |
| `S3_ACCESS_KEY_ID`     | 是         | 无            | S3 访问密钥 ID。                       |
| `S3_SECRET_ACCESS_KEY` | 是         | 无            | S3 访问密钥。                          |
| `S3_FORCE_PATH_STYLE`  | 否         | `false`       | MinIO 等服务通常需要设为 `true`。      |

`npm run docker:local` 会启动 MinIO 并自动创建 `cashier` 桶。

## 认证与内部密钥

| 变量              | 必需   | 默认值                          | 说明                                                             |
| ----------------- | ------ | ------------------------------- | ---------------------------------------------------------------- |
| `AUTH_SECRET`     | 运行时 | 本地模板提供                    | Auth.js 会话签名密钥。                                           |
| `API_KEY_PEPPER`  | 运行时 | 本地模板提供                    | 服务凭证哈希使用的 pepper。                                      |
| `AUTH_OTP_PEPPER` | 运行时 | 本地模板提供                    | 邮箱验证码哈希使用的 pepper。                                    |
| `CRON_SECRET`     | 部署   | 无                              | 每日 cron 的调用密钥，至少 32 个字符；未设置时 cron 拒绝运行。   |
| `AUTH_RESEND_KEY` | 否     | 无                              | 配置后启用 Resend 邮箱验证码登录和添加登录邮箱。                 |
| `AUTH_EMAIL_FROM` | 否     | `Cashier <noreply@example.com>` | 邮箱验证码的发件人。                                             |
| `DEV_AUTH_BYPASS` | 否     | `false`                         | 仅测试环境，或 `APP_URL` 指向 loopback 的 development 环境可用。 |

`.env.local.example` 内置公开的固定开发值，复制后可直接运行本地源码；这些值不能用于
可被外部访问的部署。Vercel 部署必须自行提供安全随机值，并保证重启、预览实例和多实例
之间保持一致。

## 调参常量

重试次数、超时、限流额度、图片质量、恢复批量这些数字不再是环境变量，它们在
`src/config/tuning.ts` 里，改一个数字然后部署即可。

当前图片策略固定为 16 MP 业务校验上限，以及 24 MP Sharp 解码保护上限。

批量分类的并发按原始账单计算，不是用户可选择的明细数量上限。同一账单每次 AI 请求最多
包含 50 条已选明细；选择上传以 1,000 条为一个传输分段。

## 可信入口

| 变量            | 默认值 | 说明                                                                                                                |
| --------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `TRUSTED_PROXY` | 无     | 可选值仅为 `platform`。Vercel 读取单值 `X-Vercel-Forwarded-For`；自建反向代理读取由可信入口覆盖的单值 `X-Real-IP`。 |

未配置可信入口，或平台头为空、多值、非法时，地址会归入固定的哈希 `unknown` 桶，认证前限流仍然生效。

## 日志与端口

| 变量        | 默认值 | 说明                    |
| ----------- | ------ | ----------------------- |
| `LOG_LEVEL` | `info` | 应用日志级别。          |
| `S3_PORT`   | `9000` | 本地 MinIO 暴露的端口。 |

不要在日志、Issue 或截图中公开 `.env`、Bearer Token、内部密钥、邮箱验证码或原始票据。

## 本地 Demo 工作区

`npm run dev:demo` 使用独立的 `docker-compose.demo.yml` 启动 `cashier-demo` Compose project、
`cashier_demo` 数据库和本地 MinIO，不依赖项目 `.env`。它会强制覆盖数据库、对象存储、认证和
AI 连接变量，因此不会读取 `.env.local` 中的远程服务地址。Demo 数据为固定的虚构票据和完整
账本结果，不会调用真实 AI 或邮件服务。每次运行 `npm run dev:demo` 都会先输出重建目标，再将
专用工作区恢复为初始 fixture；上一次运行中产生的修改不会保留。

默认端口为应用 `3000`、PostgreSQL `55433`、MinIO `59000`，可分别通过
`CASHIER_DEMO_APP_PORT`、`CASHIER_DEMO_POSTGRES_PORT`、`CASHIER_DEMO_S3_PORT` 覆盖。
`npm run demo:reset` 只预览目标；`npm run demo:reset -- --apply` 才会重建
`dev@cashier.local` 的专用数据。
