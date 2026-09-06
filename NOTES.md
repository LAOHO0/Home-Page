# 项目说明

原型起点为 shanbei2033/Simpages（MIT），参考布局来自 https://tuji.uk/（SimPage）。两者不是同一个项目；本站导航、后台与数据服务为本地重新实现，保留原 MIT LICENSE。

源码以 src/ 和 public/ 为准；根目录旧 index.html/script.js/styles.css/config.json 是早期静态原型，不再被当前服务器读取。配置保存在 data/navigation.sqlite。

本次为布局与功能改造，不承诺逐像素克隆原站。整体采用原生模块化 JavaScript、Express、Node 24 内置 SQLite、Sharp 和 Lucide，排序使用 SortableJS。

本地山景图片来源：Unsplash，https://images.unsplash.com/photo-1464822759023-fed622ff2c3b 。用于可替换的山岚主题背景，不生成 SVG 景观。

天气：Open-Meteo。城市检索：Open-Meteo Geocoding。访客定位：ipwho.is。仅回环地址的本地预览通过 ipify 读取本机公网出口；部署后的公网访问按访客 IP 查询。请求结果只作有时限的内存缓存，不写访客数据库。

交付验证命令：npm test / npm run check / npm run test:ui。浏览器截图位于 test-results/，浏览器测试使用独立临时数据库和明确的天气 fixture，不改变真实后台账号。
