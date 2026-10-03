export const authCopy = {
  productTagline: "一个安静的个人账本",
  signIn: "登录",
  signInAgain: "重新登录",
  noAccountTitle: "还没有账户",
  noAccountDesc: "在服务器上运行下面的命令。邮箱要与统一登录里的用户邮箱一致。",
  devSignIn: "以开发身份进入",
  devSignInDesc: "仅限本地开发，直接进入。",
  devSignInFailed: "开发会话启动失败",
  messages: {
    signed_out: { title: "已退出登录", desc: "需要时点下面的按钮重新登录。", tone: "notice" },
    credentials_changed: {
      title: "登录邮箱已变更",
      desc: "所有设备都已退出，请重新登录。",
      tone: "notice",
    },
    not_bound: {
      title: "这个账号还没有绑定",
      desc: "统一登录里的邮箱没有绑定到这个账户，无法使用。请用已绑定的邮箱登录，在设置的登录邮箱里添加它。",
      tone: "error",
    },
    denied: { title: "登录已取消", desc: "没有完成登录，需要时可以重新登录。", tone: "error" },
    failed: { title: "登录没有完成", desc: "统一登录没有返回有效的结果，请重试。", tone: "error" },
  },
} as const;

export type LoginMessageKey = keyof typeof authCopy.messages;
