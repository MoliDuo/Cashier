/**
 * 术语表 — every screen names the same things the same way:
 * - 账单: one record (a receipt, a message, a quick entry); the code calls it a
 *   source document. Not 票据, 单据 or 记录.
 * - 明细: one line of a bill; the code calls it a ledger entry. Not 条目 or 分录.
 * - 原始凭证: the images and text a bill was made from.
 * - 分账 is one book; 总账 is all of them at once.
 * - 重新处理 runs a bill's input through the AI again as it is; 修改后重新处理
 *   changes the input first.
 */
export const commonCopy = {
  today: "今天",
  yesterday: "昨天",
  back: "返回",
  skipToContent: "跳到主内容",
  close: "关闭",
  confirm: "确认",
  delete: "删除",
  retry: "重试",
  selectItem: (v: { item: string | number }) => `选择${v.item}`,
  cancel: "取消",
  save: "保存",
  saveFailed: "保存失败",
  savedRefreshFailed: "已保存，但无法刷新最新数据，请重试。",
  deleteSuccess: "删除成功",
  deleteFailed: "删除失败",
  loading: "加载中…",
  success: "成功",
  error: "错误",
  sendingStatus: "发送中…",
  incompleteAccountingProjection: "部分明细缺少汇率，未计入主币种合计。",
  noRecords: "暂无账单",
  edit: "编辑",
  loadMore: "加载更多",
  discard: "放弃",
  refresh: "刷新",
  unsavedChangesTitle: "有未保存的更改",
  unsavedChangesDescription: "未保存的修改将丢失，是否放弃？",
  continueEditing: "继续编辑",
  book: "分账",
  bookChangeFailed: "保存分账失败，账单可能已被修改或分账已归档。",
  archivedBookOption: (v: { name: string | number }) => `${v.name}（已归档）`,
  draftRestored: "有未保存的修改",
  draftOutdated: "草稿基于旧版本，保存前请核对",
};

export const currencyCopy = {
  conversionUnavailable: "暂时无法换算",
};

export const bookPickerCopy = {
  namePlaceholder: "分账名称",
};

export const bookScopeCopy = {
  label: "分账",
  all: "总账",
};
