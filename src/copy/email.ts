/*
 * A phone's notification shows only the subject and the first line of an
 * email, so both lead with the code: it can be read without opening the mail.
 */

/** The email that carries a sign-in code. */
export const signInCodeEmailCopy = {
  subject: (v: { code: string }) => `${v.code} 是你的 Cashier 登录验证码`,
  preview: (v: { code: string; minutes: string | number }) =>
    `验证码 ${v.code}，${v.minutes} 分钟内有效`,
  heading: (v: { host: string | number }) => `登录 ${v.host}`,
  note: (v: { minutes: string | number }) =>
    `${v.minutes} 分钟内有效。如非本人操作，请忽略此邮件。`,
};

/** The email that confirms a new login email address. */
export const addLoginEmailCopy = {
  subject: (v: { code: string }) => `${v.code} 是你的 Cashier 验证码`,
  preview: (v: { code: string; minutes: string | number }) =>
    `验证码 ${v.code}，用于添加登录邮箱，${v.minutes} 分钟内有效`,
  heading: "添加登录邮箱",
  note: (v: { minutes: string | number }) =>
    `${v.minutes} 分钟内有效。如非本人操作，请忽略此邮件。`,
};
