# MemoscapeLab（记忆空间实验室）

AI 历史照片自适应沉浸式渲染器与可视化调参工作台。项目在 Pannellum 完整球面、有限球面之外，加入独立 WebGL 弧形照片渲染器，使平面、圆柱和球面投影可以连续混合。

当前同时提供本地管理后台：D1 保存项目、资源索引、元数据与完整场景 JSON；腾讯云轻量对象存储（LighthouseCOS）保存项目原图、宽幅 / 全景照片和用户头像，R2 仅用于兼容既有资源。

## 当前能力

- `sphere360` 完整球面浏览；
- `partialSphere` 有限视域浏览；
- `curvedPhoto` 自适应弧形照片；
- `flatPhoto` 平面宽幅照片；
- `haov`、`vaov`、`vOffset` 投影参数；
- 水平和垂直曲率独立控制；
- 覆盖角、视觉中心、地平线、边缘压缩与渐隐；
- yaw、pitch、hfov 默认值与边界；
- 鼠标、触摸、键盘缩放与全屏；
- JSON 运行时校验和中文错误提示；
- 配置驱动的渲染调度；
- 本地照片载入、实时预览与设备尺寸切换；
- 7 组场景预设；
- JSON 导入、导出、复制与设备草稿；
- Pannellum 2.5.7 本地静态依赖；
- 两个真实示例场景，历史原图与生成全景分别关联，并从 `public/images/data.json` 导入完整来源元数据。
- `/proj` 项目卡片管理与持久化项目库；
- `/work` 上传、生成预留、投影调参、发布预留四步工作流；
- 项目卡片可重新进入工作台并加载已保存的全部参数。
- LighthouseCOS 双桶图床、同源后端代理上传、上传进度、服务端对象校验与私有资源访问链接；
- 历史原图、AIGC / 全景图与头像在浏览器端生成 WebP 缩略图，并与原文件成对上传、关联存储；
- D1 用户、服务端 Session、HttpOnly Cookie 与项目所有权隔离；
- 注册、登录、登出、头像、用户设置和安全改密；
- 30 分钟邮箱验证码、腾讯云 SES 真实邮件发送与 Resend 兼容接口；
- 每位用户独立的大模型生成设置；平台不提供共享 AI API，用户 API Key 加密保存并只用于本人任务；
- 超级管理员用户目录、组合检索、封禁、验证状态调整、密码重置和账号彻底删除。

## 本地运行

```bash
pnpm install
pnpm dev
```

打开终端中显示的本地地址。

首次访问 `/` 会进入 `/login`。请先复制 `.dev.vars.example` 为 `.dev.vars`，为
`SUPERADMIN_PASSWORD` 和 `PASSWORD_PEPPER` 设置不同的强随机值。应用仅在配置了
`SUPERADMIN_PASSWORD` 时自动创建超级管理员；默认用户名是 `superadmin`，默认邮箱是
`admin@memoscapelab.local`，也可以通过相应环境变量覆盖。部署时必须将这些敏感值设置为
Cloudflare Secret，不能写入源码或提交到 Git。

邮箱验证默认使用腾讯云 SES 的 6 位验证码。先在腾讯云 SES 控制台创建并审核邮件模板，模板只需一个变量 `{{code}}`，可直接上传 [`docs/tencent-ses-email-verification-template.html`](docs/tencent-ses-email-verification-template.html)。复制 `.dev.vars.example` 为 `.dev.vars`，填入新建的子用户密钥和已审核模板 ID 后，本地开发服务器也会真实调用 SES 发信。未配置邮件服务时，本地页面会显示开发验证码，非本地环境不会伪装为已发送或已验证。未验证邮箱只能进入验证页和用户设置，不能访问项目工作台。

腾讯云密钥必须保存在被 Git 忽略的 `.dev.vars` 或部署环境 Secret 中，不能提交到仓库。建议为发信单独创建最小权限的 CAM 子用户，不要使用主账号永久密钥。

### LightCOS 图床

项目图片使用上海地域的两个私有存储桶：`memoscape-archive-1306930939` 保存历史原图，`memoscape-media-1306930939` 保存全景图、后续缩略图和用户头像。复制 `.dev.vars.example` 中的 `TENCENT_LIGHTCOS_*` 配置到 `.dev.vars`，并填入专用于这两个桶的 CAM 子用户 SecretId 与 SecretKey。不要复用主账号密钥，也不要把密钥提交到 Git。

本项目使用的是轻量对象存储（Lighthouse 版）：浏览器只访问 MemoScapeLab 同源接口，由后端使用 COS 对象级 API 上传和读取文件，因此不依赖存储桶 CORS。历史原图限制为 10MB，全景图限制为 50MB；上传仅接受 JPG/JPEG、PNG、WebP。未来正式域名确定后可写入 `TENCENT_LIGHTCOS_PUBLIC_DOMAIN`，但当前公开访问仍由 MemoScapeLab 的稳定资源 URL 控制。

上传历史原图或全景图时，浏览器会先生成最长边不超过 `1600 × 900`、质量 `0.82` 的 WebP 缩略图；头像生成 `384 × 384` 居中裁切 WebP 缩略图。随后原文件与缩略图分别上传，D1 通过 `assets.parent_asset_id` 保留派生关系。项目卡片、工作流上传区、生成页和头像接口默认读取缩略图；投影调参 Viewer、发布 Viewer，以及调参台中点击放大的历史原图仍读取原文件。已有项目在没有缩略图字段时会回退显示原文件，重新上传后即可补齐缩略图。

## 构建与测试

```bash
pnpm build
node --import tsx --test tests/scene-validator.test.ts tests/rendered-html.test.mjs
```

也可以运行 `pnpm test`，它会先构建再执行全部测试。

## 场景配置

根路径会根据 Session 进入 `/login` 或 `/proj`；`/work` 为项目工作台，并在第四环节内提供最终浏览与全屏预览；`/about` 为项目介绍，`/usr` 为用户设置，`/usradmin` 为超级管理员用户目录。示例配置位于 `public/configs/`。弧形照片配置结构为：

```json
{
  "id": "scene-id",
  "title": "场景名称",
  "source": "/images/panorama.png",
  "mode": "curvedPhoto",
  "projection": {
    "horizontalSpan": 190,
    "verticalSpan": 78,
    "horizontalCurvature": 0.68,
    "verticalCurvature": 0.18,
    "edgeCompression": 0.12,
    "centerX": 0.5,
    "centerY": 0.5,
    "horizonY": 0.52,
    "edgeMode": "feather",
    "edgeFeather": 0.025
  },
  "view": {
    "yaw": 0,
    "pitch": 0,
    "hfov": 72,
    "minYaw": -72,
    "maxYaw": 72,
    "minPitch": -22,
    "maxPitch": 25,
    "minHfov": 55,
    "maxHfov": 88
  }
}
```

## 已知限制

- 热点当前使用 Pannellum 的 yaw / pitch 坐标；
- 移动端陀螺仪默认关闭，需要后续加入权限引导；
- 示例图仍是单张纹理，尚未启用多分辨率切片。
- 局部 UV 控制网格尚未加入，当前以全局投影参数为主；
- 本地照片通过浏览器临时地址预览，导出后需将照片放入配置中的正式资源路径。
