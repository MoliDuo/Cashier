# 测试

原则只有一条：**直接测行为**。服务端代码跑在真实 PostgreSQL 上测，纯函数写单测，UI 测试保持少量，
外加浏览器 smoke 流程。不 mock 被测代码本身。

## 命令

| 命令                       | 内容                                          | 需要             |
| -------------------------- | --------------------------------------------- | ---------------- |
| `npm test`                 | 单元测试（unit-node、unit-dom）               | Node.js 24       |
| `npm run test:watch`       | 监视模式的单元测试                            | Node.js 24       |
| `npm run test:integration` | 集成测试（integration-node、integration-dom） | Docker           |
| `npm run test:all`         | 全部 Vitest 项目                              | Docker           |
| `npm run test:coverage`    | 全部项目加覆盖率阈值（`vitest.config.mts`）   | Docker           |
| `npm run test:prepare`     | 只检查一次测试容器能否启动并释放              | Docker           |
| `npm run test:smoke`       | Playwright smoke，桌面与移动 Chromium         | Docker、Chromium |
| `npm run test:demo`        | 在 demo 工作区上跑 `@demo` 用例               | Docker、Chromium |
| `npm run check`            | 提交前的完整门禁，包含 `test:coverage`        | Docker           |

跑单个文件：`npx vitest run tests/unit/path/to/file.test.ts`。Playwright 首次使用前运行
`npx playwright install chromium`。

数据库相关的命令只需要一个运行中的 Docker daemon，不需要 `.env`、真实凭证、固定端口或手动迁移。
测试容器用 `postgres:18-alpine`，与生产的大版本一致，随机主机端口，Vitest 跑完即释放。首次运行会拉取镜像，比较慢。

## 分层

- **单元测试**不访问 PostgreSQL、网络或真实时间。纯 `.test.ts` 逻辑跑在 Node；组件测试和真正用到浏览器
  API 的测试跑在 happy-dom。外部边界（AI、网络、对象存储）mock 掉或换成内存假实现。
- **集成测试**验证 PostgreSQL 行为、路由和 server action 的组合、事务、并发，以及落库的服务端函数。
- **每个服务端函数只有一份实现，直接测它。** 用真实数据库调用它；只 mock 它调用的外部边界，
  不 mock 数据库、仓储或同仓库的其他模块，也不写只断言调用参数的测试。
- 同一个行为只在最低的合适层级完整验证一次。上层测试只测它新增的东西：授权、校验、错误映射、组合。
- 兼容性或遗留测试要写明它保护的输入格式、迁移或兼容契约；对应的兼容代码删除时，测试一起删除。

`npm run check:dead-code` 用 knip 扫描包括测试在内的完整依赖图：没有任何引用的导出会被报出来；
只被测试用到的导出不算死代码，也不需要标注。

## 放置

`tests/unit/` 和 `tests/integration/` 镜像 `src/`：测试放在它所测源文件的对应路径。例如
`src/modules/ledger/server/books.ts` 的测试是 `tests/unit/modules/ledger/server/books.test.ts` 或
`tests/integration/modules/ledger/server/books.test.ts`；`src/app/api/...` 下的路由由同一路径下的测试覆盖。

- 一个文件覆盖多个源文件时，放在它测得最多的那个旁边；说不清时就拆开。
- `scripts/` 的测试放在 `tests/unit/scripts/` 和 `tests/integration/scripts/`。
- 少数针对整个仓库的检查（安全头、已退役的文件、共享 mock）放在 `tests/unit/repo/`，这个目录保持很小。
- `tests/helpers`、`tests/fixtures`、`tests/stubs`、`tests/setup*.ts` 和 Playwright 的 `tests/smoke/` 保持原位。

## 数据

- **迁移只有一个函数。** `src/persistence/migrate.ts` 的 `migrateDatabase()` 由 `db:migrate`、smoke 和
  测试的全局 setup 共用，基线检查 `assertBaselineReached()` 也在这里。
- **种子只有一份。** `scripts/lib/seed.ts` 用 drizzle 和 `@/persistence` 写入用户、账本、分账、分类、凭证、
  文件、票据和汇率，存储 key 用 `durableKey()` 生成；既可以传 db，也可以传事务。smoke、demo 数据和测试
  helper（`tests/helpers/schema-setup.ts`）都用它。

## 隔离

### 集成测试

- 全局 setup 只迁移一次模板库 `test_<run-id>_template`，提供给各 worker。
- 每个测试文件用 `CREATE DATABASE … TEMPLATE` 建一份自己的库 `test_<run-id>_p<pool>_w<worker>`，布局与生产一致
  （表在 `public`，迁移记录在 `drizzle`），文件结束时删除。没有文件会重放迁移，所以集成测试的 worker 数
  随机器扩展（CPU 核数的一半）。
- 不同的运行从不共享数据库。无论正常结束、失败还是被中断，runner 只删除带自己运行前缀的库。
- 同一文件内的测试串行执行，因为 setup 会在测试之间清空这份库。数据库测试里不要用 `test.concurrent` 或
  `describe.concurrent`，除非先做到用例级隔离。
- `TEST_DATABASE_URL` 是显式的高级覆盖，永远不会回退到 `DATABASE_URL`。它必须是库名以 `_test` 结尾的
  PostgreSQL 地址，用户必须能建库；模板库和各文件的副本建在它旁边，结束后删除。连接或校验失败直接中止，
  不会改去启动本地容器。清理时先列出带运行前缀的库，从不删除指定的库或别的运行的库。

### 网络

每个测试 worker 安装 MSW 网络守卫。共享的确定性 handler 覆盖后台 OpenAI 的失败路径和 Frankfurter 汇率
fixture；测试可以另加针对用例的 handler。其他任何未处理的 HTTP 请求都会让测试失败，即使应用代码捕获了
这个错误。诊断信息只含 `TEST_UNEXPECTED_HTTP`、方法和 origin，不含路径、查询参数、凭证和请求体。

### `after()`

测试里的 `after()` mock 立即执行回调并跟踪返回的 promise。teardown 在清空数据库或关闭连接池之前等待所有
跟踪中的工作完成；同步和异步的回调失败都会让测试失败。这个有上限的等待即使在 fake timer 测试里也用真实
计时器，并保留超时的工作，所以未完成的回调不会悄悄带进下一份干净的数据。不要在清空数据库时加死锁重试来
掩盖未完成的工作。

## 浏览器 smoke

`tests/smoke/` 用 Playwright 跑在生产构建上，经过真实的浏览器、认证、server action 和 PostgreSQL 边界。

- 每次运行启动临时 PostgreSQL 容器，建一个唯一命名的 `smoke_<uuid>` 库，执行真实迁移，再用
  `scripts/lib/seed.ts` 写入一个虚构账号、一个账本、两个分账和几个分类。不会迁移、写入或清空任何已有的库。
- 桌面和移动场景串行运行，每个场景用新的浏览器上下文。
- 没有 dev 旁路，也不连真实邮件、AI 或对象存储。邮件经真实的 Resend 客户端发到本地假服务器
  （`RESEND_BASE_URL` 指向它），验证码落在内存 outbox 里。
- 一个用例走邮件验证码登录（并确认错误的验证码被拒绝）；其余用例直接在数据库里为种子账号开一个会话。
- 覆盖账本访问、手动录入、编辑、刷新后仍在、删除、退出登录、受保护页面的跳转，以及草稿恢复、设置即时保存、
  浏览器后退不再弹确认。
- 失败时截图和 trace 留在 `test-results/`，报告在 `playwright-report/`。

`npm run test:demo` 在 demo 工作区（`npm run dev:demo` 的同一套数据）上跑带 `@demo` 标签的用例。
