/** The email that carries a sign-in code. */
export const signInCodeEmailCopy = {
  subject: "Cashier 验证码",
  preview: "您的验证码已生成",
  heading: (v: { host: string | number }) => `登录 ${v.host}`,
  intro: "请输入下方验证码以登录您的账户：",
  codeLabel: "您的验证码：",
  expiry: (v: { minutes: string | number }) => `该验证码将在 ${v.minutes} 分钟后失效。`,
  warning: "请勿将验证码透露给任何人。我们绝不会主动向您索取验证码。",
  footer: "如果这不是您本人操作，可以忽略这封邮件。",
};

/** The email that confirms a new login email address. */
export const addLoginEmailCopy = {
  subject: "Cashier 验证码",
  preview: "添加登录邮箱",
  heading: "添加登录邮箱",
  intro: "输入以下验证码以把这个邮箱加入登录邮箱列表。",
  codeLabel: "验证码",
  expiry: "验证码将在 5 分钟后失效。",
  warning: "如果不是你发起的操作，请忽略此邮件。",
  footer: "Cashier 账户安全",
};
