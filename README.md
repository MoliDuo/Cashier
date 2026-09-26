# Cashier

> 把小票、发票和一句话，变成可核对的个人账本。

[![CI/CD](https://github.com/Xiangyu-Labs/Cashier/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/Xiangyu-Labs/Cashier/actions/workflows/ci-cd.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)

![Cashier 流水页面](./public/readme/stream-desktop.webp)

Cashier 最初只是我给自己做的记账工具：拍下小票，或者随手写一句“午饭 35 元”，剩下的整理工作交给 AI。
它是为实际在用的两个人写的。以 AGPL 发布，是为了让想要它的人可以 fork 过去改成自己的样子，而不是要把它
改得适合所有人。欢迎报告 bug；功能请求多半会得到"fork 吧，那样更适合你"的回答。

Cashier 会从图片或文字中提取日期、商家、金额、币种、分类和消费明细。AI 的结果不是不可触碰的黑盒：
你可以在入账前后检查、修改、重试，并在流水、明细和统计中继续管理这些记录。

## 它能做什么

- 上传小票、发票图片，或直接输入自然语言记账
- 提取账单标题、日期、金额、币种、分类和明细
- 复核和编辑 AI 结果，处理识别失败的账单
- 管理多币种消费，并按账本主币种查看汇总
- 从流水、筛选明细和统计图表回看支出
- 创建账本级 API 密钥，供脚本、快捷指令和外部集成使用（见 [API v1](./docs/api.md)）
- 中文界面；AI 可以按设置用其他语言填写账单内容

<picture>
  <source media="(max-width: 600px)" srcset="./public/readme/entry-mobile.webp">
  <img alt="Cashier 智能记账界面" src="./public/readme/entry-mobile.webp" width="390">
</picture>

## 使用前请知道

> **项目状态：早期公开版本**

- 这个项目源于个人使用，还没有正式稳定版或兼容性承诺。
- AI 可能误读票据或错误分类，重要账目请在入账后人工复核。
- 升级前请备份 PostgreSQL 数据库和对象存储。
- AI 解析需要联网，并依赖可用的 OpenAI 或 OpenAI 兼容接口。
- Cashier 是记账工具，不提供会计、税务或财务建议。

## 快速开始

需要 Node.js 24 和 Docker。

### Demo 工作区

最快的试用方式，不碰你的任何东西：不需要远程数据库、对象存储、邮件、AI 密钥，也不读项目的 `.env`。

```bash
npm ci
npm run dev:demo
```

打开终端打印的本地地址，选择 `Continue as dev`。启动信息里列出了预置的示例 API 密钥，每个都标注了
它写入的分账。`docker-compose.demo.yml` 启动专用的 `cashier-demo` PostgreSQL 和 MinIO，迁移
`cashier_demo` 数据库，并写入虚构的票据和历史；AI 和邮件由本地假服务代替。每次启动都会先打印重建目标，
再把工作区恢复成初始数据，上一次的修改不会保留。

```bash
npm run demo:reset            # 只预览目标
npm run demo:reset -- --apply # 重建 dev@cashier.local 的专用数据
```

默认端口为应用 `3000`、PostgreSQL `55433`、MinIO `59000`，可用 `CASHIER_DEMO_APP_PORT`、
`CASHIER_DEMO_POSTGRES_PORT`、`CASHIER_DEMO_S3_PORT` 覆盖。

### 连接真实服务

```bash
git clone https://github.com/Xiangyu-Labs/Cashier.git
cd Cashier
npm ci
cp .env.local.example .env
```

编辑 `.env`，填入 AI 密钥（`OPENAI_API_KEY`）。然后启动 PostgreSQL、MinIO 和应用：

```bash
npm run docker:local
npm run db:migrate
npm run dev
```

账号、账本和分账不在环境变量或网页向导里配置，而是用本地命令创建：

```bash
npm run account:create -- --email you@example.com
npm run account:enroll -- --email you@example.com
```

- `account:create` 在一个事务里创建账号、已验证的登录邮箱、账本、分账（默认 `共同支出`，可用 `--book`
  多次指定）和默认分类；已有账号或邮箱已被使用时拒绝执行。
- `account:enroll` 只在终端打印 `APP_URL/enroll?token=…`。链接 30 分钟内有效、只能用一次，重新运行会作废
  之前的链接；库里只存令牌的 HMAC。在浏览器打开它创建通行密钥（passkey），随即登录。

账号没有密码。通行密钥是主要登录方式，邮件验证码（需要 `AUTH_RESEND_KEY`）是备用方式。通行密钥全部丢失、
邮箱也收不到验证码时，再运行一次 `account:enroll` 即可找回。

两个命令读取 `DATABASE_URL`、`AUTH_SECRET` 和 `APP_URL`（环境变量，或项目根目录的 `.env.local` / `.env`）。

不要提交 `.env`、服务商凭证、真实票据、API 密钥或原始个人数据。

## 配置

本地开发从 `.env.local.example` 开始；Vercel 部署从 `.env.example` 参考填写。空字符串视为未配置。

### 应用与 AI

| 变量              | 必需 | 默认值                      | 说明                           |
| ----------------- | ---- | --------------------------- | ------------------------------ |
| `APP_URL`         | 否   | `http://localhost:3000`     | 用户访问 Cashier 的公开地址。  |
| `OPENAI_API_KEY`  | 是   | 无                          | OpenAI 或兼容服务的 API 密钥。 |
| `OPENAI_BASE_URL` | 否   | `https://api.openai.com/v1` | OpenAI 兼容 API 根地址。       |
| `AI_MODEL`        | 否   | `gpt-4o`                    | 用于票据解析和分类的模型名。   |
| `TZ`              | 否   | `Asia/Shanghai`             | 服务端默认时区。               |

使用其他 OpenAI 兼容服务时，同时修改 `OPENAI_BASE_URL` 和 `AI_MODEL`。

### PostgreSQL

| 变量                | 必需 | 默认值 | 说明                                           |
| ------------------- | ---- | ------ | ---------------------------------------------- |
| `DATABASE_URL`      | 是   | 无     | 必须是 `postgres://` 或 `postgresql://` 地址。 |
| `DATABASE_POOL_MAX` | 否   | `2`    | 连接池上限，范围 1–50。                        |

### S3 / Cloudflare R2

| 变量                   | 必需       | 默认值        | 说明                                   |
| ---------------------- | ---------- | ------------- | -------------------------------------- |
| `S3_ENDPOINT`          | 是         | 无            | 服务端访问的 S3 兼容端点。             |
| `S3_PUBLIC_ENDPOINT`   | 视部署而定 | `S3_ENDPOINT` | 浏览器直传时可访问的端点。             |
| `S3_REGION`            | 否         | `auto`        | R2 使用 `auto`；其他服务按供应商配置。 |
| `S3_BUCKET`            | 是         | 无            | 已经存在的私有存储桶名称。             |
| `S3_ACCESS_KEY_ID`     | 是         | 无            | S3 访问密钥 ID。                       |
| `S3_SECRET_ACCESS_KEY` | 是         | 无            | S3 访问密钥。                          |
| `S3_FORCE_PATH_STYLE`  | 否         | `false`       | MinIO 等服务通常需要设为 `true`。      |

### 认证与内部密钥

| 变量              | 必需   | 默认值                          | 说明                                                             |
| ----------------- | ------ | ------------------------------- | ---------------------------------------------------------------- |
| `AUTH_SECRET`     | 运行时 | 本地模板提供                    | 唯一的内部密钥，会话、验证码、限流、API key 的密钥都由它派生。   |
| `CRON_SECRET`     | 部署   | 无                              | 每日 cron 的调用密钥，至少 32 个字符；未设置时 cron 拒绝运行。   |
| `AUTH_RESEND_KEY` | 否     | 无                              | 配置后启用 Resend 邮箱验证码登录和添加登录邮箱。                 |
| `AUTH_EMAIL_FROM` | 否     | `Cashier <noreply@example.com>` | 邮箱验证码的发件人。                                             |
| `DEV_AUTH_BYPASS` | 否     | `false`                         | 仅测试环境，或 `APP_URL` 指向 loopback 的 development 环境可用。 |

`.env.local.example` 里的内部密钥是公开的固定开发值，只用于 loopback 环境复制后立即启动，
不能用于可被外部访问的部署。

### 可信入口、日志与端口

| 变量            | 默认值 | 说明                                                                                                                |
| --------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `TRUSTED_PROXY` | 无     | 可选值仅为 `platform`。Vercel 读取单值 `X-Vercel-Forwarded-For`；自建反向代理读取由可信入口覆盖的单值 `X-Real-IP`。 |
| `LOG_LEVEL`     | `info` | 应用日志级别。                                                                                                      |
| `S3_PORT`       | `9000` | 本地 MinIO 暴露的端口。                                                                                             |

未配置可信入口，或平台头为空、多值、非法时，地址会归入固定的哈希 `unknown` 桶，认证前限流仍然生效。

### 调参常量

重试次数、超时、限流额度、图片质量、恢复批量这些数字不是环境变量，它们在 `src/config/tuning.ts` 里，
改一个数字然后部署即可。图片上限为 16 MP 业务校验和 24 MP sharp 解码保护。批量分类一次最多提交 5,000 条
明细，每个账本同时只跑一个任务，同一账单每次 AI 请求最多包含 50 条明细。

## 部署到 Vercel

生产环境部署在 Vercel 上，PostgreSQL 和 S3 兼容对象存储由你提供。把仓库导入 Vercel，在项目环境变量中配置：

- `APP_URL`：公开地址。
- `DATABASE_URL`：外部 PostgreSQL 连接地址。
- `S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`，以及浏览器能访问的
  `S3_PUBLIC_ENDPOINT`。桶必须预先创建。
- `OPENAI_API_KEY`。
- `TRUSTED_PROXY=platform`：**必须设置**。否则所有请求的客户端 IP 都记为 `unknown`，按 IP 的登录限流会变成
  所有人共用一个桶，陌生人的请求也会把你挡在登录页外。
- `AUTH_SECRET`：安全随机值，在重启、预览实例和多次构建之间保持一致。更换它会让所有会话、未用的验证码和
  API key 失效。
- `CRON_SECRET`：至少 32 个字符，例如 `openssl rand -hex 32`。

然后按"连接真实服务"一节，在能连到生产数据库的机器上用相同的 `DATABASE_URL`、`AUTH_SECRET`、`APP_URL`
运行 `account:create` 和 `account:enroll`。

`vercel.json` 写明了三件事（JSON 写不了注释，理由记在这里）：

- **`buildCommand` 是 `npm run db:migrate && npm run build`。** 迁移在 advisory lock 保护下执行，失败就让整次
  构建失败，不会部署出 schema 对不上的版本。写在仓库里而不是控制台，重建项目或 fork 之后也不会丢掉迁移这一步。
- **`ignoreCommand` 跳过 `main` 以外的构建**，因为不需要预览环境，而 Dependabot 的 PR 会触发没人看的构建。
  判断用 `VERCEL_GIT_COMMIT_REF`，并且**取不到分支名时照常构建**：写成"不是 main 就跳过"的话，变量读不到时
  连生产也会被跳过。那行 `echo` 把实际取值打进构建日志，方便排查。
- **每日 cron**：每天 UTC 18:00（北京时间凌晨 2 点，ECB 已发布当天汇率）调用 `/api/cron/daily`，带
  `Authorization: Bearer <CRON_SECRET>`。它清理过期记录，给所有账本的待处理任务补一次调度，刷新汇率，
  并清理对象存储。返回的 JSON 列出每一步是 `done`、`failed` 还是 `skipped`。手动触发：

  ```sh
  curl -H "Authorization: Bearer $CRON_SECRET" https://<APP_URL>/api/cron/daily
  ```

对象存储没有需要手动运行的清理命令。cron 总是先删记录再删对象：删对象失败只会留下没有记录的对象，
下一次再删，不会出现记录还在、对象却没了的情况。

## 升级、备份与恢复

升级前：

1. 备份 PostgreSQL。
2. 备份 S3/R2/MinIO 存储桶。
3. 记录当前部署的 Git 提交号。
4. 阅读目标版本的提交记录和迁移变化。

迁移在新版本构建之前执行，而旧版本在新构建上线之前（以及构建失败时）继续对外服务，所以每个迁移都兼容
正在运行的旧版本。迁移链已经压缩成 `0000_baseline.sql`，等于 0057 之前所有迁移执行完后的 schema；还没升到
0057 的数据库，`npm run db:migrate` 会拒绝执行，并提示先部署 `pre-baseline` 这个 tag。

完整备份包括：PostgreSQL 数据库、存储桶里的对象、`AUTH_SECRET` 等内部密钥（放在专用密钥管理系统里），
以及非敏感配置的记录。恢复时使用彼此对应的数据库和对象存储快照，只恢复一项会留下缺图片的记录或没人引用的对象。

本地的 `docker-compose.local.yml` 有两个具名卷：`cashier_postgres`（数据库）和 `cashier_minio`（原始票据图片）。
`npm run docker:down` 只停止并移除容器，保留这些卷；加 `-v` 会永久删除数据库和图片。

## 开发

- 代码结构、依赖方向、数据与并发约定、前端交互约定：[docs/architecture.md](./docs/architecture.md)
- 测试的放置、隔离和运行方式：[docs/testing.md](./docs/testing.md)
- 提交、门禁和代理（agent）约定：[AGENTS.md](./AGENTS.md)

提交改动前运行完整门禁：

```bash
npm run check
```

它依次检查格式、架构（dependency-cruiser）与死代码（knip）、lint、类型，跑带覆盖率的全部测试，
再用隔离的占位配置做一次生产构建并检查受保护路由的包体积。集成测试需要 Docker。

| 命令                     | 用途                                   |
| ------------------------ | -------------------------------------- |
| `npm run dev`            | 启动开发服务器                         |
| `npm run dev:demo`       | 启动独立的 demo 工作区                 |
| `npm run docker:local`   | 启动本地 PostgreSQL 和 MinIO           |
| `npm run docker:down`    | 停止本地基础服务，保留具名卷           |
| `npm run db:migrate`     | 对当前 `DATABASE_URL` 应用迁移         |
| `npm run account:create` | 创建唯一的账号、账本、分账和默认分类   |
| `npm run account:enroll` | 打印添加通行密钥的一次性链接（可找回） |
| `npm test`               | 单元测试                               |
| `npm run test:all`       | 单元测试和集成测试                     |
| `npm run test:smoke`     | Playwright 浏览器 smoke 测试           |
| `npm run check`          | 提交前的完整门禁                       |

## License

Cashier 使用 [GNU Affero General Public License v3.0](./LICENSE)。
