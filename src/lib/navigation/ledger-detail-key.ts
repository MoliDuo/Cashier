export function ledgerDetailLeaveGuardKey(type: "source-document", id: string): string {
  return `${type}-detail:${id}`;
}
