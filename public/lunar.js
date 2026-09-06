/* Small browser-native lunar date adapter used by the home page. */
(function () {
  "use strict";
  const formatter = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { month: "long", day: "numeric" });
  function format(date) {
    const parts = formatter.formatToParts(date);
    const month = parts.find(part => part.type === "month")?.value || "";
    const day = Number(parts.find(part => part.type === "day")?.value);
    const dayNames = ["", "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十", "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"];
    return month + (dayNames[day] || day + "日");
  }
  window.Lunar = { format };
})();
