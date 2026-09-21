export const UI_LANGUAGES = [
  { label: "自动", value: "auto" },
  { label: "简体中文", value: "zh" },
  { label: "English", value: "en" },
];

// Two people write this ledger, in Simplified Chinese. English is here because
// a source document often is, and because a fork's first user is more likely to
// want it than any third choice we could guess at.
export const AI_LANGUAGES = [
  { label: "简体中文", value: "zh-CN" },
  { label: "English", value: "en-US" },
] as const;

export type AiLanguage = (typeof AI_LANGUAGES)[number]["value"];
