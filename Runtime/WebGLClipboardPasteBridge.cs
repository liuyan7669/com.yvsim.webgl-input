using System;
using System.Collections;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using AOT;
using UnityEngine;
using UnityEngine.Scripting;

[assembly: AlwaysLinkAssembly]

namespace Yvsim.WebGLInput
{
    /// <summary>
    /// Unity WebGL 浏览器文本输入桥。
    /// WebGL Player 会自动初始化；Editor 和其他 Player 保持 Unity 原生输入行为。
    /// UGUI InputField 和 TMP_InputField 都使用运行时反射适配，因此不同 Unity 版本未安装其中一个 UI 包时也能编译。
    /// </summary>
    [Preserve]
    public static class WebGLClipboardPasteBridge
    {
        private static readonly UTF8Encoding StrictUtf8 = new UTF8Encoding(false, true);
        private static readonly Vector3[] InputWorldCorners = new Vector3[4];
        private const int SingleLineMode = 0;
        private const int MultiLineSubmitMode = 1;
        private const int MultiLineNewlineMode = 2;
        private const int ShiftModifierFlag = 1 << 0;
        private const int ControlModifierFlag = 1 << 1;
        private const int AltModifierFlag = 1 << 2;
        private const int CommandModifierFlag = 1 << 3;
        private const int MinimumCaretWidth = 3;
#pragma warning disable 0414 // Read only in the WebGL Player branch; Editor tests still inspect the queued state.
        private static bool pointerReleaseRecoveryPending;
        private static bool pointerCancelRecoveryPending;
#pragma warning restore 0414
        private static bool pointerDownAnchorPending;
        private static Vector2 pointerDownScreenPosition;
        // 浏览器 mouseup 通常在下一次 Unity 渲染帧才被 StandaloneInputModule 消费。
        // 补发 Released 前必须留出这个窗口，否则补发会和 Unity 原生释放双重执行：
        // 快速点击会产生两次 PointerClick → ActivateInputField → onFocusSelectAll 全选，
        // 表现为拖选/选区错乱、候选框位置跳动（用户反馈的"框选有问题、不稳定"）。
        private const int DeferredReleaseConfirmFrames = 2;
        private static int pointerReleaseMissedFrameCount;
        // 被插件抬高过 caretWidth 的输入框及其原值，会话结束或切换目标时精确恢复。
        private static Component caretWidthOwner;
        private static int originalCaretWidth;

#if UNITY_WEBGL && !UNITY_EDITOR
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int PasteCallback(IntPtr utf8Bytes, int byteLength);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int CopyCallback();

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate void TextInputChangedCallback(
            IntPtr utf8Bytes,
            int byteLength,
            int selectionAnchor,
            int selectionFocus,
            int selectionAuthoritative);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int NavigationCallback(int direction, int shift, int controlOrMeta);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int EnterKeyCallback(int keypadEnter, int modifierFlags);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int PointerReleaseCallback();

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int PointerCancelCallback();

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int PointerDownCallback(int screenX, int screenY, int shift, int clickCount);

        private static readonly PasteCallback BrowserPasteCallback = OnBrowserPaste;
        private static readonly CopyCallback BrowserCopyCallback = OnBrowserCopy;
        private static readonly TextInputChangedCallback BrowserTextInputChangedCallback = OnBrowserTextInputChanged;
        private static readonly NavigationCallback BrowserNavigationCallback = OnBrowserNavigation;
        private static readonly EnterKeyCallback BrowserEnterKeyCallback = OnBrowserEnterKey;
        private static readonly PointerReleaseCallback BrowserPointerReleaseCallback =
            OnBrowserPointerRelease;
        private static readonly PointerCancelCallback BrowserPointerCancelCallback =
            OnBrowserPointerCancel;
        private static readonly PointerDownCallback BrowserPointerDownCallback = OnBrowserPointerDown;

        private static bool isRegistered;
        private static TextInputTarget activeInput;
        private static string lastSyncedText;
        private static int lastSyncedAnchor = -1;
        private static int lastSyncedFocus = -1;
        private static int lastSyncedLineMode = -1;
        private static Rect lastSyncedScreenRect;
        private static int lastScreenWidth;
        private static int lastScreenHeight;

        [DllImport("__Internal")]
        private static extern void YvsimWebGLInput_RegisterClipboardCallbacks(
            PasteCallback pasteCallback,
            CopyCallback copyCallback);

        [DllImport("__Internal")]
        private static extern void YvsimWebGLInput_RegisterTextInputCallback(TextInputChangedCallback callback);

        [DllImport("__Internal")]
        private static extern void YvsimWebGLInput_RegisterNavigationCallback(NavigationCallback callback);

        [DllImport("__Internal")]
        private static extern void YvsimWebGLInput_RegisterEnterKeyCallback(EnterKeyCallback callback);

        [DllImport("__Internal")]
        private static extern void YvsimWebGLInput_RegisterPointerReleaseCallback(
            PointerReleaseCallback callback);

        [DllImport("__Internal")]
        private static extern void YvsimWebGLInput_RegisterPointerCancelCallback(
            PointerCancelCallback callback);

        [DllImport("__Internal")]
        private static extern void YvsimWebGLInput_RegisterPointerDownCallback(
            PointerDownCallback callback);

        [DllImport("__Internal")]
        private static extern void YvsimWebGLInput_SetCopyText(byte[] utf8Bytes, int byteLength);

        [DllImport("__Internal")]
        private static extern void YvsimWebGLInput_BeginTextInput(
            byte[] utf8Bytes,
            int byteLength,
            int selectionAnchor,
            int selectionFocus,
            int lineMode,
            float screenX,
            float screenY,
            float screenWidth,
            float screenHeight,
            int unityScreenWidth,
            int unityScreenHeight);

        [DllImport("__Internal")]
        private static extern void YvsimWebGLInput_UpdateTextInput(
            byte[] utf8Bytes,
            int byteLength,
            int selectionAnchor,
            int selectionFocus,
            int lineMode,
            float screenX,
            float screenY,
            float screenWidth,
            float screenHeight,
            int unityScreenWidth,
            int unityScreenHeight);

        [DllImport("__Internal")]
        private static extern void YvsimWebGLInput_EndTextInput();

        [DllImport("__Internal")]
        private static extern void YvsimWebGLInput_EnsureTextInputFocus();

        [DllImport("__Internal")]
        private static extern void YvsimWebGLInput_CompletePointerInteraction();
#endif

        /// <summary>
        /// 当前平台是否启用了浏览器文本输入桥。
        /// </summary>
        public static bool IsAvailable
        {
            get
            {
#if UNITY_WEBGL && !UNITY_EDITOR
                return true;
#else
                return false;
#endif
            }
        }

        /// <summary>
        /// WebGL 中是否正在使用浏览器原生 input/textarea 接收键盘和输入法事件。
        /// </summary>
        public static bool IsBrowserTextInputActive
        {
            get
            {
#if UNITY_WEBGL && !UNITY_EDITOR
                return activeInput != null && activeInput.IsAlive;
#else
                return false;
#endif
            }
        }

#if UNITY_2019_3_OR_NEWER
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        [Preserve]
        private static void ResetStaticState()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            isRegistered = false;
            pointerReleaseRecoveryPending = false;
            pointerCancelRecoveryPending = false;
            pointerDownAnchorPending = false;
            pointerDownScreenPosition = Vector2.zero;
            pointerReleaseMissedFrameCount = 0;
            WebGLKeyboardCapture.Forget();
            ClearActiveInputState();
#endif
        }
#endif

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        [Preserve]
        private static void Initialize()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            if (isRegistered)
            {
                return;
            }

            YvsimWebGLInput_RegisterClipboardCallbacks(BrowserPasteCallback, BrowserCopyCallback);
            YvsimWebGLInput_RegisterTextInputCallback(BrowserTextInputChangedCallback);
            YvsimWebGLInput_RegisterNavigationCallback(BrowserNavigationCallback);
            YvsimWebGLInput_RegisterEnterKeyCallback(BrowserEnterKeyCallback);
            YvsimWebGLInput_RegisterPointerReleaseCallback(BrowserPointerReleaseCallback);
            YvsimWebGLInput_RegisterPointerCancelCallback(BrowserPointerCancelCallback);
            YvsimWebGLInput_RegisterPointerDownCallback(BrowserPointerDownCallback);
            isRegistered = true;

            GameObject driverObject = new GameObject("Yvsim WebGL Input Runtime");
            driverObject.hideFlags = HideFlags.HideInHierarchy | HideFlags.DontSave;
            UnityEngine.Object.DontDestroyOnLoad(driverObject);
            driverObject.AddComponent<WebGLInputRuntimeDriver>();
            driverObject.AddComponent<WebGLPointerReleaseRuntimeDriver>();
#endif
        }

        private static void QueueBrowserPointerReleaseRecovery()
        {
            pointerReleaseRecoveryPending = true;
            pointerReleaseMissedFrameCount = 0;
        }

        private static void QueueBrowserPointerCancelRecovery()
        {
            pointerCancelRecoveryPending = true;
            pointerReleaseMissedFrameCount = 0;
        }

#if UNITY_WEBGL && !UNITY_EDITOR
        [MonoPInvokeCallback(typeof(PasteCallback))]
        [Preserve]
        private static int OnBrowserPaste(IntPtr utf8Bytes, int byteLength)
        {
            try
            {
                string value = DecodeUtf8(utf8Bytes, byteLength);
                return TryPasteIntoFocusedInput(value) ? 1 : 0;
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
                return 0;
            }
        }

        [MonoPInvokeCallback(typeof(CopyCallback))]
        [Preserve]
        private static int OnBrowserCopy()
        {
            try
            {
                string value;
                if (!TryGetSelectedText(out value))
                {
                    return 0;
                }

                byte[] utf8Bytes = StrictUtf8.GetBytes(value);
                YvsimWebGLInput_SetCopyText(utf8Bytes, utf8Bytes.Length);
                return 1;
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
                return 0;
            }
        }

        [MonoPInvokeCallback(typeof(TextInputChangedCallback))]
        [Preserve]
        private static void OnBrowserTextInputChanged(
            IntPtr utf8Bytes,
            int byteLength,
            int selectionAnchor,
            int selectionFocus,
            int selectionAuthoritative)
        {
            try
            {
                string value = DecodeUtf8(utf8Bytes, byteLength);
                ApplyBrowserTextInput(
                    value,
                    selectionAnchor,
                    selectionFocus,
                    selectionAuthoritative != 0);
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
            }
        }

        [MonoPInvokeCallback(typeof(NavigationCallback))]
        [Preserve]
        private static int OnBrowserNavigation(int direction, int shift, int controlOrMeta)
        {
            try
            {
                if (activeInput == null || !activeInput.IsAlive || !activeInput.IsFocused)
                {
                    return 0;
                }

                if (!activeInput.TryMoveCaret(direction, shift != 0, controlOrMeta != 0))
                {
                    return 0;
                }

                InvalidateSyncedSelection();
                return 1;
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
                return 0;
            }
        }

        [MonoPInvokeCallback(typeof(EnterKeyCallback))]
        [Preserve]
        private static int OnBrowserEnterKey(int keypadEnter, int modifierFlags)
        {
            try
            {
                if (activeInput == null || !activeInput.IsAlive || !activeInput.IsFocused)
                {
                    return 0;
                }

                bool finished;
                if (!activeInput.TryProcessEnterKey(keypadEnter != 0, modifierFlags, out finished))
                {
                    return 0;
                }

                if (finished || activeInput == null || !activeInput.IsAlive || !activeInput.IsFocused)
                {
                    EndBrowserTextInput();
                }
                else
                {
                    SynchronizeBrowserTextInput(false);
                }

                return 1;
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
                return 0;
            }
        }

        [MonoPInvokeCallback(typeof(PointerReleaseCallback))]
        [Preserve]
        private static int OnBrowserPointerRelease()
        {
            try
            {
                // JavaScript only invokes this callback for a primary-left pointer
                // session that began while browser text input was active. The Unity
                // input field may already have lost focus because this click selected
                // another control, so do not require activeInput here.
                QueueBrowserPointerReleaseRecovery();
                return 1;
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
                return 0;
            }
        }

        [MonoPInvokeCallback(typeof(PointerCancelCallback))]
        [Preserve]
        private static int OnBrowserPointerCancel()
        {
            try
            {
                // 手势被中断，浏览器不会补发 click，Unity 只需丢弃残留的按下和拖拽状态。
                QueueBrowserPointerCancelRecovery();
                return 1;
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
                return 0;
            }
        }

        [MonoPInvokeCallback(typeof(PointerDownCallback))]
        [Preserve]
        private static int OnBrowserPointerDown(
            int screenX,
            int screenY,
            int shift,
            int clickCount)
        {
            try
            {
                // Shift+拖动会沿用 Unity 现有 anchor，只改变 focus；双击拖动则沿用
                // TMP/UGUI 的选词语义。两者都不能按普通拖动重建锚点。
                if (shift != 0 || clickCount > 1)
                {
                    pointerDownAnchorPending = false;
                    return 0;
                }

                pointerDownScreenPosition = new Vector2(screenX, screenY);
                pointerDownAnchorPending = true;
                return 1;
            }
            catch (Exception exception)
            {
                pointerDownAnchorPending = false;
                Debug.LogException(exception);
                return 0;
            }
        }

        internal static void UpdateBrowserTextInput()
        {
            TextInputTarget selectedInput;
            if (!TryResolveSelectedInput(out selectedInput) || !selectedInput.IsFocused)
            {
                if (activeInput != null)
                {
                    EndBrowserTextInput();
                }

                return;
            }

            bool inputChanged = activeInput == null || !activeInput.Represents(selectedInput.Component);
            if (inputChanged)
            {
                RestoreOriginalCaretWidth();
                activeInput = selectedInput;
                lastSyncedText = null;
                lastSyncedAnchor = -1;
                lastSyncedFocus = -1;
            }
            else
            {
                activeInput = selectedInput;
            }

            string text = activeInput.Text;
            int anchor = activeInput.SelectionAnchor;
            int focus = activeInput.SelectionFocus;
            activeInput.EnsureVisibleCaret();
            anchor = activeInput.SelectionAnchor;
            focus = activeInput.SelectionFocus;
            int lineMode = activeInput.LineMode;
            Rect screenRect = GetScreenRect(activeInput.RectTransform);
            int screenWidth = Mathf.Max(Screen.width, 1);
            int screenHeight = Mathf.Max(Screen.height, 1);

            bool stateChanged = inputChanged || text != lastSyncedText || anchor != lastSyncedAnchor ||
                                focus != lastSyncedFocus || lineMode != lastSyncedLineMode ||
                                !Approximately(screenRect, lastSyncedScreenRect) ||
                                screenWidth != lastScreenWidth || screenHeight != lastScreenHeight;
            if (!stateChanged)
            {
                WebGLKeyboardCapture.Suppress();
                YvsimWebGLInput_EnsureTextInputFocus();
                return;
            }

            SynchronizeBrowserTextInput(inputChanged);
        }

        internal static void RecoverPendingBrowserPointerRelease()
        {
            if (pointerCancelRecoveryPending)
            {
                // 中断优先于释放：手势已经作废，不能再补一次 PointerClick。
                // 浏览器已经确认指针作废，因此这里不看 Input.GetMouseButton(0)。
                pointerCancelRecoveryPending = false;
                pointerReleaseRecoveryPending = false;
                pointerReleaseMissedFrameCount = 0;
                EventSystemReflection.TryCancelPointerPress();
                CompleteBrowserPointerInteraction();
                return;
            }

            if (!pointerReleaseRecoveryPending)
            {
                return;
            }

            if (DeferPointerReleaseRecovery(Input.GetMouseButton(0)))
            {
                // 这一帧先不补发：给 Unity 原生 mouseup 消费留出窗口。
                return;
            }

            pointerReleaseRecoveryPending = false;
            pointerReleaseMissedFrameCount = 0;
            EventSystemReflection.TryRecoverMissedPointerRelease(false);
            CompleteBrowserPointerInteraction();
        }

        internal static void StabilizePendingBrowserPointerDownAnchor()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            if (!pointerDownAnchorPending)
            {
                return;
            }

            if (!Input.GetMouseButton(0) &&
                !pointerReleaseRecoveryPending &&
                !pointerCancelRecoveryPending)
            {
                // 没有文本输入会话的普通 Canvas 手势不会进入 release 握手；
                // 鼠标已松开时在这里清理，避免待处理坐标泄漏到后续手势。
                pointerDownAnchorPending = false;
                return;
            }

            TextInputTarget selectedInput;
            if (!TryResolveSelectedInput(out selectedInput) || !selectedInput.IsFocused)
            {
                return;
            }

            // 等 StandaloneInputModule 真正进入 drag 后再修正。普通点击、双击和长按
            // 不会走这里，因此仍完全保留 TMP/UGUI 自己的点击与选词语义。
            if (!selectedInput.TryStabilizePointerDownAnchor(pointerDownScreenPosition))
            {
                return;
            }

            pointerDownAnchorPending = false;
            InvalidateSyncedSelection();
#endif
        }

        private static void CompleteBrowserPointerInteraction()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            pointerDownAnchorPending = false;
            // Unity 已经消费或补齐最终释放状态。先把最终文本和 anchor/focus
            // 单向写回浏览器代理，再允许代理恢复焦点并重新成为键盘选区权威。
            if (activeInput != null && activeInput.IsAlive && activeInput.IsFocused)
            {
                SynchronizeBrowserTextInput(false);
            }

            YvsimWebGLInput_CompletePointerInteraction();
#endif
        }

        private static void SynchronizeBrowserTextInput(bool begin)
        {
            if (activeInput == null || !activeInput.IsAlive || !activeInput.IsFocused)
            {
                return;
            }

            string text = activeInput.Text;
            int anchor = activeInput.SelectionAnchor;
            int focus = activeInput.SelectionFocus;
            int lineMode = activeInput.LineMode;
            Rect screenRect = GetScreenRect(activeInput.RectTransform);
            int screenWidth = Mathf.Max(Screen.width, 1);
            int screenHeight = Mathf.Max(Screen.height, 1);
            byte[] utf8Bytes = StrictUtf8.GetBytes(text);
            if (begin)
            {
                YvsimWebGLInput_BeginTextInput(
                    utf8Bytes,
                    utf8Bytes.Length,
                    anchor,
                    focus,
                    lineMode,
                    screenRect.x,
                    screenRect.y,
                    screenRect.width,
                    screenRect.height,
                    screenWidth,
                    screenHeight);
            }
            else
            {
                YvsimWebGLInput_UpdateTextInput(
                    utf8Bytes,
                    utf8Bytes.Length,
                    anchor,
                    focus,
                    lineMode,
                    screenRect.x,
                    screenRect.y,
                    screenRect.width,
                    screenRect.height,
                    screenWidth,
                    screenHeight);
            }

            WebGLKeyboardCapture.Suppress();
            RememberSyncedState(text, anchor, focus, lineMode, screenRect, screenWidth, screenHeight);
        }

        private static void ApplyBrowserTextInput(
            string value,
            int selectionAnchor,
            int selectionFocus,
            bool selectionAuthoritative)
        {
            if (activeInput == null || !activeInput.IsAlive || !activeInput.IsFocused)
            {
                return;
            }

            string appliedValue = activeInput.IsSingleLine ? RemoveLineBreaks(value) : value;
            if (activeInput.Text != appliedValue)
            {
                activeInput.Text = appliedValue;
            }

            if (selectionAuthoritative)
            {
                int textLength = activeInput.Text.Length;
                activeInput.SelectionAnchor = Mathf.Clamp(selectionAnchor, 0, textLength);
                activeInput.SelectionFocus = Mathf.Clamp(selectionFocus, 0, textLength);
            }
            activeInput.RefreshLabel();

            // 输入组件可能应用字符限制或验证规则，下一帧把实际接受值重新同步给浏览器。
            InvalidateSyncedSelection();
        }

        private static void InvalidateSyncedSelection()
        {
            lastSyncedText = null;
            lastSyncedAnchor = -1;
            lastSyncedFocus = -1;
        }

        private static void RememberSyncedState(
            string text,
            int anchor,
            int focus,
            int lineMode,
            Rect screenRect,
            int screenWidth,
            int screenHeight)
        {
            lastSyncedText = text;
            lastSyncedAnchor = anchor;
            lastSyncedFocus = focus;
            lastSyncedLineMode = lineMode;
            lastSyncedScreenRect = screenRect;
            lastScreenWidth = screenWidth;
            lastScreenHeight = screenHeight;
        }

        private static void EndBrowserTextInput()
        {
            YvsimWebGLInput_EndTextInput();
            RestoreOriginalCaretWidth();
            WebGLKeyboardCapture.Restore();
            ClearActiveInputState();
        }

        /// <summary>
        /// 驱动对象被销毁（应用退出、桥被卸载）时收尾，确保业务配置不被插件残留改动。
        /// </summary>
        internal static void ShutdownBrowserTextInput()
        {
            if (activeInput != null)
            {
                EndBrowserTextInput();
                return;
            }

            RestoreOriginalCaretWidth();
            WebGLKeyboardCapture.Restore();
        }

        private static void ClearActiveInputState()
        {
            activeInput = null;
            caretWidthOwner = null;
            originalCaretWidth = 0;
            lastSyncedText = null;
            lastSyncedAnchor = -1;
            lastSyncedFocus = -1;
            lastSyncedLineMode = -1;
            lastSyncedScreenRect = default(Rect);
            lastScreenWidth = 0;
            lastScreenHeight = 0;
        }
#endif

        /// <summary>
        /// 决定本帧是否延迟浏览器指针释放的补发。
        /// <para>
        /// 返回 true 表示继续等待；返回 false 表示"无需补发"（Unity 已自行消费这次释放）
        /// 或"确认事件丢失，调用方应该补发"。WebGL 下浏览器 mouseup 往往要等下一次
        /// Unity 渲染帧才被 StandaloneInputModule 消费，因此残留状态只持续一帧时不能
        /// 立即补发，否则补发与 Unity 原生释放会双重执行，快速点击产生两次 PointerClick，
        /// 触发 TMP/UGUI 的 ActivateInputField 与 onFocusSelectAll 全选。
        /// </para>
        /// </summary>
        internal static bool DeferPointerReleaseRecovery(bool mouseHeld)
        {
            if (mouseHeld)
            {
                // 鼠标仍按住：不算释放丢失，清零计数并继续等待。
                pointerReleaseMissedFrameCount = 0;
                return true;
            }

            if (!EventSystemReflection.HasResidualLeftMouseReleaseState())
            {
                // Unity 已经（或即将）自行清掉 PointerEventData 残留状态，无需补发。
                pointerReleaseRecoveryPending = false;
                pointerReleaseMissedFrameCount = 0;
                return false;
            }

            pointerReleaseMissedFrameCount += 1;
            return pointerReleaseMissedFrameCount < DeferredReleaseConfirmFrames;
        }

        /// <summary>
        /// 把纯文本插入当前聚焦的 TMP_InputField 或旧版 UGUI InputField，并替换当前选区。
        /// 支持格式正确的 Unicode 文本，包括中文、符号、Emoji 和组合字符。
        /// 单行输入框会忽略回车和换行；多行输入框会保留换行。
        /// 图片、文件、富文本格式和格式错误的 UTF-8 不在此方法的支持范围内。
        /// </summary>
        public static bool TryPasteIntoFocusedInput(string value)
        {
            if (value == null)
            {
                return false;
            }

            TextInputTarget target;
            return TryResolveSelectedInput(out target) && target.IsFocused && PasteIntoTarget(target, value);
        }

        /// <summary>
        /// 把纯文本强制写入指定的文本输入组件。可传入 TMP_InputField 或 UGUI InputField。
        /// 使用 Component 参数是为了让未安装 TextMesh Pro 或 UGUI 包的 Unity 工程也能编译此程序集。
        /// <para>
        /// 这是"强制写入"语义，不是模拟用户输入：只要求组件存活且不是 <c>readOnly</c>，
        /// 刻意不检查 <c>interactable</c>、<c>isActiveAndEnabled</c>、GameObject 是否激活和是否聚焦，
        /// 因此可以写入当前未聚焦、未激活甚至不可交互的输入框。
        /// 需要"只写用户真正能编辑的输入框"时请改用 <see cref="TryPasteIntoFocusedInput"/>。
        /// </para>
        /// 返回 true 表示文本已写入并更新了光标位置；返回 false 表示组件不是受支持的输入框、
        /// 已被销毁、处于 <c>readOnly</c> 或 <paramref name="value"/> 为 null，此时不做任何修改。
        /// </summary>
        public static bool PasteIntoInput(Component input, string value)
        {
            TextInputTarget target;
            return TryCreateTarget(input, out target) && PasteIntoTarget(target, value);
        }

        /// <summary>
        /// 获取当前聚焦输入框中选中的纯文本。没有选区时返回 false。
        /// </summary>
        public static bool TryGetSelectedText(out string value)
        {
            TextInputTarget target;
            if (!TryResolveSelectedInput(out target) || !target.IsFocused)
            {
                value = null;
                return false;
            }

            return TryGetSelectedText(target, out value);
        }

        /// <summary>
        /// 获取指定 TMP_InputField 或 UGUI InputField 的选中文本。
        /// </summary>
        public static bool TryGetSelectedText(Component input, out string value)
        {
            TextInputTarget target;
            if (!TryCreateTarget(input, out target))
            {
                value = null;
                return false;
            }

            return TryGetSelectedText(target, out value);
        }

        private static bool PasteIntoTarget(TextInputTarget target, string value)
        {
            if (target == null || !target.IsAlive || target.IsReadOnly || value == null)
            {
                return false;
            }

            string pastedText = target.IsSingleLine ? RemoveLineBreaks(value) : value;
            string currentText = target.Text;
            int anchor = Mathf.Clamp(target.SelectionAnchor, 0, currentText.Length);
            int focus = Mathf.Clamp(target.SelectionFocus, 0, currentText.Length);
            int selectionStart = Mathf.Min(anchor, focus);
            int selectionEnd = Mathf.Max(anchor, focus);
            target.Text = currentText.Remove(selectionStart, selectionEnd - selectionStart)
                .Insert(selectionStart, pastedText);

            int caretPosition = Mathf.Clamp(selectionStart + pastedText.Length, 0, target.Text.Length);
            target.SelectionAnchor = caretPosition;
            target.SelectionFocus = caretPosition;
            return true;
        }

        private static bool TryGetSelectedText(TextInputTarget target, out string value)
        {
            if (target == null || !target.IsAlive)
            {
                value = null;
                return false;
            }

            string text = target.Text;
            int anchor = Mathf.Clamp(target.SelectionAnchor, 0, text.Length);
            int focus = Mathf.Clamp(target.SelectionFocus, 0, text.Length);
            if (anchor == focus)
            {
                value = null;
                return false;
            }

            int start = Mathf.Min(anchor, focus);
            int end = Mathf.Max(anchor, focus);
            value = text.Substring(start, end - start);
            return true;
        }

        private static bool TryResolveSelectedInput(out TextInputTarget target)
        {
            target = null;
            GameObject selectedObject = EventSystemReflection.GetCurrentSelectedGameObject();
            if (selectedObject == null)
            {
                return false;
            }

            Component component = FindInputComponentInParents(selectedObject.transform, TmpInputReflection.InputType);
            if (component != null && TryCreateTarget(component, out target) && target.IsUsable)
            {
                return true;
            }

            component = FindInputComponentInParents(selectedObject.transform, LegacyInputReflection.InputType);
            if (component != null && TryCreateTarget(component, out target) && target.IsUsable)
            {
                return true;
            }

            target = null;
            return false;
        }

        private static Component FindInputComponentInParents(Transform start, Type componentType)
        {
            if (componentType == null)
            {
                return null;
            }

            Transform cursor = start;
            while (cursor != null)
            {
                Component component = cursor.gameObject.GetComponent(componentType);
                if (component != null)
                {
                    return component;
                }

                cursor = cursor.parent;
            }

            return null;
        }

        private static bool TryCreateTarget(Component component, out TextInputTarget target)
        {
            target = null;
            if (component == null)
            {
                return false;
            }

            if (LegacyInputReflection.IsLegacyInput(component))
            {
                target = new TextInputTarget(component, true);
                return target.HasRequiredApi;
            }

            if (!TmpInputReflection.IsTmpInput(component))
            {
                return false;
            }

            target = new TextInputTarget(component, false);
            return target.HasRequiredApi;
        }

        /// <summary>
        /// 记录被插件抬高 caretWidth 的输入框原值。切换到别的输入框时先恢复上一个。
        /// </summary>
        private static void RememberOriginalCaretWidth(Component input, int width)
        {
            if (caretWidthOwner != null && !ReferenceEquals(caretWidthOwner, input))
            {
                RestoreOriginalCaretWidth();
            }

            caretWidthOwner = input;
            originalCaretWidth = width;
        }

        /// <summary>
        /// 恢复输入框进入浏览器输入会话之前的 caretWidth。输入框已销毁时只清理记录。
        /// </summary>
        private static void RestoreOriginalCaretWidth()
        {
            Component owner = caretWidthOwner;
            int width = originalCaretWidth;
            caretWidthOwner = null;
            originalCaretWidth = 0;
            if (owner == null)
            {
                return;
            }

            TextInputTarget target;
            if (TryCreateTarget(owner, out target))
            {
                target.SetCaretWidth(width);
            }
        }

        private static Rect GetScreenRect(RectTransform rectTransform)
        {
            if (rectTransform == null)
            {
                return new Rect(0f, 0f, 1f, 1f);
            }

            Canvas canvas = rectTransform.GetComponentInParent<Canvas>();
            Camera eventCamera = null;
            if (canvas != null && canvas.renderMode != RenderMode.ScreenSpaceOverlay)
            {
                eventCamera = canvas.worldCamera;
            }

            rectTransform.GetWorldCorners(InputWorldCorners);
            Vector2 bottomLeft = RectTransformUtility.WorldToScreenPoint(eventCamera, InputWorldCorners[0]);
            Vector2 topRight = RectTransformUtility.WorldToScreenPoint(eventCamera, InputWorldCorners[2]);
            return Rect.MinMaxRect(bottomLeft.x, bottomLeft.y, topRight.x, topRight.y);
        }

        private static bool Approximately(Rect first, Rect second)
        {
            return Mathf.Abs(first.x - second.x) < 0.25f &&
                   Mathf.Abs(first.y - second.y) < 0.25f &&
                   Mathf.Abs(first.width - second.width) < 0.25f &&
                   Mathf.Abs(first.height - second.height) < 0.25f;
        }

        private static string RemoveLineBreaks(string value)
        {
            if (value.IndexOf('\r') < 0 && value.IndexOf('\n') < 0)
            {
                return value;
            }

            return value.Replace("\r", string.Empty).Replace("\n", string.Empty);
        }

        private static string DecodeUtf8(IntPtr utf8Bytes, int byteLength)
        {
            if (byteLength < 0)
            {
                throw new ArgumentOutOfRangeException("byteLength");
            }

            if (byteLength == 0)
            {
                return string.Empty;
            }

            if (utf8Bytes == IntPtr.Zero)
            {
                throw new ArgumentNullException("utf8Bytes");
            }

            byte[] bytes = new byte[byteLength];
            Marshal.Copy(utf8Bytes, bytes, 0, byteLength);
            return StrictUtf8.GetString(bytes);
        }

        private sealed class TextInputTarget
        {
            private readonly Component input;
            private readonly bool isLegacy;

            public TextInputTarget(Component input, bool isLegacy)
            {
                this.input = input;
                this.isLegacy = isLegacy;
            }

            public Component Component
            {
                get { return input; }
            }

            public bool IsAlive
            {
                get { return Component != null; }
            }

            public bool HasRequiredApi
            {
                get { return isLegacy ? LegacyInputReflection.HasRequiredApi : TmpInputReflection.HasRequiredApi; }
            }

            public bool IsUsable
            {
                get
                {
                    Behaviour behaviour = Component as Behaviour;
                    return IsAlive && behaviour != null && behaviour.isActiveAndEnabled &&
                           GetBool(InteractableProperty, false) && !IsReadOnly;
                }
            }

            public bool IsReadOnly
            {
                get
                {
                    return GetBool(ReadOnlyProperty, true);
                }
            }

            public bool IsFocused
            {
                get
                {
                    return GetBool(IsFocusedProperty, false);
                }
            }

            public int LineMode
            {
                get
                {
                    object value = GetValue(LineTypeProperty);
                    string name = value != null ? value.ToString() : null;
                    if (string.Equals(name, "MultiLineSubmit", StringComparison.Ordinal))
                    {
                        return MultiLineSubmitMode;
                    }

                    return string.Equals(name, "MultiLineNewline", StringComparison.Ordinal)
                        ? MultiLineNewlineMode
                        : SingleLineMode;
                }
            }

            public bool IsSingleLine
            {
                get { return LineMode == SingleLineMode; }
            }

            public string Text
            {
                get
                {
                    string value = GetValue(TextProperty) as string;
                    return value ?? string.Empty;
                }
                set
                {
                    SetValue(TextProperty, value);
                }
            }

            public int SelectionAnchor
            {
                get
                {
                    return GetInt(AnchorProperty);
                }
                set
                {
                    SetValue(AnchorProperty, value);
                }
            }

            public int SelectionFocus
            {
                get
                {
                    return GetInt(FocusProperty);
                }
                set
                {
                    SetValue(FocusProperty, value);
                }
            }

            public RectTransform RectTransform
            {
                get { return Component != null ? Component.transform as RectTransform : null; }
            }

            public bool Represents(Component component)
            {
                return Component == component;
            }

            public bool TryStabilizePointerDownAnchor(Vector2 screenPosition)
            {
                if (!IsAlive)
                {
                    return false;
                }

                int dragFocus = SelectionFocus;
                int correctedAnchor;
                if (!EventSystemReflection.TryReplayPointerDownAt(
                        Component,
                        screenPosition,
                        out correctedAnchor))
                {
                    return false;
                }

                SelectionAnchor = correctedAnchor;
                SelectionFocus = dragFocus;
                RefreshLabel();
                return true;
            }

            public bool TryMoveCaret(int direction, bool shift, bool controlOrMeta)
            {
                MethodInfo method;
                object[] arguments;
                switch (direction)
                {
                    case 0:
                        method = MoveLeftMethod;
                        arguments = new object[] { shift, controlOrMeta };
                        break;
                    case 1:
                        method = MoveRightMethod;
                        arguments = new object[] { shift, controlOrMeta };
                        break;
                    case 2:
                        method = MoveUpMethod;
                        arguments = new object[] { shift };
                        break;
                    case 3:
                        method = MoveDownMethod;
                        arguments = new object[] { shift };
                        break;
                    default:
                        return false;
                }

                if (input == null)
                {
                    return false;
                }

                int previousAnchor = SelectionAnchor;
                int previousFocus = SelectionFocus;
                if (method != null)
                {
                    try
                    {
                        RefreshLabel();
                        method.Invoke(input, arguments);
                        RefreshLabel();
                        if (SelectionAnchor != previousAnchor || SelectionFocus != previousFocus)
                        {
                            return true;
                        }
                    }
                    catch (TargetInvocationException)
                    {
                    }
                }

                ApplyFallbackNavigation(direction, shift, controlOrMeta, previousAnchor, previousFocus);
                RefreshLabel();
                return true;
            }

            public bool TryProcessEnterKey(bool keypadEnter, int modifierFlags, out bool finished)
            {
                finished = false;
                if (!IsUsable || !IsFocused || input == null)
                {
                    return false;
                }

                MethodInfo processEventMethod = ProcessEventMethod;
                bool shouldFinish = LineMode != MultiLineNewlineMode;
                bool hasSeparateSubmitEvent = !isLegacy || LegacyInputReflection.SubmitEventProperty != null;
                MethodInfo sendOnSubmitMethod = SendOnSubmitMethod;
                MethodInfo deactivateInputFieldMethod = DeactivateInputFieldMethod;
                if (processEventMethod == null ||
                    (shouldFinish &&
                     (deactivateInputFieldMethod == null ||
                      (hasSeparateSubmitEvent && sendOnSubmitMethod == null))))
                {
                    return false;
                }

                Event keyEvent = new Event
                {
                    type = EventType.KeyDown,
                    keyCode = keypadEnter ? KeyCode.KeypadEnter : KeyCode.Return,
                    character = '\r',
                    modifiers = GetEventModifiers(modifierFlags)
                };

                try
                {
                    processEventMethod.Invoke(input, new object[] { keyEvent });
                }
                catch (TargetInvocationException exception)
                {
                    Debug.LogException(exception.InnerException ?? exception);
                    return false;
                }

                if (!shouldFinish)
                {
                    RefreshLabel();
                    return true;
                }

                finished = true;
                if (hasSeparateSubmitEvent)
                {
                    try
                    {
                        sendOnSubmitMethod.Invoke(input, null);
                    }
                    catch (TargetInvocationException exception)
                    {
                        Debug.LogException(exception.InnerException ?? exception);
                    }
                }

                try
                {
                    object[] arguments = deactivateInputFieldMethod.GetParameters().Length == 0
                        ? null
                        : new object[] { false };
                    deactivateInputFieldMethod.Invoke(input, arguments);
                }
                catch (TargetInvocationException exception)
                {
                    Debug.LogException(exception.InnerException ?? exception);
                }

                return true;
            }

            private static EventModifiers GetEventModifiers(int modifierFlags)
            {
                EventModifiers modifiers = EventModifiers.None;
                if ((modifierFlags & ShiftModifierFlag) != 0)
                {
                    modifiers |= EventModifiers.Shift;
                }
                if ((modifierFlags & ControlModifierFlag) != 0)
                {
                    modifiers |= EventModifiers.Control;
                }
                if ((modifierFlags & AltModifierFlag) != 0)
                {
                    modifiers |= EventModifiers.Alt;
                }
                if ((modifierFlags & CommandModifierFlag) != 0)
                {
                    modifiers |= EventModifiers.Command;
                }

                return modifiers;
            }

            public void RefreshLabel()
            {
                MethodInfo method = ForceLabelUpdateMethod;
                if (input != null && method != null)
                {
                    try
                    {
                        method.Invoke(input, null);
                    }
                    catch (TargetInvocationException)
                    {
                    }
                }
            }

            /// <summary>
            /// 把过细的光标抬高到可见宽度，并记录原值，供会话结束时恢复。
            /// </summary>
            public void EnsureVisibleCaret()
            {
                PropertyInfo property = CaretWidthProperty;
                if (input == null || property == null || !property.CanRead || !property.CanWrite)
                {
                    return;
                }

                object value = property.GetValue(input, null);
                if (!(value is int))
                {
                    return;
                }

                int width = (int)value;
                if (width >= MinimumCaretWidth)
                {
                    return;
                }

                RememberOriginalCaretWidth(input, width);
                property.SetValue(input, MinimumCaretWidth, null);
            }

            public void SetCaretWidth(int width)
            {
                PropertyInfo property = CaretWidthProperty;
                if (input == null || property == null || !property.CanWrite)
                {
                    return;
                }

                property.SetValue(input, width, null);
            }

            private void ApplyFallbackNavigation(
                int direction,
                bool shift,
                bool controlOrMeta,
                int previousAnchor,
                int previousFocus)
            {
                string value = Text;
                int textLength = value.Length;
                int anchor = Mathf.Clamp(previousAnchor, 0, textLength);
                int focus = Mathf.Clamp(previousFocus, 0, textLength);
                int position;

                if (!shift && anchor != focus)
                {
                    position = direction == 0 || direction == 2
                        ? Mathf.Min(anchor, focus)
                        : Mathf.Max(anchor, focus);
                }
                else
                {
                    switch (direction)
                    {
                        case 0:
                            position = FindPreviousPosition(value, focus, controlOrMeta);
                            break;
                        case 1:
                            position = FindNextPosition(value, focus, controlOrMeta);
                            break;
                        case 2:
                            position = FindVerticalPosition(value, focus, -1);
                            break;
                        case 3:
                            position = FindVerticalPosition(value, focus, 1);
                            break;
                        default:
                            position = focus;
                            break;
                    }
                }

                position = Mathf.Clamp(position, 0, textLength);
                if (shift)
                {
                    SelectionAnchor = anchor;
                    SelectionFocus = position;
                }
                else
                {
                    SelectionAnchor = position;
                    SelectionFocus = position;
                }
            }

            private static int FindPreviousPosition(string value, int position, bool byWord)
            {
                if (position <= 0)
                {
                    return 0;
                }

                if (byWord)
                {
                    int index = position;
                    while (index > 0 && char.IsWhiteSpace(value[index - 1]))
                    {
                        index--;
                    }
                    while (index > 0 && !char.IsWhiteSpace(value[index - 1]))
                    {
                        index--;
                    }
                    return index;
                }

                return position >= 2 && char.IsLowSurrogate(value[position - 1]) &&
                       char.IsHighSurrogate(value[position - 2])
                    ? position - 2
                    : position - 1;
            }

            private static int FindNextPosition(string value, int position, bool byWord)
            {
                if (position >= value.Length)
                {
                    return value.Length;
                }

                if (byWord)
                {
                    int index = position;
                    while (index < value.Length && !char.IsWhiteSpace(value[index]))
                    {
                        index++;
                    }
                    while (index < value.Length && char.IsWhiteSpace(value[index]))
                    {
                        index++;
                    }
                    return index;
                }

                return position + 1 < value.Length && char.IsHighSurrogate(value[position]) &&
                       char.IsLowSurrogate(value[position + 1])
                    ? position + 2
                    : position + 1;
            }

            private static int FindVerticalPosition(string value, int position, int direction)
            {
                if (value.Length == 0)
                {
                    return 0;
                }

                int currentLineStart = value.LastIndexOf('\n', Mathf.Max(position - 1, 0));
                currentLineStart = currentLineStart < 0 ? 0 : currentLineStart + 1;
                int column = position - currentLineStart;

                if (direction < 0)
                {
                    if (currentLineStart == 0)
                    {
                        return 0;
                    }

                    int previousLineEnd = currentLineStart - 1;
                    int previousLineStartSearch = previousLineEnd - 1;
                    int previousLineStart = previousLineStartSearch >= 0
                        ? value.LastIndexOf('\n', previousLineStartSearch)
                        : -1;
                    previousLineStart = previousLineStart < 0 ? 0 : previousLineStart + 1;
                    int previousContentEnd = previousLineEnd;
                    if (previousContentEnd > previousLineStart && value[previousContentEnd - 1] == '\r')
                    {
                        previousContentEnd--;
                    }
                    return Mathf.Min(previousLineStart + column, previousContentEnd);
                }

                int currentLineEnd = value.IndexOf('\n', position);
                if (currentLineEnd < 0)
                {
                    return value.Length;
                }

                int nextLineStart = currentLineEnd + 1;
                int nextLineEnd = value.IndexOf('\n', nextLineStart);
                int nextContentEnd = nextLineEnd < 0 ? value.Length : nextLineEnd;
                if (nextContentEnd > nextLineStart && value[nextContentEnd - 1] == '\r')
                {
                    nextContentEnd--;
                }
                return Mathf.Min(nextLineStart + column, nextContentEnd);
            }

            private PropertyInfo TextProperty
            {
                get { return isLegacy ? LegacyInputReflection.TextProperty : TmpInputReflection.TextProperty; }
            }

            private PropertyInfo ReadOnlyProperty
            {
                get { return isLegacy ? LegacyInputReflection.ReadOnlyProperty : TmpInputReflection.ReadOnlyProperty; }
            }

            private PropertyInfo IsFocusedProperty
            {
                get { return isLegacy ? LegacyInputReflection.IsFocusedProperty : TmpInputReflection.IsFocusedProperty; }
            }

            private PropertyInfo InteractableProperty
            {
                get { return isLegacy ? LegacyInputReflection.InteractableProperty : TmpInputReflection.InteractableProperty; }
            }

            private PropertyInfo LineTypeProperty
            {
                get { return isLegacy ? LegacyInputReflection.LineTypeProperty : TmpInputReflection.LineTypeProperty; }
            }

            private PropertyInfo AnchorProperty
            {
                get { return isLegacy ? LegacyInputReflection.AnchorProperty : TmpInputReflection.AnchorProperty; }
            }

            private PropertyInfo FocusProperty
            {
                get { return isLegacy ? LegacyInputReflection.FocusProperty : TmpInputReflection.FocusProperty; }
            }

            private MethodInfo MoveLeftMethod
            {
                get { return isLegacy ? LegacyInputReflection.MoveLeftMethod : TmpInputReflection.MoveLeftMethod; }
            }

            private MethodInfo MoveRightMethod
            {
                get { return isLegacy ? LegacyInputReflection.MoveRightMethod : TmpInputReflection.MoveRightMethod; }
            }

            private MethodInfo MoveUpMethod
            {
                get { return isLegacy ? LegacyInputReflection.MoveUpMethod : TmpInputReflection.MoveUpMethod; }
            }

            private MethodInfo MoveDownMethod
            {
                get { return isLegacy ? LegacyInputReflection.MoveDownMethod : TmpInputReflection.MoveDownMethod; }
            }

            private MethodInfo ForceLabelUpdateMethod
            {
                get
                {
                    return isLegacy
                        ? LegacyInputReflection.ForceLabelUpdateMethod
                        : TmpInputReflection.ForceLabelUpdateMethod;
                }
            }

            private MethodInfo ProcessEventMethod
            {
                get { return isLegacy ? LegacyInputReflection.ProcessEventMethod : TmpInputReflection.ProcessEventMethod; }
            }

            private MethodInfo SendOnSubmitMethod
            {
                get { return isLegacy ? LegacyInputReflection.SendOnSubmitMethod : TmpInputReflection.SendOnSubmitMethod; }
            }

            private MethodInfo DeactivateInputFieldMethod
            {
                get
                {
                    return isLegacy
                        ? LegacyInputReflection.DeactivateInputFieldMethod
                        : TmpInputReflection.DeactivateInputFieldMethod;
                }
            }

            private PropertyInfo CaretWidthProperty
            {
                get { return isLegacy ? LegacyInputReflection.CaretWidthProperty : TmpInputReflection.CaretWidthProperty; }
            }

            private object GetValue(PropertyInfo property)
            {
                return input != null && property != null ? property.GetValue(input, null) : null;
            }

            private int GetInt(PropertyInfo property)
            {
                object value = GetValue(property);
                return value is int ? (int)value : 0;
            }

            private bool GetBool(PropertyInfo property, bool fallback)
            {
                object value = GetValue(property);
                return value is bool ? (bool)value : fallback;
            }

            private void SetValue(PropertyInfo property, object value)
            {
                if (input != null && property != null && property.CanWrite)
                {
                    property.SetValue(input, value, null);
                }
            }
        }

        private static class WebGLKeyboardCapture
        {
            private static readonly PropertyInfo CaptureProperty = FindCaptureProperty();
            private static bool hasProjectValue;
            private static bool projectValue;

            /// <summary>
            /// 进入浏览器输入会话。首次进入时保存业务原值，之后才关闭 Unity 的键盘捕获。
            /// </summary>
            public static void Suppress()
            {
                if (CaptureProperty == null || !CaptureProperty.CanWrite)
                {
                    return;
                }

                if (!hasProjectValue)
                {
                    projectValue = Read();
                    hasProjectValue = true;
                }

                CaptureProperty.SetValue(null, false, null);
            }

            /// <summary>
            /// 退出浏览器输入会话，精确恢复业务原值。没有保存过原值时不写入任何值。
            /// </summary>
            public static void Restore()
            {
                if (!hasProjectValue || CaptureProperty == null || !CaptureProperty.CanWrite)
                {
                    return;
                }

                hasProjectValue = false;
                CaptureProperty.SetValue(null, projectValue, null);
            }

            /// <summary>
            /// 丢弃保存的原值，用于域重置这类"业务值本来就要重新初始化"的路径。
            /// </summary>
            public static void Forget()
            {
                hasProjectValue = false;
            }

            private static bool Read()
            {
                if (CaptureProperty == null || !CaptureProperty.CanRead)
                {
                    // 读不到时按 Unity 自身的默认值 true 处理。
                    return true;
                }

                object value = CaptureProperty.GetValue(null, null);
                return !(value is bool) || (bool)value;
            }

            private static PropertyInfo FindCaptureProperty()
            {
                Type type = Type.GetType("UnityEngine.WebGLInput, UnityEngine.WebGLModule", false);
                if (type == null)
                {
                    type = Type.GetType("UnityEngine.WebGLInput, UnityEngine", false);
                }

                if (type == null)
                {
                    Assembly[] assemblies = AppDomain.CurrentDomain.GetAssemblies();
                    for (int i = 0; i < assemblies.Length; i++)
                    {
                        type = assemblies[i].GetType("UnityEngine.WebGLInput", false);
                        if (type != null)
                        {
                            break;
                        }
                    }
                }

                return type != null
                    ? type.GetProperty("captureAllKeyboardInput", BindingFlags.Static | BindingFlags.Public)
                    : null;
            }
        }

        private static class EventSystemReflection
        {
            private static readonly Type EventSystemType = FindType(
                "UnityEngine.EventSystems.EventSystem",
                "UnityEngine.UI");
            private static readonly Type StandaloneInputModuleType = FindType(
                "UnityEngine.EventSystems.StandaloneInputModule",
                "UnityEngine.UI");
            private static readonly PropertyInfo CurrentProperty = EventSystemType != null
                ? EventSystemType.GetProperty("current", BindingFlags.Static | BindingFlags.Public)
                : null;
            private static readonly PropertyInfo SelectedObjectProperty = EventSystemType != null
                ? EventSystemType.GetProperty("currentSelectedGameObject", BindingFlags.Instance | BindingFlags.Public)
                : null;
            private static readonly PropertyInfo CurrentInputModuleProperty = EventSystemType != null
                ? EventSystemType.GetProperty("currentInputModule", BindingFlags.Instance | BindingFlags.Public)
                : null;
            private static readonly Type ExecuteEventsType = FindType(
                "UnityEngine.EventSystems.ExecuteEvents",
                "UnityEngine.UI");
            private static readonly object PointerUpHandler = FindEventFunction("pointerUpHandler");
            private static readonly object EndDragHandler = FindEventFunction("endDragHandler");
            private static readonly MethodInfo PointerUpExecuteMethod = FindExecuteMethod(PointerUpHandler);
            private static readonly MethodInfo EndDragExecuteMethod = FindExecuteMethod(EndDragHandler);

            public static GameObject GetCurrentSelectedGameObject()
            {
                if (CurrentProperty == null || SelectedObjectProperty == null)
                {
                    return null;
                }

                object current = CurrentProperty.GetValue(null, null);
                return current != null
                    ? SelectedObjectProperty.GetValue(current, null) as GameObject
                    : null;
            }

            public static bool HasResidualLeftMouseReleaseState()
            {
                object inputModule;
                object pointerEventData = TryGetLeftMousePointerEventData(out inputModule);
                return pointerEventData != null && HasPendingReleaseState(pointerEventData);
            }

            public static bool TryRecoverMissedPointerRelease(bool mouseHeld)
            {
                if (mouseHeld)
                {
                    return false;
                }

                object inputModule;
                object pointerEventData = TryGetLeftMousePointerEventData(out inputModule);
                if (pointerEventData == null || !HasPendingReleaseState(pointerEventData))
                {
                    return false;
                }

                // 拖拽过的手势不能补 PointerClick：补出来的 click 会让 TMP_InputField 和
                // UGUI InputField 重新执行 OnPointerClick -> ActivateInputField，
                // 在 onFocusSelectAll 为 true 时把用户刚拖出来的选区改成全选。
                // 清零 eligibleForClick 后交给 Unity 自己的释放流程，它会跳过 Click，
                // 但仍然正确派发 Drop 和 EndDrag，拖放类 UI 的语义不受影响。
                if (GetBoolMemberValue(pointerEventData, "dragging"))
                {
                    SetInstanceMemberValue(pointerEventData, "eligibleForClick", false);
                }

                return TryProcessMousePressReleased(inputModule, pointerEventData);
            }

            public static bool TryReplayPointerDownAt(
                Component target,
                Vector2 screenPosition,
                out int correctedAnchor)
            {
                correctedAnchor = 0;
                if (target == null)
                {
                    return false;
                }

                object inputModule;
                object pointerEventData = TryGetLeftMousePointerEventData(out inputModule);
                if (pointerEventData == null || !GetBoolMemberValue(pointerEventData, "dragging"))
                {
                    return false;
                }

                GameObject pressed =
                    GetInstanceMemberValue(pointerEventData, "pointerPress") as GameObject;
                if (pressed == null || pressed != target.gameObject)
                {
                    return false;
                }

                MethodInfo pointerDownMethod = FindInstanceMethod(
                    target.GetType(),
                    "OnPointerDown",
                    1);
                if (pointerDownMethod == null)
                {
                    return false;
                }

                object originalPosition = GetInstanceMemberValue(pointerEventData, "position");
                object pressRaycast = GetInstanceMemberValue(
                    pointerEventData,
                    "pointerPressRaycast");
                object originalRaycastScreenPosition = GetInstanceMemberValue(
                    pressRaycast,
                    "screenPosition");
                FieldInfo usedField = FindInstanceField(
                    pointerEventData.GetType(),
                    "m_Used");
                object originalUsed = usedField != null
                    ? usedField.GetValue(pointerEventData)
                    : null;
                FieldInfo clickTimeField = FindInstanceField(
                    target.GetType(),
                    "m_PointerDownClickStartTime");
                object originalClickTime = clickTimeField != null
                    ? clickTimeField.GetValue(target)
                    : null;

                try
                {
                    if (!SetInstanceMemberValue(pointerEventData, "position", screenPosition))
                    {
                        return false;
                    }

                    // TMP 读取 PointerEventData.position；UGUI InputField 读取
                    // pointerPressRaycast.screenPosition。两处必须使用同一个原始按下点。
                    if (pressRaycast != null &&
                        !SetInstanceMemberValue(pressRaycast, "screenPosition", screenPosition))
                    {
                        return false;
                    }
                    if (pressRaycast != null &&
                        !SetInstanceMemberValue(
                            pointerEventData,
                            "pointerPressRaycast",
                            pressRaycast))
                    {
                        return false;
                    }

                    // 这是同一次物理 pointerdown 的坐标校正，不是第二次点击。
                    // 暂时清掉双击时间戳，避免校正过程触发 TMP 的选词分支。
                    if (clickTimeField != null)
                    {
                        clickTimeField.SetValue(target, float.NegativeInfinity);
                    }

                    pointerDownMethod.Invoke(target, new[] { pointerEventData });
                    TextInputTarget correctedTarget = new TextInputTarget(
                        target,
                        LegacyInputReflection.IsLegacyInput(target));
                    correctedAnchor = correctedTarget.SelectionFocus;
                    return true;
                }
                catch (TargetInvocationException)
                {
                    return false;
                }
                finally
                {
                    SetInstanceMemberValue(pointerEventData, "position", originalPosition);
                    if (pressRaycast != null)
                    {
                        SetInstanceMemberValue(
                            pressRaycast,
                            "screenPosition",
                            originalRaycastScreenPosition);
                        SetInstanceMemberValue(
                            pointerEventData,
                            "pointerPressRaycast",
                            pressRaycast);
                    }
                    if (usedField != null)
                    {
                        usedField.SetValue(pointerEventData, originalUsed);
                    }
                    if (clickTimeField != null)
                    {
                        clickTimeField.SetValue(target, originalClickTime);
                    }
                }
            }

            /// <summary>
            /// 手势中断路径（pointercancel、touchcancel、真正的窗口失焦）的状态清理。
            /// 浏览器不会为中断的手势补发 click，因此这里只派发 PointerUp 和 EndDrag，
            /// 绝不派发 PointerClick，也不派发 Drop。
            /// </summary>
            public static bool TryCancelPointerPress()
            {
                object inputModule;
                object pointerEventData = TryGetLeftMousePointerEventData(out inputModule);
                if (pointerEventData == null || !HasPendingReleaseState(pointerEventData))
                {
                    return false;
                }

                // 先关闭点击资格，两条清理路径都不会再产生 PointerClick。
                SetInstanceMemberValue(pointerEventData, "eligibleForClick", false);
                if (!TryExecuteCancelEvents(pointerEventData))
                {
                    // ExecuteEvents 反射不可用时退回 Unity 自身的释放流程：
                    // eligibleForClick 已为 false，不会有 PointerClick，
                    // 但拖拽中的手势仍会走 Unity 的 Drop 分支。
                    return TryProcessMousePressReleased(inputModule, pointerEventData);
                }

                SetInstanceMemberValue(pointerEventData, "pointerPress", null);
                SetInstanceMemberValue(pointerEventData, "rawPointerPress", null);
                // pointerClick 只存在于 Unity 2021.1 及以上，失败可忽略。
                SetInstanceMemberValue(pointerEventData, "pointerClick", null);
                SetInstanceMemberValue(pointerEventData, "pointerDrag", null);
                SetInstanceMemberValue(pointerEventData, "dragging", false);
                return !HasPendingReleaseState(pointerEventData);
            }

            private static object TryGetLeftMousePointerEventData(out object inputModule)
            {
                inputModule = null;
                if (CurrentProperty == null ||
                    CurrentInputModuleProperty == null ||
                    StandaloneInputModuleType == null)
                {
                    return null;
                }

                object current = CurrentProperty.GetValue(null, null);
                object module = current != null
                    ? CurrentInputModuleProperty.GetValue(current, null)
                    : null;
                if (module == null || module.GetType() != StandaloneInputModuleType)
                {
                    return null;
                }

                FieldInfo pointerDataField = FindInstanceField(
                    module.GetType(),
                    "m_PointerData");
                IDictionary pointerData = pointerDataField != null
                    ? pointerDataField.GetValue(module) as IDictionary
                    : null;
                object pointerEventData = pointerData != null && pointerData.Contains(-1)
                    ? pointerData[-1]
                    : null;
                if (pointerEventData == null || !IsLeftMousePointer(pointerEventData))
                {
                    return null;
                }

                inputModule = module;
                return pointerEventData;
            }

            private static bool TryProcessMousePressReleased(
                object inputModule,
                object pointerEventData)
            {
                MethodInfo processMousePressMethod = FindInstanceMethod(
                    inputModule.GetType(),
                    "ProcessMousePress",
                    1);
                if (processMousePressMethod == null)
                {
                    return false;
                }

                Type mouseButtonEventDataType =
                    processMousePressMethod.GetParameters()[0].ParameterType;
                object mouseButtonEventData = Activator.CreateInstance(mouseButtonEventDataType);
                if (!SetInstanceMemberValue(
                        mouseButtonEventData,
                        "buttonData",
                        pointerEventData) ||
                    !SetEnumMemberValue(
                        mouseButtonEventData,
                        "buttonState",
                        "Released"))
                {
                    return false;
                }

                processMousePressMethod.Invoke(inputModule, new[] { mouseButtonEventData });
                return !HasPendingReleaseState(pointerEventData);
            }

            private static bool TryExecuteCancelEvents(object pointerEventData)
            {
                if (PointerUpExecuteMethod == null || PointerUpHandler == null)
                {
                    return false;
                }

                GameObject pressed =
                    GetInstanceMemberValue(pointerEventData, "pointerPress") as GameObject;
                GameObject dragged =
                    GetInstanceMemberValue(pointerEventData, "pointerDrag") as GameObject;
                bool dragging = GetBoolMemberValue(pointerEventData, "dragging");
                if (dragging && dragged != null &&
                    (EndDragExecuteMethod == null || EndDragHandler == null))
                {
                    return false;
                }

                if (pressed != null)
                {
                    PointerUpExecuteMethod.Invoke(
                        null,
                        new object[] { pressed, pointerEventData, PointerUpHandler });
                }

                if (dragging && dragged != null)
                {
                    EndDragExecuteMethod.Invoke(
                        null,
                        new object[] { dragged, pointerEventData, EndDragHandler });
                }

                return true;
            }

            private static object FindEventFunction(string name)
            {
                if (ExecuteEventsType == null)
                {
                    return null;
                }

                PropertyInfo property = ExecuteEventsType.GetProperty(
                    name,
                    BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                if (property != null && property.CanRead)
                {
                    return property.GetValue(null, null);
                }

                FieldInfo field = ExecuteEventsType.GetField(
                    name,
                    BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                return field != null ? field.GetValue(null) : null;
            }

            private static MethodInfo FindExecuteMethod(object eventFunction)
            {
                if (ExecuteEventsType == null || eventFunction == null)
                {
                    return null;
                }

                Type functionType = eventFunction.GetType();
                if (!functionType.IsGenericType)
                {
                    return null;
                }

                Type handlerInterface = functionType.GetGenericArguments()[0];
                MethodInfo[] methods = ExecuteEventsType.GetMethods(
                    BindingFlags.Static | BindingFlags.Public);
                for (int i = 0; i < methods.Length; i++)
                {
                    MethodInfo method = methods[i];
                    if (method.Name != "Execute" ||
                        !method.IsGenericMethodDefinition ||
                        method.GetParameters().Length != 3)
                    {
                        continue;
                    }

                    try
                    {
                        return method.MakeGenericMethod(handlerInterface);
                    }
                    catch (ArgumentException)
                    {
                        return null;
                    }
                }

                return null;
            }

            private static bool IsLeftMousePointer(object pointerEventData)
            {
                object pointerId = GetInstanceMemberValue(pointerEventData, "pointerId");
                object button = GetInstanceMemberValue(pointerEventData, "button");
                return pointerId is int && (int)pointerId == -1 &&
                    button != null && Convert.ToInt32(button) == 0;
            }

            private static bool HasPendingReleaseState(object pointerEventData)
            {
                return GetInstanceMemberValue(pointerEventData, "pointerPress") != null ||
                    GetInstanceMemberValue(pointerEventData, "pointerClick") != null ||
                    GetInstanceMemberValue(pointerEventData, "pointerDrag") != null ||
                    GetBoolMemberValue(pointerEventData, "dragging") ||
                    GetBoolMemberValue(pointerEventData, "eligibleForClick");
            }

            private static bool GetBoolMemberValue(object instance, string name)
            {
                object value = GetInstanceMemberValue(instance, name);
                return value is bool && (bool)value;
            }

            private static object GetInstanceMemberValue(object instance, string name)
            {
                if (instance == null)
                {
                    return null;
                }

                Type type = instance.GetType();
                PropertyInfo property = type.GetProperty(
                    name,
                    BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                if (property != null)
                {
                    return property.GetValue(instance, null);
                }

                FieldInfo field = FindInstanceField(type, name);
                return field != null ? field.GetValue(instance) : null;
            }

            private static bool SetEnumMemberValue(
                object instance,
                string name,
                string enumValueName)
            {
                Type memberType = GetInstanceMemberType(instance, name);
                if (memberType == null || !memberType.IsEnum)
                {
                    return false;
                }

                return SetInstanceMemberValue(
                    instance,
                    name,
                    Enum.Parse(memberType, enumValueName, false));
            }

            private static Type GetInstanceMemberType(object instance, string name)
            {
                if (instance == null)
                {
                    return null;
                }

                Type type = instance.GetType();
                PropertyInfo property = type.GetProperty(
                    name,
                    BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                if (property != null)
                {
                    return property.PropertyType;
                }

                FieldInfo field = FindInstanceField(type, name);
                return field != null ? field.FieldType : null;
            }

            private static bool SetInstanceMemberValue(
                object instance,
                string name,
                object value)
            {
                if (instance == null)
                {
                    return false;
                }

                Type type = instance.GetType();
                PropertyInfo property = type.GetProperty(
                    name,
                    BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                if (property != null && property.CanWrite)
                {
                    property.SetValue(instance, value, null);
                    return true;
                }

                FieldInfo field = FindInstanceField(type, name);
                if (field == null)
                {
                    return false;
                }

                field.SetValue(instance, value);
                return true;
            }

            private static FieldInfo FindInstanceField(Type type, string name)
            {
                while (type != null)
                {
                    FieldInfo field = type.GetField(
                        name,
                        BindingFlags.Instance |
                        BindingFlags.Public |
                        BindingFlags.NonPublic |
                        BindingFlags.DeclaredOnly);
                    if (field != null)
                    {
                        return field;
                    }

                    type = type.BaseType;
                }

                return null;
            }

            private static MethodInfo FindInstanceMethod(
                Type type,
                string name,
                int parameterCount)
            {
                while (type != null)
                {
                    MethodInfo[] methods = type.GetMethods(
                        BindingFlags.Instance |
                        BindingFlags.Public |
                        BindingFlags.NonPublic |
                        BindingFlags.DeclaredOnly);
                    for (int i = 0; i < methods.Length; i++)
                    {
                        MethodInfo method = methods[i];
                        if (method.Name == name &&
                            method.GetParameters().Length == parameterCount)
                        {
                            return method;
                        }
                    }

                    type = type.BaseType;
                }

                return null;
            }
        }

        private static class LegacyInputReflection
        {
            private static readonly Type CachedInputType = FindType(
                "UnityEngine.UI.InputField",
                "UnityEngine.UI");

            public static readonly PropertyInfo TextProperty = GetProperty("text");
            public static readonly PropertyInfo ReadOnlyProperty = GetProperty("readOnly");
            public static readonly PropertyInfo IsFocusedProperty = GetProperty("isFocused");
            public static readonly PropertyInfo InteractableProperty = GetProperty("interactable");
            public static readonly PropertyInfo LineTypeProperty = GetProperty("lineType");
            public static readonly PropertyInfo AnchorProperty = GetProperty("selectionAnchorPosition");
            public static readonly PropertyInfo FocusProperty = GetProperty("selectionFocusPosition");
            public static readonly PropertyInfo CaretWidthProperty = GetProperty("caretWidth");
            public static readonly PropertyInfo SubmitEventProperty = GetProperty("onSubmit");
            public static readonly MethodInfo MoveLeftMethod = GetNavigationMethod("MoveLeft", typeof(bool), typeof(bool));
            public static readonly MethodInfo MoveRightMethod = GetNavigationMethod("MoveRight", typeof(bool), typeof(bool));
            public static readonly MethodInfo MoveUpMethod = GetNavigationMethod("MoveUp", typeof(bool));
            public static readonly MethodInfo MoveDownMethod = GetNavigationMethod("MoveDown", typeof(bool));
            public static readonly MethodInfo ForceLabelUpdateMethod = GetPublicMethod("ForceLabelUpdate");
            public static readonly MethodInfo ProcessEventMethod = GetPublicMethod("ProcessEvent", typeof(Event));
            public static readonly MethodInfo SendOnSubmitMethod = GetNonPublicMethod("SendOnSubmit");
            public static readonly MethodInfo DeactivateInputFieldMethod = GetPublicMethod("DeactivateInputField");

            public static Type InputType
            {
                get { return CachedInputType; }
            }

            public static bool HasRequiredApi
            {
                get
                {
                    return CachedInputType != null && TextProperty != null && ReadOnlyProperty != null &&
                           IsFocusedProperty != null && InteractableProperty != null && LineTypeProperty != null &&
                           AnchorProperty != null && FocusProperty != null;
                }
            }

            public static bool IsLegacyInput(Component component)
            {
                return component != null && CachedInputType != null && CachedInputType.IsInstanceOfType(component);
            }

            private static PropertyInfo GetProperty(string name)
            {
                return CachedInputType != null
                    ? CachedInputType.GetProperty(name, BindingFlags.Instance | BindingFlags.Public)
                    : null;
            }

            private static MethodInfo GetNavigationMethod(string name, params Type[] parameterTypes)
            {
                return CachedInputType != null
                    ? CachedInputType.GetMethod(
                        name,
                        BindingFlags.Instance | BindingFlags.NonPublic,
                        null,
                        parameterTypes,
                        null)
                    : null;
            }

            private static MethodInfo GetPublicMethod(string name, params Type[] parameterTypes)
            {
                return CachedInputType != null
                    ? CachedInputType.GetMethod(
                        name,
                        BindingFlags.Instance | BindingFlags.Public,
                        null,
                        parameterTypes,
                        null)
                    : null;
            }

            private static MethodInfo GetNonPublicMethod(string name)
            {
                return CachedInputType != null
                    ? CachedInputType.GetMethod(
                        name,
                        BindingFlags.Instance | BindingFlags.NonPublic,
                        null,
                        Type.EmptyTypes,
                        null)
                    : null;
            }
        }

        private static class TmpInputReflection
        {
            private static readonly Type CachedInputType = FindInputType();

            public static readonly PropertyInfo TextProperty = GetProperty("text");
            public static readonly PropertyInfo ReadOnlyProperty = GetProperty("readOnly");
            public static readonly PropertyInfo IsFocusedProperty = GetProperty("isFocused");
            public static readonly PropertyInfo InteractableProperty = GetProperty("interactable");
            public static readonly PropertyInfo LineTypeProperty = GetProperty("lineType");
            public static readonly PropertyInfo AnchorProperty = GetFirstProperty(
                "selectionStringAnchorPosition",
                "selectionAnchorPosition");
            public static readonly PropertyInfo FocusProperty = GetFirstProperty(
                "selectionStringFocusPosition",
                "selectionFocusPosition");
            public static readonly PropertyInfo CaretWidthProperty = GetProperty("caretWidth");
            public static readonly MethodInfo MoveLeftMethod = GetNavigationMethod("MoveLeft", typeof(bool), typeof(bool));
            public static readonly MethodInfo MoveRightMethod = GetNavigationMethod("MoveRight", typeof(bool), typeof(bool));
            public static readonly MethodInfo MoveUpMethod = GetNavigationMethod("MoveUp", typeof(bool));
            public static readonly MethodInfo MoveDownMethod = GetNavigationMethod("MoveDown", typeof(bool));
            public static readonly MethodInfo ForceLabelUpdateMethod = GetPublicMethod("ForceLabelUpdate");
            public static readonly MethodInfo ProcessEventMethod = GetPublicMethod("ProcessEvent", typeof(Event));
            public static readonly MethodInfo SendOnSubmitMethod = GetNonPublicMethod("SendOnSubmit");
            public static readonly MethodInfo DeactivateInputFieldMethod = GetPublicMethod(
                "DeactivateInputField",
                typeof(bool));

            public static Type InputType
            {
                get { return CachedInputType; }
            }

            public static bool HasRequiredApi
            {
                get
                {
                    return CachedInputType != null && TextProperty != null && ReadOnlyProperty != null &&
                           IsFocusedProperty != null && InteractableProperty != null && LineTypeProperty != null &&
                           AnchorProperty != null && FocusProperty != null;
                }
            }

            public static bool IsTmpInput(Component component)
            {
                return component != null && CachedInputType != null && CachedInputType.IsInstanceOfType(component);
            }

            public static object GetValue(Component component, PropertyInfo property)
            {
                return component != null && property != null ? property.GetValue(component, null) : null;
            }

            public static string GetString(Component component, PropertyInfo property)
            {
                return GetValue(component, property) as string;
            }

            public static int GetInt(Component component, PropertyInfo property)
            {
                object value = GetValue(component, property);
                return value is int ? (int)value : 0;
            }

            public static bool GetBool(Component component, PropertyInfo property, bool fallback)
            {
                object value = GetValue(component, property);
                return value is bool ? (bool)value : fallback;
            }

            public static void SetValue(Component component, PropertyInfo property, object value)
            {
                if (component != null && property != null && property.CanWrite)
                {
                    property.SetValue(component, value, null);
                }
            }

            private static Type FindInputType()
            {
                return FindType("TMPro.TMP_InputField", "Unity.TextMeshPro");
            }

            private static PropertyInfo GetProperty(string name)
            {
                return CachedInputType != null
                    ? CachedInputType.GetProperty(name, BindingFlags.Instance | BindingFlags.Public)
                    : null;
            }

            private static PropertyInfo GetFirstProperty(string firstName, string secondName)
            {
                PropertyInfo property = GetProperty(firstName);
                return property ?? GetProperty(secondName);
            }

            private static MethodInfo GetNavigationMethod(string name, params Type[] parameterTypes)
            {
                return CachedInputType != null
                    ? CachedInputType.GetMethod(
                        name,
                        BindingFlags.Instance | BindingFlags.NonPublic,
                        null,
                        parameterTypes,
                        null)
                    : null;
            }

            private static MethodInfo GetPublicMethod(string name, params Type[] parameterTypes)
            {
                return CachedInputType != null
                    ? CachedInputType.GetMethod(
                        name,
                        BindingFlags.Instance | BindingFlags.Public,
                        null,
                        parameterTypes,
                        null)
                    : null;
            }

            private static MethodInfo GetNonPublicMethod(string name)
            {
                return CachedInputType != null
                    ? CachedInputType.GetMethod(
                        name,
                        BindingFlags.Instance | BindingFlags.NonPublic,
                        null,
                        Type.EmptyTypes,
                        null)
                    : null;
            }
        }

        private static Type FindType(string fullName, string assemblyName)
        {
            Type type = Type.GetType(fullName + ", " + assemblyName, false);
            if (type != null)
            {
                return type;
            }

            Assembly[] assemblies = AppDomain.CurrentDomain.GetAssemblies();
            for (int i = 0; i < assemblies.Length; i++)
            {
                type = assemblies[i].GetType(fullName, false);
                if (type != null)
                {
                    return type;
                }
            }

            return null;
        }
    }

    internal sealed class WebGLInputRuntimeDriver : MonoBehaviour
    {
        private void Update()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            WebGLClipboardPasteBridge.UpdateBrowserTextInput();
#endif
        }

        private void OnDestroy()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            WebGLClipboardPasteBridge.ShutdownBrowserTextInput();
#endif
        }
    }

    [DefaultExecutionOrder(32000)]
    internal sealed class WebGLPointerReleaseRuntimeDriver : MonoBehaviour
    {
        private void LateUpdate()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            WebGLClipboardPasteBridge.StabilizePendingBrowserPointerDownAnchor();
            WebGLClipboardPasteBridge.RecoverPendingBrowserPointerRelease();
#endif
        }
    }
}
