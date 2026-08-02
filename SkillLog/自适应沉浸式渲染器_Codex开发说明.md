# AI 历史照片自适应沉浸式渲染器

> 面向 AI 扩展、上色后的 2:1 历史照片，构建兼容标准全景、有限视域全景、弧形宽幅照片和普通宽幅照片的自适应 Web 沉浸式浏览系统。

---

## 1. 项目背景

现有历史照片经过 AI 扩展和上色后，会被生成或裁切为 2:1 图片。但这类图片通常只是“视觉上接近全景”，并不一定满足标准等距柱状投影的几何约束。

当前样本中大约存在以下情况：

- 约 70% 的图片可以直接或经过轻微参数调整后用于沉浸式浏览；
- 约 30% 的图片在标准 Pannellum 球面全景中存在明显问题；
- 这些问题图片作为普通宽幅照片观看时，整体效果仍然较好。

典型问题包括：

1. 左右边缘无法自然拼接；
2. 建筑、人物、道路等内容在球面投影中发生扭曲；
3. 图片顶部和底部被强制映射到天顶和地面后严重拉伸；
4. 局部区域存在 AI 生成幻觉或不同透视体系；
5. 图像构图适合宽幅观看，但不适合完整 360° 环视。

因此，本项目不要求把所有图片强行转化为真实 360° 全景，而是为每张图片选择最适合的沉浸式投影方式。

---

## 2. 核心目标

构建一个“自适应有限视域沉浸投影”系统，使不同质量的 AI 历史照片都能获得尽可能自然的观看效果。

系统应支持：

- 标准 360° 球面全景；
- 有限水平和垂直视域的部分球面全景；
- 水平弯曲、垂直近似平面的弧形照片模式；
- 普通宽幅照片的平移、缩放和轻度视差浏览；
- 每张照片独立配置投影参数；
- 可视化调参并保存为 JSON；
- 支持热点、文字、音频和历史档案信息；
- 支持桌面端、移动端和陀螺仪浏览；
- 在不暴露明显 AI 幻觉的前提下保留沉浸感。

---

## 3. 产品原则

### 3.1 不强求所有图片都能 360° 旋转

沉浸感不等于完整 360° 环视。对于本质上是宽幅照片的图片，应通过有限视角和曲面展示增强空间感，而不是暴露接缝和扭曲。

### 3.2 保持历史照片主体构图

系统应优先保护：

- 主要建筑结构；
- 人物比例；
- 道路方向；
- 地平线位置；
- 原始照片主体区域。

### 3.3 每张图片独立适配

不使用统一参数处理所有图片。每张图片应拥有独立的投影配置和视角限制。

### 3.4 支持自动降级

如果某张图片不适合球面或弧形浏览，系统应自动降级到普通宽幅浏览模式。

---

## 4. 图片浏览模式

系统至少支持以下四种模式。

### 4.1 `sphere360`

适用于：

- 左右边缘能够自然衔接；
- 图像接近标准等距柱状投影；
- 天空和地面区域结构基本合理；
- 可以完整 360° 浏览。

渲染方式：

- 使用 Pannellum 标准 `equirectangular` 渲染；
- 允许完整 yaw 旋转；
- 可选陀螺仪和自动旋转。

---

### 4.2 `partialSphere`

适用于：

- 图片主体区域适合球面浏览；
- 左右接缝或上下极区存在问题；
- 需要限制可见范围。

渲染方式：

- 使用 Pannellum 部分全景能力；
- 使用 `haov`、`vaov`、`vOffset` 定义实际覆盖角度；
- 使用 `minYaw`、`maxYaw`、`minPitch`、`maxPitch` 限制视角；
- 使用 `minHfov`、`maxHfov` 限制缩放；
- 禁止显示图像范围外区域。

示例配置：

```json
{
  "mode": "partialSphere",
  "projection": {
    "haov": 190,
    "vaov": 82,
    "vOffset": -3
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

---

### 4.3 `curvedPhoto`

适用于：

- 作为普通宽幅照片观看效果较好；
- 放入标准球面后建筑和人物明显扭曲；
- 不需要首尾拼接；
- 需要保留沉浸式转动感。

渲染方式：

- 将图片贴到用户前方的一块可调曲率弧形幕布上；
- 水平方向可弯曲；
- 垂直方向可保持近似平面；
- 左右边缘不循环；
- 到达边界后停止或渐隐；
- 支持有限 yaw、pitch、缩放和陀螺仪。

这是本项目最重要的新模式。

---

### 4.4 `flatPhoto`

适用于：

- 图片局部几何关系混乱；
- AI 幻觉严重；
- 无法通过曲率调整获得自然结果；
- 仍适合作为普通宽幅照片展示。

渲染方式：

- 普通平面图片；
- 支持平移和缩放；
- 可加入轻度视差；
- 可根据鼠标或陀螺仪做小范围移动；
- 不产生球面扭曲。

---

## 5. 整体系统架构

```text
历史照片资源层
    ↓
图像质量评估层
    ↓
场景投影配置层
    ↓
自适应渲染调度层
    ↓
Pannellum / 自定义 WebGL 渲染器
    ↓
热点、音频、档案、说明等交互层
```

### 5.1 历史照片资源层

保存：

- 原始历史照片；
- AI 上色版本；
- AI 扩展版本；
- Web 展示图；
- 缩略图；
- 图片元数据；
- AI 生成说明；
- 投影配置 JSON；
- 可选局部变形配置。

建议目录：

```text
public/
  images/
    history-001/
      original.jpg
      colorized.jpg
      panorama.webp
      thumbnail.webp
      config.json
      warp-grid.json
```

---

### 5.2 图像质量评估层

第一版可以人工评估，后续再加入自动检测。

每张图片建议记录：

```json
{
  "seamScore": 0.82,
  "geometryScore": 0.61,
  "poleScore": 0.35,
  "semanticRisk": 0.28,
  "recommendedMode": "curvedPhoto"
}
```

字段说明：

- `seamScore`：左右接缝连续程度；
- `geometryScore`：整体透视和结构稳定程度；
- `poleScore`：顶部与底部是否适合球面投影；
- `semanticRisk`：明显 AI 幻觉风险；
- `recommendedMode`：推荐浏览模式。

---

### 5.3 场景投影配置层

每张图片单独保存一个场景配置。

完整示例：

```json
{
  "id": "history-001",
  "title": "历史街景示例",
  "source": "/images/history-001/panorama.webp",
  "thumbnail": "/images/history-001/thumbnail.webp",
  "mode": "curvedPhoto",

  "projection": {
    "horizontalSpan": 190,
    "verticalSpan": 78,
    "horizontalCurvature": 0.68,
    "verticalCurvature": 0.18,
    "edgeCompression": 0.12,
    "centerX": 0.48,
    "centerY": 0.51,
    "horizonY": 0.54,
    "edgeMode": "clamp",
    "edgeFeather": 0.025
  },

  "view": {
    "yaw": 0,
    "pitch": 0,
    "hfov": 72,
    "minYaw": -75,
    "maxYaw": 75,
    "minPitch": -20,
    "maxPitch": 24,
    "minHfov": 55,
    "maxHfov": 88
  },

  "warpGrid": "/images/history-001/warp-grid.json",

  "hotspots": [
    {
      "id": "building-01",
      "type": "info",
      "text": "历史建筑说明",
      "imageX": 0.632,
      "imageY": 0.471
    }
  ],

  "metadata": {
    "sourceYear": "待补充",
    "aiColorized": true,
    "aiExpanded": true,
    "disclaimer": "扩展区域由 AI 辅助生成，仅用于沉浸式历史场景展示。"
  }
}
```

---

## 6. 自定义投影参数

### 6.1 `horizontalSpan`

整张图片对应的水平视角范围，单位为度。

建议范围：

```text
100°—240°
```

数值越大：

- 沉浸范围越广；
- 弯曲感越强；
- 边缘越容易扭曲。

数值越小：

- 越接近普通宽幅照片；
- 主体结构越稳定；
- 可转动范围越小。

---

### 6.2 `verticalSpan`

整张图片对应的垂直视角范围。

建议范围：

```text
40°—110°
```

主要用于避免顶部和底部被强制映射到球面极点。

---

### 6.3 `horizontalCurvature`

水平方向曲率。

```text
0 = 完全平面
1 = 标准圆柱式弯曲
```

建议常用范围：

```text
0.35—0.85
```

---

### 6.4 `verticalCurvature`

垂直方向曲率。

```text
0 = 垂直保持平面
1 = 接近标准球面
```

历史建筑和街景建议常用范围：

```text
0—0.35
```

典型目标：

```text
水平明显弯曲
垂直近似平面
```

---

### 6.5 `edgeCompression`

边缘压缩强度，用于减轻左右边缘建筑被横向拉宽。

建议范围：

```text
0—0.4
```

---

### 6.6 `centerX`、`centerY`

定义视觉中心对应的图片坐标，范围为 0—1。

用于处理：

- 主体不在图片中心；
- AI 扩展后构图偏移；
- 需要把某个建筑设为默认正前方。

---

### 6.7 `horizonY`

定义地平线在图片中的垂直位置，范围为 0—1。

错误地平线会造成：

- 场景向上翻起；
- 道路向下坠落；
- 建筑整体倾斜。

---

### 6.8 `edgeMode`

支持：

```text
wrap       左右循环，仅用于真实 360° 图片
clamp      到边缘后停止，AI 图片默认选项
feather    边缘渐隐
mirror     镜像延展
background 边缘外显示模糊背景
```

---

### 6.9 `edgeFeather`

边缘渐隐宽度，范围为 0—0.2。

用于减弱有限视域终点的突兀感。

---

## 7. 投影算法设计

### 7.1 投影模型

渲染器应同时支持：

- 平面投影；
- 圆柱投影；
- 球面投影。

通过参数进行连续混合，而不是只允许离散切换。

伪代码：

```glsl
vec2 flatUV = projectFlat(ray);
vec2 cylinderUV = projectCylinder(ray);
vec2 sphereUV = projectSphere(ray);

vec2 horizontalUV = mix(
    flatUV,
    cylinderUV,
    u_horizontalCurvature
);

vec2 finalUV = mix(
    horizontalUV,
    sphereUV,
    u_verticalCurvature
);
```

解释：

```text
horizontalCurvature = 0
verticalCurvature = 0
→ 普通平面照片

horizontalCurvature = 1
verticalCurvature = 0
→ 水平圆柱弯曲

horizontalCurvature = 1
verticalCurvature = 1
→ 接近标准球面全景
```

---

### 7.2 推荐的实现方式

优先方案：

- 保留 Pannellum 的交互、视角控制、热点和全屏逻辑；
- 增加新的 `adaptive` 或 `curvedPhoto` 渲染类型；
- 在底层 WebGL 着色器中实现自定义 UV 映射；
- 不要重写完整交互系统。

---

### 7.3 边缘压缩函数

可以先采用简单可控函数：

```glsl
float compressEdge(float x, float strength) {
    float centered = x * 2.0 - 1.0;
    float warped = centered / (1.0 + strength * abs(centered));
    return warped * 0.5 + 0.5;
}
```

后续可替换为：

- 幂函数；
- 正切函数；
- 样条曲线；
- 自定义 LUT。

---

### 7.4 地平线修正

在进行垂直投影前，先基于 `horizonY` 对 UV 坐标重新中心化。

伪代码：

```glsl
float centeredY = uv.y - u_horizonY;
centeredY *= u_verticalScale;
uv.y = centeredY + 0.5;
```

---

## 8. 局部变形网格

统一曲率无法解决所有局部透视错误，因此第二阶段应增加局部 UV 校正网格。

建议初始规格：

```text
5 × 3 控制点
```

高级规格：

```text
9 × 5 控制点
```

数据示例：

```json
{
  "columns": 5,
  "rows": 3,
  "points": [
    { "x": 0.00, "y": 0.00, "dx": 0.00, "dy": 0.00 },
    { "x": 0.25, "y": 0.00, "dx": -0.01, "dy": 0.01 },
    { "x": 0.50, "y": 0.00, "dx": 0.00, "dy": 0.00 },
    { "x": 0.75, "y": 0.00, "dx": 0.01, "dy": -0.01 },
    { "x": 1.00, "y": 0.00, "dx": 0.00, "dy": 0.00 }
  ]
}
```

渲染顺序：

```text
观察射线
  ↓
基础投影
  ↓
曲率混合
  ↓
边缘压缩
  ↓
局部 UV 网格变形
  ↓
采样图片纹理
```

局部网格可以改善：

- 某一侧建筑过宽；
- 局部地面弯曲；
- 建筑倾斜；
- 天空与建筑比例失衡；
- 某个区域的透视差异。

不能改善：

- 多余人物或肢体；
- 多出的窗户；
- 错误遮挡关系；
- 完全不一致的场景内容；
- 明显语义幻觉。

---

## 9. Pannellum 修改范围

应基于项目当前使用的 Pannellum 版本建立独立分支。

### 9.1 新增渲染类型

建议：

```javascript
type: "adaptive"
```

或：

```javascript
type: "curvedPhoto"
```

---

### 9.2 修改图像类型校验

当前如果只允许标准类型，需要增加对新类型的识别。

示意：

```javascript
const supportedTypes = [
  "equirectangular",
  "cubemap",
  "multires",
  "adaptive"
];
```

---

### 9.3 新增片元着色器

建议新增：

```javascript
fragAdaptive
```

功能：

- 平面、圆柱、球面混合；
- 水平覆盖角控制；
- 垂直覆盖角控制；
- 水平和垂直曲率分离；
- 边缘压缩；
- 地平线偏移；
- 中心位置偏移；
- 边缘渐隐；
- 局部 UV 网格；
- 越界处理。

---

### 9.4 新增 uniform

```glsl
uniform float u_horizontalSpan;
uniform float u_verticalSpan;
uniform float u_horizontalCurvature;
uniform float u_verticalCurvature;
uniform float u_edgeCompression;
uniform float u_centerX;
uniform float u_centerY;
uniform float u_horizonY;
uniform float u_edgeFeather;
uniform int u_edgeMode;
```

局部网格可使用：

- 数据纹理；
- 位移贴图；
- uniform 数组；
- 顶点网格。

第一版优先选择最简单、最稳定的实现。

---

### 9.5 参数传递

场景 JSON 中的 `projection` 参数应传入底层渲染器。

示意：

```javascript
renderer.render({
  ...cameraState,
  projection: scene.projection
});
```

---

## 10. 渲染调度器

不应让所有模式走同一个渲染路径。

示例：

```javascript
function renderScene(scene) {
  switch (scene.mode) {
    case "sphere360":
      return renderPannellumSphere(scene);

    case "partialSphere":
      return renderPannellumPartial(scene);

    case "curvedPhoto":
      return renderAdaptiveProjection(scene);

    case "flatPhoto":
      return renderFlatPhoto(scene);

    default:
      throw new Error(`Unsupported scene mode: ${scene.mode}`);
  }
}
```

---

## 11. 可视化调参编辑器

必须开发一个内部使用的场景配置工具，否则数百张图片无法高效处理。

### 11.1 页面布局

```text
左侧：实时沉浸式预览
右侧：参数面板
底部：保存、重置、复制预设、导出 JSON
```

### 11.2 参数面板

包括：

- 浏览模式；
- 水平覆盖角；
- 垂直覆盖角；
- 水平曲率；
- 垂直曲率；
- 边缘压缩；
- 地平线；
- 视觉中心；
- 最小和最大 yaw；
- 最小和最大 pitch；
- 默认 hfov；
- 最小和最大 hfov；
- 边缘模式；
- 边缘渐隐；
- 局部网格编辑。

### 11.3 预设

至少提供：

```text
标准 360°
部分球面
建筑街景
轻度弧形
强度弧形
宽幅照片
历史长卷
```

### 11.4 编辑器功能

- 实时预览；
- 参数修改后立即刷新；
- 一键保存 JSON；
- 一键复制其他图片参数；
- 一键恢复默认值；
- 一键切换桌面和移动端预览；
- 预览陀螺仪边界；
- 导出场景配置；
- 导入已有配置；
- 显示当前 UV 和视角信息；
- 显示接缝位置；
- 显示可见范围边界。

---

## 12. 热点系统

标准 Pannellum 热点通常基于 yaw 和 pitch。

对于自定义投影，应优先支持基于图片 UV 坐标的热点。

示例：

```json
{
  "id": "hotspot-01",
  "type": "info",
  "text": "建筑说明",
  "imageX": 0.632,
  "imageY": 0.471
}
```

渲染流程：

```text
图片 UV 坐标
  ↓
基础投影逆变换
  ↓
曲率映射
  ↓
局部网格映射
  ↓
屏幕坐标
```

要求：

- 改变曲率后热点仍附着在原图位置；
- 局部 UV 网格变形后热点同步移动；
- 超出当前视域的热点隐藏；
- 支持点击、悬停、弹窗、音频和场景跳转。

---

## 13. 移动端与陀螺仪

移动端需注意：

- 陀螺仪移动必须受 yaw、pitch 边界约束；
- 到达边界时应平滑减速；
- 不允许突然跳回；
- 图片尺寸应按设备性能加载；
- 高分辨率图片应使用多级资源或切片；
- 弱性能设备自动降低纹理尺寸；
- 页面必须在安全环境下申请传感器权限；
- 用户拒绝权限后仍可触摸拖动浏览。

---

## 14. 图片自动分类建议

第一版人工分类，第二版可加入自动检测。

### 14.1 接缝检测

比较左右边缘一定宽度区域：

- 颜色差异；
- 结构相似度；
- 边缘方向；
- 语义特征。

输出：

```text
seamScore
```

### 14.2 结构稳定检测

检测：

- 建筑直线弯曲程度；
- 垂直线一致性；
- 水平线一致性；
- 地平线位置；
- 人物和车辆异常比例。

输出：

```text
geometryScore
semanticRisk
```

### 14.3 推荐模式规则

示意：

```javascript
if (seamScore > 0.85 && geometryScore > 0.8) {
  mode = "sphere360";
} else if (geometryScore > 0.7) {
  mode = "partialSphere";
} else if (geometryScore > 0.45) {
  mode = "curvedPhoto";
} else {
  mode = "flatPhoto";
}
```

该规则只能作为推荐，最终允许人工覆盖。

---

## 15. 图片问题分类与处理

### A 类：仅接缝有问题

处理：

```text
调整接缝位置
限制 yaw
关闭循环
使用 partialSphere
```

### B 类：边缘扭曲，中心正常

处理：

```text
限制 yaw 和 pitch
减小水平覆盖角
减小垂直覆盖角
限制缩放范围
```

### C 类：宽幅效果好，球面效果差

处理：

```text
使用 curvedPhoto
水平曲率中等
垂直曲率较低
边缘 clamp
```

### D 类：局部透视不一致

处理：

```text
curvedPhoto
局部 UV 网格
隐藏严重区域
必要时局部修图
```

### E 类：语义和空间结构严重错误

处理：

```text
flatPhoto
重新生成
人工修图
不强行沉浸化
```

---

## 16. 开发阶段

### 第一阶段：Pannellum 原生能力验证

目标：不修改源码，验证有限视域能解决多少问题图片。

任务：

- 建立测试页面；
- 支持 `haov`、`vaov`、`vOffset`；
- 支持 yaw、pitch、hfov 限制；
- 支持边界背景规避；
- 为 30 张问题图片建立配置；
- 记录每张图的最佳参数；
- 统计成功率。

验收标准：

- 至少 15 张问题图片可获得可接受的沉浸体验；
- 接缝和极区不会暴露；
- 桌面和移动端均可操作；
- 配置可通过 JSON 保存。

---

### 第二阶段：`curvedPhoto` 原型

目标：实现平面、圆柱、球面之间的连续混合。

任务：

- 新增 `adaptive` 渲染类型；
- 新增自定义片元着色器；
- 支持水平和垂直曲率；
- 支持覆盖角；
- 支持中心和地平线；
- 支持边缘压缩；
- 支持边缘 clamp 和 feather；
- 支持有限视角交互；
- 完成配置加载。

验收标准：

- 宽幅照片在弧形模式下明显比标准球面自然；
- 建筑垂直线和人物比例没有明显额外恶化；
- 左右边缘不会循环拼接；
- 参数变化可实时预览；
- 30 张问题图片中至少 24 张能进入可用模式。

---

### 第三阶段：可视化调参编辑器

目标：让非开发人员也能配置图片。

任务：

- 实时预览；
- 参数滑块；
- 预设管理；
- JSON 导入和导出；
- 图片切换；
- 场景保存；
- 移动端预览；
- 接缝和边界辅助线。

验收标准：

- 单张图片在 2—5 分钟内完成基础配置；
- 无需手工编辑 JSON；
- 参数保存后可直接用于正式浏览页面。

---

### 第四阶段：局部 UV 网格

目标：处理局部透视不一致。

任务：

- 5×3 控制网格；
- 拖动控制点；
- 双线性或样条插值；
- JSON 保存；
- 热点同步变换；
- 支持重置局部点。

验收标准：

- 可对局部建筑倾斜和拉伸进行可控修正；
- 编辑过程中保持实时帧率；
- 热点不发生明显漂移。

---

### 第五阶段：生产化

任务：

- 图片资源压缩；
- 多分辨率加载；
- 缓存；
- 懒加载；
- 错误降级；
- 性能监控；
- 配置版本管理；
- AI 生成说明；
- 无障碍操作；
- 自动分类辅助。

---

## 17. 性能要求

建议目标：

- 桌面端维持流畅交互；
- 中端移动设备保持可接受帧率；
- 单张展示图片优先使用 WebP 或 AVIF；
- 自动选择 2K、4K、8K 纹理；
- 超大图片采用多分辨率切片；
- 切换场景时显示渐进式预览；
- 避免一次加载大量原图；
- GPU 不支持时自动降级到 `flatPhoto`。

---

## 18. 错误处理

系统应处理：

- 图片加载失败；
- 配置缺失；
- 配置字段非法；
- WebGL 不可用；
- 纹理尺寸超限；
- 陀螺仪权限被拒绝；
- 局部网格文件缺失；
- 投影产生 UV 越界；
- 热点坐标越界。

降级顺序：

```text
sphere360
  ↓
partialSphere
  ↓
curvedPhoto
  ↓
flatPhoto
  ↓
普通静态图片
```

---

## 19. 测试要求

### 19.1 单元测试

覆盖：

- 配置解析；
- 默认参数；
- 参数边界；
- 模式切换；
- 投影函数；
- UV 越界处理；
- 热点坐标变换；
- 降级逻辑。

### 19.2 视觉回归测试

建立固定测试图片集：

- 标准全景；
- 接缝错误；
- 边缘扭曲；
- 极区扭曲；
- 宽幅建筑；
- 人物街景；
- 局部透视错误。

每次修改后保存固定视角截图进行对比。

### 19.3 设备测试

至少覆盖：

- Chrome 桌面端；
- Edge 桌面端；
- Safari；
- Android Chrome；
- iPhone / iPad Safari；
- 触摸操作；
- 陀螺仪；
- 横屏和竖屏。

---

## 20. 非目标

第一版不要求：

- 自动修复 AI 语义幻觉；
- 自动生成真实深度图；
- 自动恢复真实三维空间；
- 支持完整 VR 立体双目；
- 自动把普通图片转成几何正确的 360° 全景；
- 自动判断历史真实性。

系统目标是优化展示，不是证明 AI 扩展区域具有真实历史依据。

---

## 21. 最终验收标准

项目完成后应满足：

1. 一套页面可以统一浏览四种模式的图片；
2. 每张图片可独立配置；
3. 标准图片继续使用 Pannellum 正常显示；
4. 问题图片可以限制视角；
5. 宽幅图片可以使用可调弧形投影；
6. 左右边缘可关闭循环；
7. 水平和垂直曲率可分别调整；
8. 地平线和视觉中心可调；
9. 支持边缘压缩和渐隐；
10. 支持热点；
11. 支持移动端；
12. 配置可视化编辑并保存；
13. 渲染失败时自动降级；
14. 30 张问题图片中至少 80% 达到可接受展示效果；
15. 页面明确标注 AI 扩展内容的展示属性。

---

# 22. 推荐项目结构

```text
src/
  core/
    scene-loader.ts
    scene-validator.ts
    render-router.ts
    projection-types.ts

  pannellum/
    pannellum-adapter.ts
    partial-sphere-renderer.ts

  adaptive/
    adaptive-renderer.ts
    projection-math.ts
    shader-source.ts
    edge-modes.ts
    warp-grid.ts

  flat/
    flat-photo-renderer.ts

  hotspots/
    hotspot-manager.ts
    uv-to-screen.ts

  editor/
    editor-app.ts
    parameter-panel.ts
    preview-controller.ts
    preset-manager.ts
    config-exporter.ts

  schemas/
    scene.schema.json
    warp-grid.schema.json

  tests/
    projection.test.ts
    config.test.ts
    hotspot.test.ts

public/
  images/
  configs/
  presets/
```

---

# 23. 第一轮 Codex 开发任务

下面内容可以直接复制给 Codex。

```text
请在当前项目中实现“第一阶段：Pannellum 原生有限视域验证”。

目标：
1. 建立一个可加载场景 JSON 的历史照片浏览页面；
2. 支持 sphere360 和 partialSphere 两种模式；
3. partialSphere 模式需支持 haov、vaov、vOffset、minYaw、maxYaw、minPitch、maxPitch、minHfov、maxHfov；
4. 支持关闭自动旋转；
5. 支持防止显示图片范围外背景；
6. 支持桌面鼠标、触摸和全屏；
7. 配置错误时显示明确错误信息；
8. 提供至少两个示例场景；
9. 保持代码模块化，为后续 adaptive / curvedPhoto 渲染类型预留接口。

请先：
- 阅读现有项目结构；
- 找到 Pannellum 的初始化入口；
- 说明你准备修改或新增哪些文件；
- 给出实现步骤；
- 然后直接开始编码，不要只输出方案。

代码要求：
- 使用 TypeScript；
- 为场景配置定义明确类型；
- 对 JSON 配置做运行时校验；
- 不把所有逻辑写在单个文件；
- 保留错误处理；
- 添加必要注释；
- 完成后给出运行方法、测试方法和已知限制。
```

---

# 24. 第二轮 Codex 开发任务

```text
请在现有项目中新增 curvedPhoto / adaptive 渲染原型。

目标：
1. 新增 adaptive 场景类型；
2. 保留现有 Pannellum 交互层；
3. 新增 WebGL 片元着色器；
4. 实现平面、圆柱、球面三种 UV 投影；
5. 通过 horizontalCurvature 和 verticalCurvature 连续混合；
6. 支持 horizontalSpan、verticalSpan；
7. 支持 centerX、centerY、horizonY；
8. 支持 edgeCompression；
9. 支持 edgeMode=clamp 和 feather；
10. 支持 minYaw、maxYaw、minPitch、maxPitch、minHfov、maxHfov；
11. 提供一个可实时调参的最小演示面板；
12. 保持 sphere360 和 partialSphere 兼容。

实现前请先定位 Pannellum 底层渲染器和着色器代码，说明准备采用继承、适配器还是独立渲染模块。优先减少对上游源码的侵入，方便后续同步更新。

完成后请提供：
- 修改文件列表；
- 核心投影公式；
- 配置示例；
- 启动方法；
- 测试方法；
- 已知限制。
```

---

# 25. 第三轮 Codex 开发任务

```text
请为 adaptive / curvedPhoto 渲染器开发可视化调参编辑器。

要求：
1. 左侧实时预览，右侧参数面板；
2. 支持模式切换；
3. 支持水平和垂直覆盖角；
4. 支持水平和垂直曲率；
5. 支持边缘压缩；
6. 支持中心位置和地平线；
7. 支持 yaw、pitch、hfov 范围；
8. 支持 edgeMode 和 edgeFeather；
9. 支持预设；
10. 支持导入和导出 JSON；
11. 支持恢复默认值；
12. 支持复制当前配置；
13. 支持桌面和移动端预览尺寸；
14. 参数修改后实时更新，不刷新页面；
15. 配置结构需与正式浏览页面完全一致。

请采用模块化组件设计，不要把状态、渲染器和表单逻辑混在一起。完成后补充基本测试。
```

---

## 26. 项目一句话定义

> 构建一个能够在平面、圆柱、部分球面和完整球面之间连续变化，并支持每张 AI 历史照片独立校正的 Web 沉浸式渲染器。
