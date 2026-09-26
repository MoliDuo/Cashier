export const statsTabCopy = {
  throughToday: "截至今日",
  expenseTrend: "支出趋势",
  expenseRanking: "支出排行",
  dailyHeatmap: "每日热力图",
  trend: "趋势",
  heatmap: "热力",
  averageDaily: "日均支出",
  totalExpense: "总支出",
  month: "月",
  week: "周",
  year: "年",
  noStats: "暂无统计",
  noStatsDesc: "记录几笔账后，这里会显示钱花在哪里。",
  uncategorized: "未分类",
  lastWeek: "上周",
  lastMonth: "上月",
  lastYear: "去年",
  samePeriodMore: (v: {
    period: string | number;
    amount: string | number;
    percent: string | number;
  }) => `较${v.period}同期多 ${v.amount}（+${v.percent}%）`,
  samePeriodLess: (v: {
    period: string | number;
    amount: string | number;
    percent: string | number;
  }) => `较${v.period}同期少 ${v.amount}（-${v.percent}%）`,
  samePeriodEqual: (v: { period: string | number }) => `与${v.period}同期持平`,
  fullPeriodMore: (v: {
    period: string | number;
    amount: string | number;
    percent: string | number;
  }) => `较${v.period}多 ${v.amount}（+${v.percent}%）`,
  fullPeriodLess: (v: {
    period: string | number;
    amount: string | number;
    percent: string | number;
  }) => `较${v.period}少 ${v.amount}（-${v.percent}%）`,
  fullPeriodEqual: (v: { period: string | number }) => `与${v.period}持平`,
  loadFailed: "统计数据加载失败，请重试。",
  retry: "重试",
  previousPeriod: "上一周期",
  nextPeriod: "下一周期",
  entries: "笔数",
  averageEntry: "单笔均值",
  recordedDays: "记账天数",
  recordedDaysValue: (v: { active: string | number; total: string | number }) =>
    `${v.active} / ${v.total}`,
  sparklineLabel: "本期日支出",
  sparklinePrevious: "上期同期",
  sparklineExpand: "查看完整趋势",
  dailyAverageLine: "日均",
  weekdayRhythm: "星期节律",
  weekdayAverage: (v: { weekday: string | number; amount: string | number }) =>
    `周${v.weekday}平均 ${v.amount}`,
  highlights: "本期看点",
  busiestDay: "最大单日",
  recordingStreak: "连续记账",
  streakDays: (v: { days: string | number }) => `${v.days} 天`,
  topMoverUp: (v: {
    category: string | number;
    period: string | number;
    amount: string | number;
  }) => `${v.category} 比${v.period}多花了 ${v.amount}`,
  topMoverDown: (v: {
    category: string | number;
    period: string | number;
    amount: string | number;
  }) => `${v.category} 比${v.period}少花了 ${v.amount}`,
  showAllCategories: (v: { count: string | number }) => `显示全部（${v.count}）`,
  showFewerCategories: "收起",
  noShare: "无占比",
};

export const statsChartCopy = {
  scaleAdjusted: "已调整显示比例",
  expense: "支出",
  exceedsLimit: "（超出显示上限）",
  noData: "这个时间段暂无图表数据",
};
