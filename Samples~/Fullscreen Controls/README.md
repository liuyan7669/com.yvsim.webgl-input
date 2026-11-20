# Fullscreen Controls Sample

1. 在 Package Manager 中展开 **WebGL Input > Samples**，导入 **Fullscreen Controls**。
2. 把 `WebGLInputFullscreenExample` 挂到场景中的任意 GameObject。
3. 给 UI Button 的 `OnClick` 直接绑定下列任一方法：
   - `ToggleFullscreen()`
   - `ToggleFullscreenWithSetResolution()`
   - `ToggleFullscreenWithSetResolutionMode()`
4. 构建并通过 HTTP/HTTPS 打开 WebGL Player，在窗口与全屏之间往返验证中文输入、双向框选和快捷键。

浏览器要求全屏调用直接发生在用户点击事件中。不要在 Button 回调后再等待协程、Task、计时器或下一帧才请求全屏。
