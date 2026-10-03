export const authCopy = {
  productTagline: "一个安静的个人账本",
  signIn: "登录",
  signInAgain: "重新登录",
  noLedgerTitle: "还没有账本",
  noLedgerDesc: "在服务器上运行下面的命令创建账本。",
  devSignIn: "以开发身份进入",
  devSignInDesc: "仅限本地开发，直接进入。",
  devSignInFailed: "开发会话启动失败",
  messages: {
    signed_out: { title: "已退出登录", desc: "需要时点下面的按钮重新登录。", tone: "notice" },
    denied: { title: "登录已取消", desc: "没有完成登录，需要时可以重新登录。", tone: "error" },
    failed: { title: "登录没有完成", desc: "统一登录没有返回有效的结果，请重试。", tone: "error" },
  },
} as const;

export type LoginMessageKey = keyof typeof authCopy.messages;
