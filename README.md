# WebGL Input

为桌面 Unity WebGL 的 `TMP_InputField` 与 uGUI `InputField` 提供浏览器输入桥，
覆盖中文 IME composition、纯文本剪贴板、选区同步、方向键编辑与全屏输入。
运行时自动初始化，无需在场景挂脚本或修改 WebGL 模板。

## 安装与依赖

当前源码版本为 **1.0.0**。Unity 最低版本为 **2021.3**。安装本地源码时：

1. 在 Package Manager 选择 **Add package from disk**，选择本包 `com.yvsim.webgl-input/package.json`。
2. 等待 Unity 完成依赖解析和编译。也可将本包完整目录放入工程的 `Packages/`，作为 Embedded Package。

本包不依赖 Inspector Groups 或其他 Yvsim 包。所需 Unity 依赖由 `package.json` 声明并由 UPM 解析。
本包提供本地源码、Git 和 OpenUPM 安装方式；固定版本使用 `1.0.0`，具体步骤见下文。

本包通过反射访问 TMP/uGUI，不强制安装这两个 UI 包。项目需自行使用至少一种受支持的输入框，并安装相应 UI 包和字体。
本包最低支持 Unity 2021.3；更高版本仍需检查反射与 WebGL 模板行为。

## 场景条件

1. 使用 TMP_InputField 或 UnityEngine.UI.InputField，并确保文本字体覆盖需要的字符。
2. 场景包含 EventSystem；拖选恢复针对 **StandaloneInputModule**，Active Input Handling 使用 **Input Manager (Old)** 或 **Both**。
3. 构建 WebGL，通过 HTTP/HTTPS 服务器运行，点击输入框后使用系统输入法测试。

输入框必须激活、启用、可交互、非只读并拥有 EventSystem 焦点，自动桥才启用。
Editor Play Mode 不运行浏览器桥，即使 Build Target 为 WebGL；编辑器输入成功不能证明 WebGL 中文输入已经通过。
仅新 Input System、InputSystemUIInputModule、自定义 InputModule 和移动浏览器未作为完整兼容目标。

## 功能与边界

- 支持 composition 组合输入、候选确认、文本与 UTF-16 选区同步，跨 JS/C# 文本使用 UTF-8。
- 处理 Ctrl/Cmd+A/C/X/V/Z/Y、方向键、浏览器纯文本复制/粘贴及三种 Line Type 的 Enter 行为。
- 修正正/反向鼠标框选及释放恢复；页面失焦、拖出 Canvas、pointercancel 也进入恢复逻辑。
- 输入会话临时关闭 `UnityEngine.WebGLInput.captureAllKeyboardInput`，结束后恢复原值；同时退出 Pointer Lock。
- 不支持 UI Toolkit TextField、图片/文件/HTML/RTF 剪贴板，也不提供后台任意读取系统剪贴板的接口。
- 不改变网页其他 HTML 输入框的原生行为。非 WebGL Player 不加载浏览器 JS 桥。

字体缺少字形时仍会显示方框，应给 TMP 配置字符覆盖与 fallback。
密码输入同样经过浏览器代理与 WebGL 内存；业务自行决定复制、存储和传输策略。

## 全屏

从真实按钮点击的同步调用直接使用 Unity 全屏入口：

```csharp
Screen.fullScreen = !Screen.fullScreen;
Screen.SetResolution(Screen.width, Screen.height, true);
Screen.SetResolution(Screen.width, Screen.height, FullScreenMode.FullScreenWindow);
```

桥在全屏期间用临时 wrapper 容纳 Canvas 与输入代理，并按绘制缓冲区宽高比调整 Canvas CSS 盒，退出或失败后恢复。
不要在等待协程、Task 或下一帧之后才请求全屏。iframe 需允许全屏；自定义模板 CSS、缩放和父节点依赖需单独验收。
直接让任意 HTML 节点全屏不属于本包保证的 Unity 入口。游戏若需恢复 Pointer Lock，应结束文本编辑后从新用户手势申请。

## 公开 API

```csharp
using Yvsim.WebGLInput;

bool browserAvailable = WebGLClipboardPasteBridge.IsAvailable;
bool editing = WebGLClipboardPasteBridge.IsBrowserTextInputActive;
bool inserted = WebGLClipboardPasteBridge.TryPasteIntoFocusedInput("示例文字");
bool selected = WebGLClipboardPasteBridge.TryGetSelectedText(out string selection);
```

`IsAvailable` 仅在 WebGL Player 为 true。纯 C# 的文本插入/选区 API 可在其他平台显式调用：

| API | 行为 |
| --- | --- |
| `TryPasteIntoFocusedInput(value)` | 写入当前 EventSystem 选中、已聚焦且可用的输入框 |
| `PasteIntoInput(component, value)` | 强制写入指定 TMP/uGUI 输入框；不要求聚焦/激活/Interactable，拒绝 readOnly/null |
| `TryGetSelectedText(out value)` | 获取当前聚焦输入框的非空选区 |
| `TryGetSelectedText(component, out value)` | 获取指定受支持输入框的非空选区 |

`PasteIntoInput` 不是模拟按键，业务的自定义字符验证、长度限制和过滤应在调用前完成。

## 示例与回归

从 Package Manager 导入 **Fullscreen Controls**。示例只提供可绑定 Button 的三个全屏方法，
没有预制输入场景；将组件挂到对象并配置按钮，再在现有 TMP/uGUI 场景中验证。

包根目录执行 JavaScript 事件测试（需要 Node.js，无 npm 依赖）：

```powershell
node "Tests~/JavaScript/YvsimWebGLInputJslibTests.cjs"
```

Unity EditMode 测试需要 Test Framework、uGUI 和 TMP，并把 `com.yvsim.webgl-input` 加入项目 manifest 的 `testables`。
测试覆盖纯文本编辑、选区、输入事件和桥接边界；真实浏览器仍需检查中文组合、候选确认、复制/粘贴、双向拖选、
拖出释放、Ctrl/Cmd、三种 Line Type，以及窗口/全屏切换。浏览器、Unity 大版本、模板或输入法变化后重新验收。

## 故障排查

英文可输入但中文不行：确认实际 WebGL Player、焦点与组件状态、构建包含 YvsimWebGLInput.jslib，并查看浏览器控制台。
中文显示方框：先核对复制出的实际文字，再检查字体。
全屏或框选偏移：检查 iframe 权限及 Canvas 的 width/height、object-fit、transform、父容器 CSS 和系统 DPI。
松开后仍拖选：确认 StandaloneInputModule 与旧输入系统可用，没有透明 HTML 元素截获鼠标事件。

## 许可证

代码使用 MIT License。

## 从 GitHub 安装

仓库：[com.yvsim.webgl-input](https://github.com/liuyan7669/com.yvsim.webgl-input)。仓库名与 UPM 包名一致。

在 Unity Package Manager 选择 Add package from git URL，输入：

```text
https://github.com/liuyan7669/com.yvsim.webgl-input.git#main
```

此地址跟随 main 分支。需要固定 1.0.0 源码时，将 `#main` 改为 `#v1.0.0`；Unity 官方依赖仍按 package.json 解析。

## 从 OpenUPM 安装

在 Unity 的 Project Settings > Package Manager 中添加 Scoped Registry：

- Name：OpenUPM
- URL：`https://package.openupm.com`
- Scope：`com.yvsim`

然后在 Package Manager 中通过 Add package by name 输入 `com.yvsim.webgl-input`，版本填 `1.0.0`。也可从 My Registries 中选择本包。声明的 Yvsim 依赖由 OpenUPM 解析，Unity 官方依赖仍由 Unity 注册表提供。

如果已安装 OpenUPM CLI，可在工程根目录执行：

```sh
openupm add com.yvsim.webgl-input@1.0.0
```

[OpenUPM 包页面](https://openupm.com/packages/com.yvsim.webgl-input/)
