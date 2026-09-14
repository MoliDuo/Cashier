# 部署、升级与备份

Cashier 提供两种 Docker Compose 部署方式：

反向代理不是必需项。仅当入口会覆盖客户端提供的 `X-Real-IP` 时设置
`TRUSTED_PROXY=platform`；直连部署应保持未设置。Vercel 部署在显式设置该值后读取
平台的单值 `X-Vercel-Forwarded-For`，非法或多值头不会被信任。

- 本地全家桶：Cashier、PostgreSQL 和 MinIO 全部由 Compose 管理，适合首次体验和单机部署。
- 外部服务：Compose 只启动 Cashier，数据库和对象存储由你提供。

## 本地全家桶

复制本地模板并填写初始账号与 AI 配置：

```bash
cp .env.local.example .env
```

```dotenv
INITIAL_USER_EMAIL=you@example.com
INITIAL_USER_PASSWORD=choose-a-strong-password
OPENAI_API_KEY=your-api-key
```

启动：

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

这个模式会创建三个具名卷：

| 数据卷             | 内容                      |
| ------------------ | ------------------------- |
| `cashier_postgres` | PostgreSQL 账本数据       |
| `cashier_minio`    | 原始票据图片              |
| `cashier_config`   | Docker 自动生成的内部密钥 |

`docker compose -f docker-compose.yml -f docker-compose.local.yml down` 只停止并移除容器，
不会删除这些卷。增加 `-v` 会永久删除数据库、图片和内部密钥，执行前务必确认备份。

本地模板中的四个内部密钥是公开的固定开发值，只用于让 loopback 环境复制后立即启动。
任何可被外部访问的部署都必须替换它们；也可以将它们留空，让 Docker 在
`cashier_config` 卷中生成并持久化随机值。

## 外部 PostgreSQL 与对象存储

复制外部服务模板：

```bash
cp .env.example .env
```

必须配置：

- `DATABASE_URL`：PostgreSQL 连接地址。
- `S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、
  `S3_SECRET_ACCESS_KEY`：S3 或 R2 配置。
- `S3_PUBLIC_ENDPOINT`：浏览器可以访问的对象存储端点。
- `INITIAL_USER_EMAIL`、`INITIAL_USER_PASSWORD`：仅在空数据库上创建初始用户。
- `OPENAI_API_KEY`：AI 服务密钥。

对象存储桶必须预先创建。然后启动：

```bash
docker compose -f docker-compose.yml up -d
```

`docker:external` 和 `docker:prod` npm 脚本执行的是同一外部服务模式。

## 首次启动

容器入口会按以下顺序执行：

1. 如果没有显式提供内部密钥，在 `cashier_config` 卷中生成并持久化
   `AUTH_SECRET`、`API_KEY_PEPPER`、`RATE_LIMIT_PEPPER` 和 `AUTH_OTP_PEPPER`。
2. 等待 PostgreSQL 并应用 `src/persistence/postgres-migrations/` 中的迁移。
3. 当数据库中没有用户时，根据 `INITIAL_USER_EMAIL` 和 `INITIAL_USER_PASSWORD` 创建初始用户。
4. 启动 Cashier。

初始密码只在创建用户时使用。后续修改 `.env` 不会同步修改现有账号密码。

## 升级

当前项目处于早期公开阶段，没有稳定的兼容性承诺。升级前：

1. 备份 PostgreSQL。
2. 备份 S3/R2/MinIO 存储桶。
3. 保存当前部署所使用的镜像标签或 Git 提交号。
4. 阅读目标版本的提交记录和迁移变化。

包含 `0043_category_assignment_v2.sql` 的版本不能与旧分类任务执行器混跑。升级时先停止
所有旧版本应用实例，再执行数据库迁移，最后启动新版本。迁移会把仍处于活动状态的 v1
分类任务标记为 `upgrade_interrupted`，不会自动重放 AI 请求；用户需要重新选择明细后再运行，
以免产生重复调用和费用。

`0042_reorder_default_categories.sql` 已改为 no-op，避免后续升级按名称覆盖用户排序。已经执行
过旧 0042 的数据库无法仅凭分类名称或当前顺序精确推断此前的自定义排序；只有升级前的可靠
备份可能恢复它。本次升级不会猜测或再次改写现有顺序。

使用预构建镜像时：

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml pull app
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

容器启动时会自动执行数据库迁移。不要在没有数据库备份的情况下跳过多个版本升级。

早期版本曾以明文保存服务凭证。仅在恢复或核验这类历史数据库时使用专项工具：

```bash
npm run db:migrate:credentials -- <backfill|verify|clear-plaintext>
```

它不是常规启动迁移，不应在普通升级中重复执行。运行前先备份数据库，并按顺序完成
`backfill`、`verify`，确认无误后才可考虑 `clear-plaintext`。

## 备份与恢复

完整备份必须同时包含：

- PostgreSQL 数据库。
- S3/R2/MinIO 桶中的对象。
- `cashier_config` 卷，或者你自行保存的四个内部密钥。
- 当前 `.env` 的非敏感配置记录；密钥应放在专用密码或密钥管理系统中。

恢复时应使用彼此对应的数据库和对象存储快照。只恢复其中一项可能留下数据库记录存在但
图片缺失，或对象存在但数据库无引用的状态。

## 存储维护

`npm run prune` 清理可以证明已经无引用的运行时数据和对象。命令默认只扫描，不删除：

```bash
npm run prune
npm run prune -- --apply
npm run prune -- --json --batch-size 500 --orphan-grace-days 14 \
  --temporary-grace-hours 48
```

默认规则：

- 清理过期的限流桶、OTP、幂等记录、上传会话、变更日志批次和对象清理任务。
- 清理超过 7 天且没有有效引用的 `stored_files` 和对应对象。
- 清理超过 24 小时且没有开放上传会话引用的 `temporary/*` 对象。
- 只报告对象已经缺失的数据库记录，不自动删除这些记录。

`--apply` 会真实删除数据。先审阅 dry-run 输出，并确保使用了正确的数据库和对象存储配置。

## 常用命令

| 命令                      | 用途                       |
| ------------------------- | -------------------------- |
| `npm run docker:local`    | 使用 npm 启动本地全家桶    |
| `npm run docker:external` | 使用 npm 启动外部服务模式  |
| `npm run docker:build`    | 构建生产镜像               |
| `npm run docker:down`     | 停止本地全家桶，保留具名卷 |
| `npm run db:migrate`      | 在源码开发环境应用迁移     |

所有配置项见 [配置参考](./configuration.md)。
