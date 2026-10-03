# 自托管

Moli 自己的服务器部署见 [deploy.md](./deploy.md)；本文给想自己跑一份的人。配置变量见 [configuration.md](./configuration.md)。

## 自托管（Docker Compose）

Moli Cashier 以一个常驻的 Node 进程运行在 Docker 里，和 PostgreSQL、S3 兼容的对象存储（Versity S3 Gateway）一起由 `compose.yaml` 编排。
后台提取、批量分类和每日维护都在应用进程内完成，不需要外部的定时任务或队列。

> 这是给别人自托管用的示例。Moli 自己的服务器不用这个文件，见 [deploy.md](./deploy.md)。

### 准备

```bash
cp .env.example .env
```

编辑 `.env`，至少填写：

- `CASHIER_HOST`：对外域名，例如 `cashier.example.com`。`APP_URL` 必须是 `https://<CASHIER_HOST>`，
  OIDC 的回调地址 `<APP_URL>/auth/callback` 由它决定；以后改域名要同步改认证服务里登记的回调地址。
- `POSTGRES_PASSWORD`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`：随机值，例如 `openssl rand -hex 24`。
- `OPENAI_API_KEY`（以及按需的 `OPENAI_BASE_URL`、`AI_MODEL`）。
- `OIDC_ISSUER_URL`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`：在认证服务里为 Moli Cashier 注册 client 后得到，
  配置见下面的"登录（OIDC）"。
- `AUTH_SECRET`：安全随机值，在重启和升级之间保持一致。更换它会让所有会话和 API key 失效。
- `CASHIER_DATA_DIR`：数据库和对象存储的宿主机目录，默认 `./data`。

### 启动

```bash
docker compose up -d --build
```

`compose.yaml` 里的 `migrate` 一次性服务先在 advisory lock 下、一个事务里执行迁移，成功后应用才启动；迁移失败时应用不会启动，数据库保持原样。
Postgres 和对象存储只在 compose 的内部网络里，不占用宿主机端口。应用监听容器内的 3000 端口，由反向代理转发。

对象存储用 Versity S3 Gateway 的 posix 后端：存储桶是 `${CASHIER_DATA_DIR}/s3/` 下的目录，对象就是里面的文件，
所以数据目录的一个快照就是完整备份。数据目录所在的文件系统需要支持扩展属性（ext4、XFS、ZFS 都支持）。
没有用 MinIO，是因为它不再发布社区版镜像，`quay.io/minio` 上的旧镜像已经拉取不到。

创建账号和注册链接（命令在应用容器里执行，读取容器自己的环境变量）：

```bash
docker compose exec cashier npm run account:create -- --email you@example.com
```

### 登录（OIDC）

Moli Cashier 通过 OIDC 授权码流程（带 PKCE）登录，认证服务可以是 Authelia 或任何标准的 OIDC 提供方。
认证服务里用户的邮箱与 Moli Cashier 的"登录邮箱"一一对应：提供方返回的邮箱没有绑定在 Moli Cashier 里，就不能使用。
没有本地会话时，Moli Cashier 直接跳到认证服务；认证服务里已经登录时，用户只会看到一次很快的跳转。
退出登录只清除 Moli Cashier 自己的会话，不会退出认证服务，并停在不自动跳转的登录页。

以 Authelia 为例，在它的配置里登记 Moli Cashier（`client_secret` 用 Authelia 的哈希格式，`OIDC_CLIENT_SECRET` 填明文）：

```yaml
identity_providers:
  oidc:
    clients:
      - client_id: moli-cashier
        client_name: Moli Cashier
        client_secret: "$pbkdf2-sha512$…"
        public: false
        authorization_policy: one_factor
        consent_mode: implicit
        redirect_uris:
          - https://cashier.example.com/auth/callback
        scopes: [openid, profile, email, groups]
        require_pkce: true
        pkce_challenge_method: S256
        token_endpoint_auth_method: client_secret_basic
```

`OIDC_ISSUER_URL` 是 Authelia 的公开地址（例如 `https://auth.example.com`）。邮箱必须在 ID token 的 `email` 里（不再读 userinfo），ID token 只接受 RS256 签名，`iat` 与当前时间相差超过 5 分钟的会被拒绝；提供方标明 `email_verified` 为 false 的邮箱会被拒绝。

**从旧的通行密钥 / 邮件验证码登录升级前**，先确认 Moli Cashier 设置页里的登录邮箱与认证服务里的用户邮箱一致，
否则升级后没有人能登录。万一已经锁在外面，在服务器上补一个邮箱：

```bash
docker compose exec cashier npm run account:add-email -- --email you@example.com
```

升级会删除通行密钥、验证码和限流相关的表，迁移前请先备份。

### 反向代理

手机相机和 OIDC 回调都要求 HTTPS，所以应用前面必须有终止 TLS 的反向代理。`compose.yaml` 里带有 Traefik 的 labels，
并让应用加入外部网络 `server-internal-net`（Traefik 所在的网络）；用别的反向代理时，删掉这些 labels 和那个网络，
自己转发到应用的 3000 端口。无论用哪种代理，都要满足：

- 保留原始的 `Host`（和 `X-Forwarded-Host`），并设置 `X-Forwarded-Proto: https`。否则登录和所有 server action
  会因为来源检查失败，会话 cookie 也会丢掉 `Secure`。
- 读超时至少几分钟：上传和 AI 请求都可能持续几十秒。
- 请求体上限不小于 32 MiB（API v1 的请求体上限）。

### 每日维护与后台工作

应用进程启动约 30 秒后补跑一次维护，之后每天 UTC 18:00（ECB 已发布当天汇率）运行一次：清理过期记录，刷新汇率，
清理没有被引用的文件和孤儿对象。每一步的结果写在日志里。容器停机期间错过的那次，会在下次启动时补上。
提取和批量分类由 worker 处理，提交后立即开始；容器重启时，没做完的工作在新进程里接着做。

收到停止信号（`docker compose stop`、重新部署）时，应用停止领取新工作，给手上的工作 20 秒完成，其余的交还队列，
由下一个进程接手。`stop_grace_period` 设为 30 秒。

对象存储没有需要手动运行的清理命令。维护总是先删记录再删对象：删对象失败只会留下没有记录的对象，
下一次再删，不会出现记录还在、对象却没了的情况。

## 升级、备份与恢复

升级前：

1. 备份 PostgreSQL 和对象存储的数据目录（`CASHIER_DATA_DIR` 下的 `postgres`、`s3`）。如果数据目录在 ZFS 上，
   先打一个快照最简单。
2. 记录当前部署的 Git 提交号。
3. 阅读目标版本的提交记录和迁移变化。

升级：

```bash
git pull
docker compose up -d --build
```

`migrate` 服务先跑迁移，成功后才替换应用容器。所有待执行的迁移在一个事务里完成：迁移失败就整体回滚，应用不会
替换，数据库保持原样，用旧提交重新 `docker compose up -d --build` 即可回到升级前。迁移只加不删：新增表和列，
要删的东西先停用，下一个版本再迁移删除，这样回滚到上一个版本时旧代码仍然能用。迁移链已经压缩成
`0000_baseline.sql`，等于 0057 之前所有迁移执行完后的 schema；还没升到 0057 的数据库，`npm run db:migrate`
会拒绝执行，并提示先部署 `pre-baseline` 这个 tag。

完整备份包括：PostgreSQL 数据库、存储桶里的对象、`AUTH_SECRET` 等内部密钥（放在专用密钥管理系统里），
以及非敏感配置的记录。恢复时使用彼此对应的数据库和对象存储快照，只恢复一项会留下缺图片的记录或没人引用的对象。

`docker compose down` 只停止并移除容器，数据目录保持不动；删除数据目录会永久删除数据库和图片。
本地开发用的 `docker-compose.local.yml` 有两个具名卷：`cashier_postgres` 和 `cashier_s3`，
`npm run docker:down` 同样保留它们，加 `-v` 会永久删除。

## 本地连接真实服务

```bash
git clone https://github.com/MoliDuo/MoliCashier.git
cd MoliCashier
npm ci
cp .env.local.example .env
```

编辑 `.env`，填入 AI 密钥（`OPENAI_API_KEY`）。然后启动 PostgreSQL、对象存储和应用：

```bash
npm run docker:local
npm run db:migrate
npm run dev
```

账号、账本和分账不在环境变量或网页向导里配置，而是用本地命令创建：

```bash
npm run account:create -- --email you@example.com
npm run account:add-email -- --email other@example.com
```

- `account:create` 在一个事务里创建账号、登录邮箱、账本、分账（默认 `共同支出`，可用 `--book`
  多次指定）和默认分类；已有账号或邮箱已被使用时拒绝执行。
- `account:add-email` 给唯一的账号再绑定一个登录邮箱。平时在设置页的"登录邮箱"里增删即可；只有在认证服务里
  改了邮箱、导致没有人能登录时，才需要用这个命令兜底。

账号没有密码，登录完全交给认证服务（见下面的"登录（OIDC）"）。本地开发可以设置 `DEV_AUTH_BYPASS=true`，
在登录页直接以开发身份进入。

两个命令读取 `DATABASE_URL`（环境变量，或项目根目录的 `.env.local` / `.env`）。

不要提交 `.env`、服务商凭证、真实票据、API 密钥或原始个人数据。
