# 部署、升级与备份

生产环境部署在 Vercel 上；PostgreSQL 和 S3 兼容对象存储由你提供。本地开发只用
`docker-compose.local.yml` 启动 PostgreSQL 和 MinIO 两个基础服务，应用本身用
`npm run dev` 运行。

反向代理不是必需项。仅当入口会覆盖客户端提供的 `X-Real-IP` 时设置
`TRUSTED_PROXY=platform`；直连部署应保持未设置。在 Vercel 上显式设置该值后读取
平台的单值 `X-Vercel-Forwarded-For`，非法或多值头不会被信任。

## Vercel 部署

把仓库导入 Vercel，构建命令由 `vercel.json` 提供。在项目的环境变量中配置：

- `APP_URL`：Vercel 分配的公开地址。
- `DATABASE_URL`：外部 PostgreSQL 连接地址。
- `S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`：
  S3 或 R2 配置，桶必须预先创建。
- `S3_PUBLIC_ENDPOINT`：浏览器可以访问的对象存储端点。
- `OPENAI_API_KEY`：AI 服务密钥。
- `AUTH_SECRET`、`API_KEY_PEPPER`、`AUTH_OTP_PEPPER`：三个内部密钥，
  必须是安全随机值，并且在同一部署的重启、预览实例和多次构建之间保持一致。

账号、账本和分账由首次启动的向导创建，不需要环境变量。

迁移由构建命令自己执行。`vercel.json` 里的 `buildCommand` 是
`npm run db:migrate && npm run build`：迁移跑在构建前面，失败就直接让整次构建失败，
不会部署出一个 schema 对不上的版本。命令从当前环境（包括 `.env`）读取 `DATABASE_URL`，
并在 advisory lock 保护下应用 `src/persistence/postgres-migrations/` 中尚未执行的迁移。

这条命令过去只配在 Vercel 控制台的 Build Command Override 里，仓库里看不见——
读代码的人（包括你自己）会以为迁移要手动跑。现在它写在 `vercel.json` 中，
重建项目或者被 fork 之后也不会悄悄丢掉迁移这一步。

`vercel.json` 的另一半是 `ignoreCommand`，它跳过 `main` 以外的构建。两个人用的应用
不需要预览环境，而 Dependabot 每周会开几个 PR，每个 PR 都会触发一次完整构建——
那些构建没有人会去看。

判断用的是 `VERCEL_GIT_COMMIT_REF`，并且**分支名取不到时照常构建**：

```sh
[ -n "$VERCEL_GIT_COMMIT_REF" ] && [ "$VERCEL_GIT_COMMIT_REF" != "main" ]
```

这个"取不到值就构建"不是多余的谨慎。反过来写成"不是 X 就跳过"，一旦变量读不到，
空字符串同样不等于 X，跳过的就是全部——包括生产。多花两分钟构建是小事，
推了 main 却悄无声息地没部署不是。

命令里那行 `echo` 会把 `VERCEL_ENV` 和 `VERCEL_GIT_COMMIT_REF` 的实际取值打进构建日志。
加它是因为排查上面这类问题时，靠改配置试一次要等一次完整部署；有这行，看日志就够了。
已知的一组取值：main 上的生产构建里 `VERCEL_ENV=production`、`ref=main`。

JSON 写不了注释，所以这几条的理由都记在这里。

## 本地基础服务

源码开发需要 Node.js 24，以及本机运行的 PostgreSQL 和 S3 兼容存储：

```bash
cp .env.local.example .env
npm run docker:local
npm run db:migrate
npm run dev
```

`docker-compose.local.yml` 启动 PostgreSQL 和 MinIO，并在 Postgres 首次就绪后创建
`cashier` 桶。它定义两个具名卷：

| 数据卷             | 内容            |
| ------------------ | --------------- |
| `cashier_postgres` | PostgreSQL 数据 |
| `cashier_minio`    | 原始票据图片    |

`npm run docker:down` 只停止并移除容器，不会删除这些卷。增加 `-v` 会永久删除数据库和
图片，执行前务必确认备份。

`.env.local.example` 中的三个内部密钥是公开的固定开发值，只用于让 loopback 环境复制后
立即启动。任何可被外部访问的部署都必须替换它们。

## 首次启动

空数据库首次启动后，打开服务地址：所有页面都会跳转到 `/setup`。服务端日志中
会打印一次性初始化代码，例如：

```
First-run setup is pending. Enter this setup code in the wizard to create the account.
```

在向导中填入该代码、一个登录邮箱、密码，以及一到多个分账名称（默认预填 `共同支出`），
提交后会一次性创建账号、账本、分账和默认分类，随后 `/setup` 永久返回 404。

初始化代码只保护“数据库为空”到“账号已创建”这段窗口，因此它只存在于进程内存中；
重启服务会重新生成并再次打印。已有数据的部署不会看到这个向导。

初始密码只在创建账号时使用。后续修改环境变量不会同步修改现有账号密码。

## 升级

当前项目处于早期公开阶段，没有稳定的兼容性承诺。升级前：

1. 备份 PostgreSQL。
2. 备份 S3/R2/MinIO 存储桶。
3. 记录当前部署所使用的 Git 提交号或部署版本。
4. 阅读目标版本的提交记录和迁移变化。

包含 `0043_category_assignment_v2.sql` 的版本不能与旧分类任务执行器混跑。升级时先停止
所有旧版本应用实例，再执行数据库迁移，最后启动新版本。迁移会把仍处于活动状态的 v1
分类任务标记为 `upgrade_interrupted`，不会自动重放 AI 请求；用户需要重新选择明细后再运行，
以免产生重复调用和费用。

`0042_reorder_default_categories.sql` 已改为 no-op，避免后续升级按名称覆盖用户排序。已经执行
过旧 0042 的数据库无法仅凭分类名称或当前顺序精确推断此前的自定义排序；只有升级前的可靠
备份可能恢复它。本次升级不会猜测或再次改写现有顺序。

部署时构建命令会自己运行 `npm run db:migrate`，但不要在没有数据库备份的情况下跳过多个版本升级。

## 备份与恢复

完整备份必须同时包含：

- PostgreSQL 数据库。
- S3/R2/MinIO 桶中的对象。
- Vercel 环境变量中的三个内部密钥，或你另行保存的副本。
- 当前环境变量的非敏感配置记录；密钥应放在专用密码或密钥管理系统中。

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

- 清理过期的限流桶、OTP、幂等记录、上传会话和对象清理任务。
- 清理超过 7 天且没有有效引用的 `stored_files` 和对应对象。
- 清理超过 24 小时且没有开放上传会话引用的 `temporary/*` 对象。
- 只报告对象已经缺失的数据库记录，不自动删除这些记录。

`--apply` 会真实删除数据。先审阅 dry-run 输出，并确保使用了正确的数据库和对象存储配置。

## 常用命令

| 命令                   | 用途                           |
| ---------------------- | ------------------------------ |
| `npm run docker:local` | 启动本地 PostgreSQL 和 MinIO   |
| `npm run docker:down`  | 停止本地基础服务，保留具名卷   |
| `npm run db:migrate`   | 对当前 `DATABASE_URL` 应用迁移 |

所有配置项见 [配置参考](./configuration.md)。
