export function isHourlyPoolTable(tableType) {
  return tableType === "POOL" || tableType === "AMERICAN_POOL";
}

export function gameChoices(tableType) {
  if (isHourlyPoolTable(tableType)) return [["NORMAL_POOL", "Pool (Hourly)"]];
  if (tableType === "MINI_SNOOKER") {
    return [
      ["NORMAL_SNOOKER", "Normal Mini Snooker"],
      ["QCHASE_RUMMY", "QChase / Rummy"],
      ["SIX_BALL_SNOOKER", "6-Ball Snooker"],
      ["TEN_BALL_SNOOKER", "10-Ball Snooker"],
      ["KITTY", "Kitty"],
    ];
  }
  return [
    ["NORMAL_SNOOKER", "Normal Snooker"],
    ["QCHASE_RUMMY", "QChase / Rummy"],
    ["SIX_BALL_SNOOKER", "6-Ball Snooker"],
    ["TEN_BALL_SNOOKER", "10-Ball Snooker"],
    ["KITTY", "Kitty"],
  ];
}
