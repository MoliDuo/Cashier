# 架构

这份文档描述 Cashier 现在的样子，以及以后改动要遵守的方向。每一次重构都要能指出自己推进或维护的是
这里的哪一节；如果改动需要偏离这里写的方向，先修改这份文档并说明理由，再改代码。

## 1. 设计前提

- **一个账户、一个账本、多个分账。** 账本是单例，分账（books）是用户真正会看到的分区。
- **一个账户可以挂多个登录邮箱，实际有两个人在用。** "两个人同时编辑同一张票据"是真实会发生的情况，
  但频率很低。
- **部署在 Vercel Hobby 上。** 函数上限 120 秒，没有常驻 worker，cron 只能按天调度。
  存储用 Postgres 和 S3 兼容的对象存储。本地开发走同一条应用路径。
- **AI 调用又慢又贵，还可能失败。** 一次提取可能要几十秒，服务商会限流，函数也可能在调用中途被平台终止。
- **界面只有中文。** AI 输出语言可以配置，这是有意保留的功能。

## 2. 原则

1. **只存事实，派生值在读取时计算。** 典型例子是折算金额：它由金额、币种、日期和主币种唯一确定，
   不需要存起来再想办法保持同步。
2. **一个概念只有一个状态。** 不允许两张表互相镜像同一个状态，再写代码去纠正它们之间的偏差。
3. **并发控制只加在真正会并发的地方。**
   - AI 后台任务用租约加 fencing token。
   - 两个人同时编辑同一张票据时，在整体保存那一步做前置检查，用票据上的整数 `version`。
     **当且仅当整体保存能写的内容（标题、日期、条目集合与条目字段）发生变化时，`version` 加 1**。
     换分账、提交提取、记录失败、分类任务都不改动它。不用 `updated_at`，因为 JS 只有毫秒精度，
     Postgres 存的是微秒，比较相等并不可靠。
   - 其余写入一律用字段级 PATCH，最后写入者胜出。后台分类任务对单个条目做比较并交换
     （`category_id` 仍是开始时的值才写入），不依赖票据的版本号。
4. **默认硬删除。** 删除就是删行，读取不需要软删除谓词。凭证是唯一的例外：它的 `deleted_at` 表示
   "已吊销"，吊销后的行留作审计。
5. **离开页面是安全的。** 草稿会保留下来，而不是拦住用户不让离开。只有上传还在进行时才拦截关闭页面。
6. **所有时间预算都从同一个数字推导。** 截止时间、租约长度、单次请求超时都由
   `FUNCTION_MAX_DURATION_SECONDS`（`src/config/tuning.ts`）算出来，不允许出现比函数寿命更长的截止时间。
   路由段配置必须写字面量，所以另有测试保证两边一致。
7. **测试直接测行为。** 服务端代码跑在真实 Postgres 上测，纯函数写单测，UI 测试保持少量，外加 smoke 流程。
   不 mock 被测代码本身。详见 [testing.md](./testing.md)。
8. **部署遵守 expand/contract。** 迁移执行时，旧版本还在对外服务。删除一列要分三次发布：
   先停写，再停读，最后才删。模型不再提到、库里还没删的名字登记在 `schema-contract.test.ts` 的
   `retiredNames` 里。
9. **租户查询按 `ledger_id` 限定。** 即使只有一个账本也照做。

## 3. 分层与目录

Cashier 只有一种运行环境（Vercel、PostgreSQL、S3 兼容存储），所以没有 port、adapter 或组装根。
代码直接调用真正干活的函数。

```
src/app/                  路由与 API handler：认证、校验、调用、映射响应
  (protected)/(ledger)/   stream、details、stats、settings 四个真实路由，共用一个 layout
  api/ledger-queries      浏览器读取的唯一入口（类型化查询注册表）
  api/v1                  外部 API（快捷指令）
  api/cron/daily          每日兜底清扫
  api/stored-files        带授权的文件读取
  login、enroll           登录与一次性 passkey 注册
src/modules/<m>/          auth、currency、ledger、source-document、stats、workspace
  server-actions/         Zod 校验 + withLedgerAccess，然后直接调用 server/ 的函数；只用于命令
  queries.ts              本模块的类型化读取，建立在无类型的 postLedgerQuery 传输层之上
  server/                 drizzle 数据访问与事务（"server-only"）
  domain/                 纯决策：状态、金额、解析、提示词；不碰数据库、框架和 IO
  hooks/ ui/              客户端代码，一个界面一个组件加一个 hook
src/server/               跨模块的后台流程：processing、category-reclassification、maintenance、
                          stored-files、api-v1 请求管线
src/lib/                  共享基础设施：db（含租约帮手）、s3、ai、email、logger、env、money、format、
                          security、drafts、queries 传输层
src/persistence/          schema（按领域拆文件）和迁移
src/copy/                 全部界面与邮件文案，按界面区域分文件
```

依赖规则：

1. `app` → `modules` / `server` → `lib` → `persistence`。`src/lib` 和 `src/persistence` 不得 import
   模块或 `src/server`，类型 import 也算；`src/server` 不得 import 路由、server action 或 UI。
2. 模块之间、模块与 `src/server` 之间可以互相调用 `server/` 的函数，只要文件级 import 不成环。
3. server action 和 API 路由不直接碰数据库或服务商 SDK。
4. 只改名转发参数的函数不应该存在，直接调用目标。
5. `domain/` 不得 import 数据库；客户端代码不得 import `server/`。
6. `src/copy` 是叶子：只放文案，除了 `src/config` 的类型什么都不 import；任何一层都可以 import 它。

有值得单测的分支时，把决策抽到 `domain/`；直来直去的数据访问留在 `server/`，用 PostgreSQL 集成测试覆盖。

**检查方式。** `npm run check:architecture` 用 dependency-cruiser（`.dependency-cruiser.cjs`）检查 `src`：
上面的依赖方向、客户端组件与入口的边界、文件级循环依赖，类型 import 一并计入。与 import 无关的规则放在
`eslint.config.mjs` 的 `no-restricted-syntax` 里，按语法而不是文本匹配：

- `logger` / `console` 调用里的 id 类字段必须经过 `logIdentifier`；
- 只有登记过的 writer（`registeredSourceDocumentWriters`）可以插入、更新或删除 `sourceDocuments`；
- class 字面量不得使用任意字号或已退役的 `text-muted`。

注释永远不算证据。

## 4. 数据模型

表名沿用历史名字。改表名在迁移和旧版本并存的部署窗口里没法安全进行，收益又只是名字好看，
所以下表的"概念"一列只用来说明职责。

| 概念与表名                                              | 职责                                                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `ledgers`（单行）、`books`、`categories`                | 账本设置、分账、分类。分类硬删除，名称唯一约束为 `DEFERRABLE`                                                                             |
| 票据：`source_documents`                                | 所属分账、标题、日期、当前输入（文本）、`version`、指向当前提取尝试的 `latest_submission_revision_id`、幂等 key                           |
| 票据文件：`source_document_files`                       | 票据当前输入的文件                                                                                                                        |
| 提取尝试：`source_document_revisions`                   | 每一次提取：请求的日期、状态、租约、尝试次数、失败码。它本身就是任务队列，没有手动 revision                                               |
| 条目：`ledger_entries`                                  | 金额、币种、分类、所属票据。不存折算值                                                                                                    |
| 汇率：`exchange_rates(rate_date, currency, per_eur, …)` | 每个自然日、每个币种一行，`source_date` 记录服务商的真实日期，`fetched_at` 记录抓取时间                                                   |
| `stored_files`                                          | 对象存储里文件的登记，`finalized_at` 为空即 pending                                                                                       |
| `category_jobs`、`category_job_documents`               | 批量分类任务，租约放在 job 行上，进度在读取时统计                                                                                         |
| 认证                                                    | `users`、`login_emails`、`sessions`、`passkeys`、`webauthn_challenges`、`verification_codes`、`rate_limit_buckets`、`service_credentials` |
| `ledger_sync_state`                                     | 客户端刷新用的水位线，由语句级触发器维护                                                                                                  |

语义约定：

- **日期挂在票据上。** 一张票据一个日期（`document_date`，缺省时 `effective_date` 取创建日）。
  一次输入里出现多个日期时，由"日期整理"和"拆分"处理。条目自带日期的方案评估过，代价约 53 个文件，
  而多日期输入并不常见，所以不做。
- **折算在读取时完成。** 只有 SQL 函数 `convert_amount` 这一份实现，按票据的 `effective_date` 精确匹配
  当天的汇率行；没有汇率行就显示为未折算，不回退到别的日期，也不做跨币种 1:1 兜底。汇率行按自然日存放，
  周末取服务商给出的上一个工作日。服务商还没发布当天汇率时先存一行临时值，之后由维护流程刷新。
  改主币种只是改一个设置。
- **重新提取成功时，在同一个事务里替换全部条目。** 失败或取消时旧条目原样保留，同时展示新的输入和失败原因。
- **手动录入的票据没有提取记录。** 它的状态就是空闲。手动编辑就地改条目，不创建 revision，不复制条目历史。
- **当前输入属于票据。** 提交或编辑重试会替换它；拆分和日期整理把它复制给每张新票据，让新记录保留证据。
- 金额用 `numeric(21,3)` 加 decimal.js 字符串，能覆盖三位小数的币种。

### 数据访问

- 租户数据在 SQL 里按 `ledgerId` 限定。
- 优先用集合式语句（`UPDATE FROM`、CTE、`unnest`），不逐行查询。
- keyset 排序与游标字段保持一致，游标里带查询的指纹。
- **票据写入只走登记过的 writer**（`src/modules/source-document/server/`），没有第二条写路径。
  外部 IO（汇率、服务商调用）在事务开始之前做，永远不放在事务里。写事务先锁账本行，再按 id 升序锁目标票据。
- 只有详情页的整体保存（`saveSourceDocumentChanges`）比较锁定行的 `version` 和调用方的 `expectedVersion`，
  并且只写它补丁的字段。其他命令检查各自依赖的更窄前置条件，例如票据不在处理中、所选条目仍在票据上、
  建议仍是最新的。
- 票据详情是一个完整的契约，包含条目和证据文件的元数据。历史 revision 编号保留作审计；新的 revision
  用 UUID 标识，并发靠票据版本。
- 用满足调用方的最窄读取。编辑重试的证据只读票据的输入，不加载调用方会丢弃的条目或分类投影。
- 加载出来的账本设置是完整契约，只有更新输入是部分的；不要在每个使用者那里重复默认值。
- 替换条目是票据聚合内部的帮手，不是独立的 writer。已经锁定的票据和条目直接传给事务帮手。

## 5. 认证与安全边界

- **会话。** 自建 `sessions` 表，cookie `cashier_session` 里是 32 字节随机令牌（httpOnly、Secure、
  SameSite=Lax），库里存它的 HMAC。14 天滑动过期，`last_seen_at` 超过 1 天才续期。用 `getCurrentSession`
  读取，用 `requireAuth`、`requireRecentAuth` 或 `withAuth`（`src/modules/auth/server/session-guards.ts`）
  把关，吊销就是删除行。一次查询带出用户和登录邮箱。proxy 只检查 cookie 是否存在。
- **登录方式。** passkey 为主，邮件 OTP 兜底，没有密码。开发和测试环境保留受 `isDevAuthBypassEnabled()`
  限制的 dev 旁路。
- **passkey**（`src/modules/auth/server/passkeys.ts`）使用可发现凭证，RP 取自 `APP_URL`。每次流程存一行
  `webauthn_challenges`，完成时删除，所以一个 challenge 只能应答一次。添加或删除 passkey 需要
  `requireRecentAuth`（10 分钟内登录过）。
- **建账号与找回。** 没有网页 setup。首个账号用 `npm run account:create -- --email <addr>` 在一个事务里
  建好用户、登录邮箱、账本、默认分账和分类。`npm run account:enroll -- --email <addr>` 生成 30 分钟有效的
  一次性注册链接 `/enroll?token=…`，库里只存令牌的 HMAC（`purpose=enroll`），`/enroll` 在一个事务里注册
  passkey 并删掉这一行。链接只打印到终端，不写日志；它也是 passkey 全丢时的找回途径。
- **验证码与限流。** 尝试次数与锁定只有一份实现（`src/modules/auth/domain/verification-challenge.ts`），
  OTP 和改邮箱共用；重发不清零尝试次数和锁定。限流桶存在 Postgres，名字一律用 `rateLimitKey` 生成，
  形如 `<用途>:<HMAC>`，不含原始邮箱、IP 或 id。
- **密钥。** 每一种摘要都用 `deriveKey` / `keyedDigest`（`src/lib/security/keys.ts`），一种用途一把密钥，
  全部由 `AUTH_SECRET` 经 HKDF 派生。
- **API v1 凭证。** 192 位随机值，HMAC 存储，绑定到分账。
- **转发的客户端地址** 默认不可信，除非明确配置了 `TRUSTED_PROXY`。
- **日志。** 只记关联 id 和经 `logIdentifier` 标记的标识，邮箱和 IP 一律哈希。不记原始邮箱、IP、
  bearer token、OTP、图片内容或服务商负载。
- 防账号枚举和计时攻击的措施保留。
- 邮件、汇率、AI、对象存储等外部调用放在数据库事务和账本锁之外。一次性和带租约的流程用条件写、行锁或
  fencing token。

## 6. 后台运行模型

### 触发与预算

- **三种触发方式。**
  - `after()`：请求结束后立即执行。提交事务里先写一条持久记录，再调用 `after()`，因为 Vercel 可能丢掉
    `after()`。
  - 轮询顺带恢复：客户端本来就会轮询，下一次上传、账本查询或流水刷新会捡起中断的任务。
  - 每日 cron：兜底清扫。
- **没有全局循环、外部队列或常驻 worker。** runner 认领不到工作时立刻返回，快用完预算时主动停下，
  剩下的交给下一次触发。
- **租约。** 只有提取和分类两个流程需要租约，共用 `src/lib/db/lease.ts`，只认数据库时钟：
  `expires_at > clock_timestamp()` 即持有。租约 60 秒，每 15 秒续一次，都由 `FUNCTION_MAX_DURATION_SECONDS`
  推导，所以函数被杀后一分钟内就能重新认领。
- **重试。** 错误只在 `src/lib/background/retry.ts` 分类一次：暂时性失败（限流、宕机、超时）按退避重新
  排队，直到第三次尝试；永久性和配置问题立即失败。认领时计数，超过上限的认领在租约下直接失败。
  恢复只读取到期且没人持有的尝试，重复调度会输掉认领。

### 票据提取

- 一次提交创建一个提取尝试（`source_document_revisions` 行），并用 `after()` 安排工作。尝试本身就是队列项。
- worker 在尝试仍处于处理中、且仍是票据最新提交时认领它，运行中续租，并在写入结果或失败的同一个事务里
  关闭它。AI 结果写回时做 fencing 检查。
- `POST /api/v1/source-documents` 在图片处理、对象上传和落库完成后返回 `201`，不等 AI 解析。
- 重试创建请求要复用同一个 `Idempotency-Key`。key 存在它创建的票据上，按账本和发送方限定，永久有效：
  重复请求直接返回那张票据，内容不同返回 `409`，并发的重复请求在账本锁上等第一个提交。
- AI 的文本、图片和 JSON 修复请求都用配置的单一模型。AI 客户端在进程内串行化请求并遵守 Retry-After；
  这不是跨实例的服务商配额。

### 批量分类

- 选择一次提交，最多 `CATEGORY_ASSIGNMENT_MAX_ENTRIES` 个条目；服务端在一个事务里登记 job、票据和条目。
  一个账本最多一个活动 job，run 租用 job 行，所以每个账本一个 worker，账本之间不共享槽位。
- run 逐个处理到期票据，花完 `CATEGORY_RUN_BUDGET_MS` 就停下，把手上的票据交回且不计尝试。没有待处理票据时，
  在同一个事务里根据条目结果定下 job 状态。关页面不会取消已开始的 job；job 活动期间，进度轮询每隔几秒起一次
  新 run，每日 cron 收拾剩下的。
- 一张票据是分类的原子提交单位；选中条目超过 50 个的组用持久化的请求块做检查点。外部 AI 请求不保证恰好一次，
  恢复可能重复一个块。
- **加锁顺序：账本 → 票据 → job 行。** 每一次 worker 写入（决策、重试、失败、应用）都在同一语句或事务里用
  `leaseHeldBy` 检查租约，租约过期的 worker 什么也写不进去。聚合事务还校验目标分类，以及票据仍存在且不在
  处理中。每个条目只在仍是选中时的分类时才写入，所以期间被改过的条目单独算冲突；这次写入不改票据版本。
  条目结果和票据状态在同一个事务里写入。job 不存进度计数，读取时从条目和票据行统计。

### 存储

- 网页图片用短时签名 PUT URL 直传到私有 S3 兼容存储。规划阶段在账本锁下为每张图登记一行 pending 的
  `stored_files`，前提是账本还有额度：最多 20 个 pending 文件，UTC 零点以来最多存 100 MiB。签名 URL 指向
  `temporary/{ledgerId}/{storedFileId}`。
- 15 分钟内的最终化会核对每个临时对象的 MIME、大小和 SHA-256，用 sharp 归一化（同时剥离 EXIF），写入持久
  key 并标记 ready；重复最终化原样返回。只有 ready 的文件能挂到提取尝试上。
- API v1 的内联图片不经过 `temporary/`：服务端归一化后同样预留 pending 行，写入持久对象，再标记 ready。
  之后提交失败的，丢弃它存下的文件。
- 读取一律经过带授权的 `/api/stored-files/{fileId}`，响应头 `Cache-Control: private, no-store`。
  实现在 `src/server/stored-files/`，测试通过 mock `@/lib/storage/s3` 替换对象存储。

### 每日 cron

`/api/cron/daily`（`src/server/maintenance/daily.ts`）由 Vercel Cron 每天调用一次，用 `CRON_SECRET` 认证。
请求不再顺带触发维护。每一步在 cron 预算内独立运行：

1. 过期记录（验证码、challenge、会话、限流桶）；
2. 用 `after()` 调度每个账本到期的提取工作；
3. 同样调度分类工作；
4. 刷新汇率，补齐缺失的日期并替换临时值；
5. 超过 1 天的 pending 文件；
6. 7 天没有被任何票据使用的 ready 文件（先删行，再删对象）；
7. `temporary/` 下超过 1 天的对象；
8. 超过 1 天、没有任何行指向的孤儿对象。

## 7. 前端

### 路由与数据

- **路由。** 每个账本页面是 `src/app/(protected)/(ledger)/` 下的真实路由。共享 layout 负责外壳、当前分账、
  新建记录对话框和详情弹层；跨路由状态放在每个 layout 一份的 workspace store（`src/modules/workspace/store.tsx`），
  不用注册式 context。每个路由管自己不带前缀的查询参数，打开的记录是 `?detail=<id>`。
- **读取。** React Query，经 `/api/ledger-queries` 这个会话查询路由，包括页面预取和账户自己的列表；
  各模块的 `queries.ts` 在无类型的 `postLedgerQuery` 传输层上给读取加类型。server action 是串行执行的，
  只用于命令。
- **写入。** 用集中定义的 query key 和 `useLedgerMutation`，完成后按账本范围的资源分组让缓存失效。
  不去修补无关的筛选窗口，也不维护客户端实体仓库。
- **首屏。** 只有文档请求在服务端预取后注水；客户端导航带 `rsc` 头，直接从查询缓存渲染。
- **提交后的快照。** 已提交的聚合快照可以替换对应的详情查询，并阻止更旧的响应把版本回滚。连续拆分用这个快照
  发出下一条命令。后台的列表和统计刷新不能让一次成功的命令一直处于 pending；没有快照的编辑器只等目标详情。
- **页面各管自己的加载和错误状态。** 统计在刷新期间保留上一次成功的数据和对应周期；同一代的流水刷新保留已加载的页。
- **流水。** 流水页显示处理中、失败和已完成的全部票据。服务端 keyset 分页按
  `entryDate DESC, createdAt DESC, id DESC` 排序，浏览器保持服务端顺序。
- **文案。** 界面只有中文，全部文案集中在 `src/copy/`，按界面区域分文件，每个文件导出若干 `xxxCopy` 对象。
  普通文案是字符串，带参数的是函数（`batchDeleted({ count })`），组件、hook、服务端直接 import，
  不经过 hook 或 provider。没有自动的"没人读的文案"检查：删功能时顺手删它的文案，整个对象没人用时 knip 会报。
  日期和数字格式固定为 `zh-CN`（`DISPLAY_LOCALE`）。

### 刷新

- 每个账本有一个单调递增的 bigint 同步版本。触发器每个事务为每个账本分配一个版本，并原子地更新分类、设置、
  统计各自的水位线（`ledger_sync_state`）。刷新时比较水位线和观察者的版本，不需要变更历史。改主币种会推进全部水位线。
- 流水和详情的观察者共享一个按账本的 React Query 刷新请求，同一时间只有一个在途请求。
- 响应里还报告是否还有处理中的票据。有过渡中的工作时，可见页面每 3 秒轮询；后台不轮询，获得焦点或重新联网时刷新。
  无效或来自未来的版本会让受影响的账本投影全部失效。

### 草稿与离开

- 未保存的输入会被保留，而不是拦住用户。`src/lib/drafts.ts` 按记录把草稿存进 localStorage，key 为
  `draft:<ledgerId>:<kind>:<id>`，只存可 JSON 化的字段，选中的图片只在页面生命周期内留在内存。
- 关闭表单、关闭详情弹层、用浏览器历史离开，都不询问；下次打开时恢复草稿，并提示"有未保存的修改 · 放弃"。
- 已有记录的草稿记着它基于的版本，记录被改过时，草稿按冲突拒绝。
- 只有主动点"取消编辑"时才确认放弃。浏览器历史从不拦截。对话框退出用 Radix 的关闭焦点生命周期，
  不依赖可能永远不触发的 CSS 动画事件。

### 客户端缓存

- 不提供离线可用，不注册 service worker，每次加载都取当前部署。web manifest 让应用仍可从浏览器菜单和 iOS 分享面板安装。
  `public/sw.js` 只负责让旧版本装过的预缓存 worker 退役：立即激活、删除全部缓存、注销自己。
- 票据图片不存进 IndexedDB 或 service worker 缓存，每次查看都是一次新的授权读取。
- 浏览器里的图片数据在压缩和上传过程中始终是 `File` / `Blob`。Object URL 是界面资源，替换、移除、重置或卸载图片时必须回收。

### 组件结构

- 一个界面一个组件，配一个 hook。hook 直接调用 mutation、直接 import 文案，不经过层层转发，
  也不把文案对象当参数传进 hook 或函数。
- 渲染状态直接派生，状态更新用函数式写法；客户端入口里不 import 模块 barrel。

### 编辑交互

适用于设置页，以及任何"列出一批对象、就地改其中一个"的界面（分账、分类、API 密钥、登录邮箱）。
约定的是改动在哪里发生、什么时候写库。

1. **单字段就地改，立即生效。** 改一个已存在对象的、行里看得见的单个字段，就在那一行改，回车即写库，
   不进编辑模式、不开弹窗。开关、下拉选完即写；长文本在离开输入框时写。写库期间同一分区的控件禁用；
   失败由 toast 说明原因，输入留在编辑态。适用：分账名称与时区、API 密钥所属分账、外观、记账规则
   （折叠、AI 语言、提示词、币种）。
2. **成组字段用编辑模式加分区级保存 / 取消。** 写库本身是一个事务的一批改动（增删、排序），用一次编辑会话承载，
   未保存的修改存成草稿。编辑期间服务端版本变了，草稿不能覆盖，界面提示"分类已在别处更改"并提供载入最新。
   适用：分类管理、分类预设切换、票据详情的编辑模式。
3. **弹窗只留给四种事：** 新建尚不存在的对象（新增分账、新建 API 密钥）；多步流程（添加登录邮箱的验证码）；
   一次性不可再得的信息（新密钥的 token）；行内放不下的多字段编辑（三个及以上字段，或需要图标选择器 / 长文本，
   例如分类的图标 + 名称 + 描述）。
4. **破坏性动作一律确认。** 删除、归档、退出登录、放弃未保存草稿，全部用 `ConfirmDialog`，`variant="destructive"`。

新增设置项时按 1 → 2 → 3 的顺序问，前两问任意一个答"是"就不要再往弹窗走。

编辑入口一律是铅笔图标按钮（`Pencil`、`variant="ghost"`、`size="icon-sm"`），带含对象名的 `aria-label` 和
`title`。行内动作顺序固定为**上移 / 下移 / 编辑 / 归档 / 删除**，归档和删除用
`text-muted-foreground hover:text-danger`。就地编辑态的动作换成勾和叉，Enter 等于勾、Esc 等于叉，输入框自动聚焦。

### 视觉基线

- 界面现代、简洁、紧凑、偏工作台。用 `src/app/design-tokens.css` 和 `src/app/globals.css` 里现有的 token，
  不另起主题系统。
- `#10a37f` 只用于主操作和焦点，不做装饰。表面保持中性，语义色只表示状态：危险 `#b24c5a`、警告 `#9a6b1f`、
  信息 `#4f6f7a`、成功 `#24836e`。深色模式用现有的近黑中性色阶。
- 用系统无衬线字体栈加本地中文回退，不远程加载字体，字间距为 `0`。
- 间距遵循 4/8pt。触控控件至少 44px；卡片和桌面对话框圆角不超过 8px；移动端长流程用方角全屏表面、`100dvh`、
  安全区内边距、固定头尾和可滚动主体。
- 动效只做功能性的、低调的：只动 opacity 和 transform，160–280ms，处理中用 CSS spinner，reduced-motion 下近乎瞬时。
- 命令和导航用 Lucide 图标，空状态和说明不需要装饰图标。移动端筛选用底部抽屉；日期选择、计算器和确认用紧凑对话框。
- 有筛选的结果只显示金额，不加"筛选合计"前缀；无筛选时可以显示"合计"；没有标题的账单显示"未命名账单"。

### 字号

先在 `src/components/typography.ts` 里找角色，再考虑写原始字号。

| 角色           | 字号          | 用途                         |
| -------------- | ------------- | ---------------------------- |
| `pageTitle`    | 24px semibold | 页面的 `<h1>`                |
| `dialogTitle`  | 18px semibold | 弹窗或侧滑面板标题           |
| `sectionTitle` | 16px semibold | 页面级分区标题，例如设置分组 |
| `cardTitle`    | 14px semibold | 列表中一张卡片的标题         |
| `body`         | 14px          | 默认正文                     |
| `bodyStrong`   | 14px medium   | 表单标签、条目名、行内值     |
| `bodyMuted`    | 14px muted    | 标题下的说明和提示           |
| `meta`         | 12px muted    | 次要元数据：时间、计数、提示 |
| `micro`        | 11px muted    | 标签、图表刻度、紧凑徽章     |
| `provisional`  | 11px 斜体     | 还可能变化的机器生成文本     |

- 这套字号是冻结的。`micro` 是 Tailwind 没有的一档，定义在 `globals.css` 的 `--text-micro`。
  不要写 `text-[13px]` 这类任意值，也不要在两档之间加新档；标题不用 `text-xl`。更大的展示字号（404 水印、
  OTP 和金额输入）是有意的例外。
- 次要文字只用 `text-muted-foreground` 或 `text-muted-foreground/60`。标题用 `font-semibold`，
  `font-bold` 只留给展示数字。
- 交互控件保留自己的尺寸。Input 和 Textarea 在移动端用 16px，避免 iOS Safari 聚焦时缩放，桌面端 14px。

## 8. 决定记录

### 路线图（全部完成）

- **Phase 0：先修的问题。** 分类重算空转、解析截止时间长于函数寿命、会话不过期、OTP 锁定被重发清零等。
- **Phase 1：票据模型。** 读时折算、收窄版本协议、合并提取尝试与 outbox。
- **Phase 2：后台与存储。** 统一租约加每日 cron、上传只留 `stored_files`、改为硬删除。
- **Phase 3：前端、认证、测试与工具。** 自建会话与 passkey、去掉密码和网页 setup；真实路由、草稿代替离开拦截、
  设置即时生效、hook 收拢；集成测试模板库、测试目录镜像 `src/`、dependency-cruiser 与 ESLint 取代自制检查器、
  scripts 改 TypeScript、文档收敛。
- **之后：文案模块。** 去掉 next-intl，文案改为 `src/copy/` 下的普通 TS 模块。只有一种语言，多语言框架带来的
  只有 provider、目录校验和测试 mock；集中存放保留了"一处看全部文案"的好处，类型和跳转由 TS 直接提供。

### 不做

- **条目自带日期。** 多日期输入不常见，为它改约 53 个文件不划算，拆分和日期整理保留。
- **去掉 `ledger_id`。** 与租户隔离的要求冲突，改动面约 250 个文件，收益很低。
- **CI 拦部署。** 推送到 `main` 后 Vercel 立刻迁移并部署，与 CI 并行。继续靠提交前本地 `npm run check` 兜底。
- **升级到 TypeScript 7。** 仓库脚本已不再调用 TS 编译器 API，但 typescript-eslint 和 dependency-cruiser
  还依赖它，要等两者支持。

### 看起来重，但保留

- **金额存储**：`numeric(21,3)` 加 decimal.js，改成整数最小单位得不到任何好处。
- **AI 流程的租约与 fencing**：`after()` 会重叠执行，函数也可能中途被杀。
- **提交事务里先写持久记录，再调 `after()`**：Vercel 可能丢掉 `after()`。
- **分类按请求块做检查点**：大票据的分类一个函数跑不完。
- **先锁账本、再锁票据**：用户自己的编辑会和后台写入竞争。
- **前端数据层**：React Query、SSR 预取与注水、水位线轮询、专用读取路由，不改成 `revalidatePath`。
- **API v1 凭证设计、Postgres 限流、防账号枚举与计时攻击的措施。**
- **S3 直传加 sharp 归一化**：Vercel 请求体上限 4.5MB，同时要剥离 EXIF。
- **工程底座**：严格的 tsconfig、testcontainers、MSW 网络守卫、smoke 测试、baseline 迁移守卫。
