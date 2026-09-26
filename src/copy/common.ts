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
  savedRefreshFailed: "已保存，但无法刷新最新数据，请重试。",
  deleteSuccess: "删除成功",
  deleteFailed: "删除失败",
  loading: "加载中…",
  success: "成功",
  error: "错误",
  sendingStatus: "发送中…",
  incompleteAccountingProjection: "部分记录缺少汇率，主币种汇总未包含这些记录。",
  noRecords: "暂无记录",
  edit: "编辑",
  loadMore: "加载更多",
  discard: "放弃",
  readOnlyPreview: "只读预览",
  refresh: "刷新",
  refreshFailed: "刷新失败，请重试",
  refreshing: "刷新中…",
  unsavedChangesTitle: "有未保存的更改",
  unsavedChangesDescription: "未保存的修改将丢失，是否放弃？",
  continueEditing: "继续编辑",
  book: "分账",
  bookChangeFailed: "保存分账失败。记录可能已被其他操作修改，或该分账已归档。",
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
