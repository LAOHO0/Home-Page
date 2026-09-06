# 我的导航

可管理应用、分类书签和五套差异化主题的个人导航站。前端使用原生 JavaScript，后端为 Express + Node.js 内置 SQLite，排序使用 SortableJS，图标来自 Lucide。

## 本地运行

安装 Node.js 24.5+，在本目录运行：

```bash
npm ci
npm start
```

- 首页：http://127.0.0.1:8766/
- 后台：http://127.0.0.1:8766/admin.html
- 首次在本机打开后台时创建管理员，密码至少 12 位。没有预设密码。
- 默认只监听 `127.0.0.1`；后台的资源和外观编辑均可直接通过表单完成。

## 已实现

- 网页搜索（Google、百度、Bing）、应用和书签站内搜索；按名称、描述、分类和标签检索。
- 资源卡片标题与描述分行；分类书签、标签筛选、响应式布局。
- 应用/书签添加、编辑、删除和排序；分类/标签管理；图标上传或填写链接。
- 经典圆润、晴空留白、终端石墨、山岚沉浸、月白极简五套主题；分别采用圆润深色卡片、明亮双栏、紧凑列表、居中山景和中性留白布局。每套分别保存整页、今日概览和资源区域背景。
- 后台“布局 / 背景 / 卡片”三个配置页签；可调整页面宽度与留白、面板圆角与间距、概览和资源内边距、卡片间距/宽度/留白/悬浮位移、边框和阴影。支持紧凑/标准/宽松预设，以及桌面/手机实时预览。
- 纯色、双颜色渐变、图片背景；图片上传/URL、位置、显示方式、遮罩、文字色；卡片颜色/透明度/圆角；实时首页预览和恢复默认。
- 网站名、Logo、欢迎语、默认引擎、默认天气城市、页脚配置。
- 包含本站上传图片的 JSON 备份与恢复；导入完整校验和原子替换，账号和会话不导出。

## IP 与天气

公网部署时按连接的访客 IP 定位，本机回环预览会显示本机公网出口，页面标注“本机公网出口”。IP 默认部分隐藏，点击可显示完整地址。

服务端使用 ipwho.is 获取大致城市与运营商，Open-Meteo 获取天气和搜索城市。定位失败使用后台默认城市；定位或手选城市的天气不可用时，再尝试默认城市并标明回退；仍不可用则明确提示，不生成虚构温度。首页点击天气城市可手选或恢复 IP 定位；选择仅保存在访客浏览器。

定位和天气结果只作内存缓存（10/15 分钟）；所有外部请求有超时。这些外部服务可能被本地网络限制，IP 定位也可能落在 VPN/代理出口。天气和位置失败不影响导航、后台和主题。

默认不信任客户端 `X-Forwarded-For`。放在反向代理后时，将 `TRUST_PROXY` 配置为实际代理 IP/CIDR 的逗号分隔列表，并让代理覆盖客户端地址头。不要把所有来源设为可信代理。HTTPS 反向代理正确配置后，会话 cookie 自动使用 Secure。

## 数据和图片

- `data/navigation.sqlite`：站点文档、管理员密码的 scrypt 哈希、带有效期的会话哈希。
- `data/uploads/`：上传图片，服务器验证后统一转换 WebP。
- 后台每次保存校验修订号；多窗口冲突会提示重新加载，不覆盖另一窗口的新修改。
- 上传支持 PNG/JPG/WebP，单文件最大 5 MB、3200 万像素。输出限制为 2400×1800。
- 备份包含当前配置引用的上传图片；外部图片仍以 URL 保留。本机旧图片保留，便于历史备份恢复。
- JSON 备份上限为 35 MB；超限时导出会提示压缩或减少图片，不生成无法恢复的文件。支持全部 2000 个资源图标和 16 个站点背景/Logo 图片。旧备份导入时自动补齐经典、月白主题与布局默认值。
- 源码目录 `src/`、SQLite、会话和项目文件不通过静态服务器暴露。首页主题只由后台设置，访客端不显示主题切换入口。

根目录的 `index.html`、`script.js`、`styles.css`、`config.json` 是保留的早期原型，当前服务使用 `public/` 和 `src/`，不读取旧配置。

月白主题复用现有首页与后台数据，只提供中性浅灰底色、白色面板、深墨文字、细线和轻阴影。无需导入独立 `SITE_CONFIG` 或参考页面脚本。在后台“主题与背景”选择“月白 · 极简”后点击“保存外观”；整页、今日概览、资源背景以及圆角、间距、边框和面板阴影仍由后台配置。农历、搜索联想与资源状态点使用首页共用功能；浏览器无法完成资源探测时，状态不能等同于服务器离线。

## Docker 与镜像部署

源码仓库：[LAOHO0/Home-Page](https://github.com/LAOHO0/Home-Page)。推送到 `main` 后，GitHub Actions 会测试并构建 Linux amd64/arm64 镜像，发布至 `ghcr.io/laoho0/home-page`，提供 `latest` 和 `sha-提交号` 标签。首次发布后，仓库所有者需在 GitHub Packages 中将包的 Visibility 设为 Public，才可匿名拉取；私有包需先使用具备 `read:packages` 权限的凭据登录 GHCR。

使用已发布的镜像（先复制 `.env.example` 为 `.env` 并设置账号密码）：

```bash
git clone https://github.com/LAOHO0/Home-Page.git
cd Home-Page
cp .env.example .env
# 编辑 .env，设置至少 12 位的 ADMIN_PASSWORD
docker compose -f compose.image.yaml pull
docker compose -f compose.image.yaml up -d
```

镜像拉取命令：

```bash
docker pull ghcr.io/laoho0/home-page:latest
```

更新时重新执行 `pull` 和 `up -d`，配置和图片保存在命名卷中；升级前可通过后台导出 JSON 备份。不要执行 `down -v`，该命令会删除数据卷。

### 从源码构建

在 `.env` 填入自己的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD`（至少12位），然后：

```bash
docker compose up -d --build
```

首次启动使用环境变量初始化管理员，后续保留数据库中的账号。Compose 默认仅映射本机 `127.0.0.1:8766`，数据存储于命名卷。自定义部署可以配置 `HOST`、`PORT`、`DATA_DIR` 和 `TRUST_PROXY`。

## 验证

```bash
npm run check
npm test
npm run test:ui
```

浏览器测试使用已安装的 Chrome，创建临时数据库和测试天气数据，验证完成后清理测试数据；截图在 `test-results/`。测试不会创建或修改真实后台管理员。

## 来源

早期原型来源：[shanbei2033/Simpages](https://github.com/shanbei2033/Simpages)，保留 MIT LICENSE。布局参考 [tuji.uk](https://tuji.uk/) 的 SimPage，它和 Simpages 不是同一个项目；当前导航和后台为独立重写。

山岚主题使用本地缓存的 [Unsplash 山景照片](https://images.unsplash.com/photo-1464822759023-fed622ff2c3b)。示例站点图标通过 favicon.im 获取并本地缓存；对应商标归各站点所有。配置可随时替换这些素材。
