using Yvsim.WebGLInput;
using NUnit.Framework;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

public sealed class WebGLInputTextEditingTests
{
    [Test]
    public void TmpInput_PasteReplacesSelectionAndPreservesUnicode()
    {
        GameObject gameObject = new GameObject("TMP Input", typeof(RectTransform), typeof(TMP_InputField));
        try
        {
            TMP_InputField input = gameObject.GetComponent<TMP_InputField>();
            input.lineType = TMP_InputField.LineType.MultiLineNewline;
            input.text = "A中文Z";
            input.selectionStringAnchorPosition = 1;
            input.selectionStringFocusPosition = 3;

            Assert.That(WebGLClipboardPasteBridge.PasteIntoInput(input, "😀&\n第二行"), Is.True);
            Assert.That(input.text, Is.EqualTo("A😀&\n第二行Z"));
            Assert.That(input.selectionStringAnchorPosition, Is.EqualTo(8));
            Assert.That(input.selectionStringFocusPosition, Is.EqualTo(8));
        }
        finally
        {
            Object.DestroyImmediate(gameObject);
        }
    }

    [Test]
    public void TmpInput_SingleLinePasteRemovesLineBreaks()
    {
        GameObject gameObject = new GameObject("TMP Input", typeof(RectTransform), typeof(TMP_InputField));
        try
        {
            TMP_InputField input = gameObject.GetComponent<TMP_InputField>();
            input.lineType = TMP_InputField.LineType.SingleLine;
            input.text = string.Empty;

            Assert.That(WebGLClipboardPasteBridge.PasteIntoInput(input, "第一行\r\n第二行\n第三行"), Is.True);
            Assert.That(input.text, Is.EqualTo("第一行第二行第三行"));
        }
        finally
        {
            Object.DestroyImmediate(gameObject);
        }
    }

    [Test]
    public void TmpInput_CopyReturnsExactSelectedText()
    {
        GameObject gameObject = new GameObject("TMP Input", typeof(RectTransform), typeof(TMP_InputField));
        try
        {
            TMP_InputField input = gameObject.GetComponent<TMP_InputField>();
            input.text = "前缀😀中文&符号后缀";
            input.selectionStringAnchorPosition = 2;
            input.selectionStringFocusPosition = 8;

            Assert.That(WebGLClipboardPasteBridge.TryGetSelectedText(input, out string value), Is.True);
            Assert.That(value, Is.EqualTo("😀中文&符"));
        }
        finally
        {
            Object.DestroyImmediate(gameObject);
        }
    }

    [Test]
    public void LegacyInput_PasteAndCopyUseCurrentSelection()
    {
        GameObject gameObject = new GameObject("Legacy Input", typeof(RectTransform), typeof(InputField));
        try
        {
            InputField input = gameObject.GetComponent<InputField>();
            input.lineType = InputField.LineType.MultiLineNewline;
            input.text = "left-right";
            input.selectionAnchorPosition = 4;
            input.selectionFocusPosition = 5;

            Assert.That(WebGLClipboardPasteBridge.PasteIntoInput(input, "中文\n"), Is.True);
            Assert.That(input.text, Is.EqualTo("left中文\nright"));

            input.selectionAnchorPosition = 3;
            input.selectionFocusPosition = 8;
            Assert.That(WebGLClipboardPasteBridge.TryGetSelectedText(input, out string value), Is.True);
            Assert.That(value, Is.EqualTo("t中文\nr"));
        }
        finally
        {
            Object.DestroyImmediate(gameObject);
        }
    }

    [Test]
    public void CopyWithoutSelectionReturnsFalse()
    {
        GameObject gameObject = new GameObject("TMP Input", typeof(RectTransform), typeof(TMP_InputField));
        try
        {
            TMP_InputField input = gameObject.GetComponent<TMP_InputField>();
            input.text = "text";
            input.selectionStringAnchorPosition = 2;
            input.selectionStringFocusPosition = 2;

            Assert.That(WebGLClipboardPasteBridge.TryGetSelectedText(input, out string value), Is.False);
            Assert.That(value, Is.Null);
        }
        finally
        {
            Object.DestroyImmediate(gameObject);
        }
    }

    [Test]
    public void TmpInput_FallbackNavigationPreservesLogicalLineColumn()
    {
        GameObject gameObject = new GameObject("TMP Input", typeof(RectTransform), typeof(TMP_InputField));
        try
        {
            TMP_InputField input = gameObject.GetComponent<TMP_InputField>();
            input.lineType = TMP_InputField.LineType.MultiLineNewline;
            input.text = "12345\n12\n12345";
            input.selectionStringAnchorPosition = 4;
            input.selectionStringFocusPosition = 4;

            Assert.That(MoveCaret(input, false, 3), Is.True);
            Assert.That(input.selectionStringFocusPosition, Is.EqualTo(8));

            Assert.That(MoveCaret(input, false, 3), Is.True);
            Assert.That(input.selectionStringFocusPosition, Is.EqualTo(11));

            Assert.That(MoveCaret(input, false, 2), Is.True);
            Assert.That(input.selectionStringFocusPosition, Is.EqualTo(8));
        }
        finally
        {
            UnityEngine.Object.DestroyImmediate(gameObject);
        }
    }

    [Test]
    public void ActiveInput_CaretWidthIsRaisedToThreePixels()
    {
        RestoreOriginalCaretWidth();
        GameObject tmpObject = new GameObject("TMP Input", typeof(RectTransform), typeof(TMP_InputField));
        GameObject legacyObject = new GameObject("Legacy Input", typeof(RectTransform), typeof(InputField));
        try
        {
            TMP_InputField tmpInput = tmpObject.GetComponent<TMP_InputField>();
            InputField legacyInput = legacyObject.GetComponent<InputField>();
            tmpInput.caretWidth = 1;
            legacyInput.caretWidth = 2;

            // 同一时刻只有一个活动输入框，因此逐个验证抬高行为。
            EnsureVisibleCaret(tmpInput, false);
            Assert.That(tmpInput.caretWidth, Is.EqualTo(3));

            RestoreOriginalCaretWidth();
            EnsureVisibleCaret(legacyInput, true);
            Assert.That(legacyInput.caretWidth, Is.EqualTo(3));
        }
        finally
        {
            RestoreOriginalCaretWidth();
            UnityEngine.Object.DestroyImmediate(tmpObject);
            UnityEngine.Object.DestroyImmediate(legacyObject);
        }
    }

    [Test]
    public void ActiveInput_CaretWidthIsRestoredWhenSessionEndsOrSwitchesInput()
    {
        RestoreOriginalCaretWidth();
        GameObject tmpObject = new GameObject("TMP Input", typeof(RectTransform), typeof(TMP_InputField));
        GameObject legacyObject = new GameObject("Legacy Input", typeof(RectTransform), typeof(InputField));
        try
        {
            TMP_InputField tmpInput = tmpObject.GetComponent<TMP_InputField>();
            InputField legacyInput = legacyObject.GetComponent<InputField>();
            tmpInput.caretWidth = 1;
            legacyInput.caretWidth = 2;

            EnsureVisibleCaret(tmpInput, false);
            Assert.That(tmpInput.caretWidth, Is.EqualTo(3));

            // 切换到另一个输入框时先恢复上一个输入框的原值。
            EnsureVisibleCaret(legacyInput, true);
            Assert.That(tmpInput.caretWidth, Is.EqualTo(1));
            Assert.That(legacyInput.caretWidth, Is.EqualTo(3));

            RestoreOriginalCaretWidth();
            Assert.That(legacyInput.caretWidth, Is.EqualTo(2));

            // 本来就足够宽的光标既不会被改写，也不会被记录。
            tmpInput.caretWidth = 5;
            EnsureVisibleCaret(tmpInput, false);
            Assert.That(tmpInput.caretWidth, Is.EqualTo(5));
            RestoreOriginalCaretWidth();
            Assert.That(tmpInput.caretWidth, Is.EqualTo(5));
        }
        finally
        {
            RestoreOriginalCaretWidth();
            UnityEngine.Object.DestroyImmediate(tmpObject);
            UnityEngine.Object.DestroyImmediate(legacyObject);
        }
    }

    [Test]
    public void TmpInput_LineModesMapToAllUnityOptions()
    {
        GameObject gameObject = new GameObject("TMP Input", typeof(RectTransform), typeof(TMP_InputField));
        try
        {
            TMP_InputField input = gameObject.GetComponent<TMP_InputField>();

            input.lineType = TMP_InputField.LineType.SingleLine;
            Assert.That(GetLineMode(input, false), Is.EqualTo(0));

            input.lineType = TMP_InputField.LineType.MultiLineSubmit;
            Assert.That(GetLineMode(input, false), Is.EqualTo(1));

            input.lineType = TMP_InputField.LineType.MultiLineNewline;
            Assert.That(GetLineMode(input, false), Is.EqualTo(2));
        }
        finally
        {
            Object.DestroyImmediate(gameObject);
        }
    }

    [Test]
    public void LegacyInput_LineModesMapToAllUnityOptions()
    {
        GameObject gameObject = new GameObject("Legacy Input", typeof(RectTransform), typeof(InputField));
        try
        {
            InputField input = gameObject.GetComponent<InputField>();

            input.lineType = InputField.LineType.SingleLine;
            Assert.That(GetLineMode(input, true), Is.EqualTo(0));

            input.lineType = InputField.LineType.MultiLineSubmit;
            Assert.That(GetLineMode(input, true), Is.EqualTo(1));

            input.lineType = InputField.LineType.MultiLineNewline;
            Assert.That(GetLineMode(input, true), Is.EqualTo(2));
        }
        finally
        {
            Object.DestroyImmediate(gameObject);
        }
    }

    [Test]
    public void TmpInput_SubmitModesMatchUnityEventOrderAndDeactivate()
    {
        AssertTmpSubmitMode(TMP_InputField.LineType.SingleLine, false);
        AssertTmpSubmitMode(TMP_InputField.LineType.MultiLineSubmit, true);
    }

    [Test]
    public void LegacyInput_SubmitModesMatchUnityEventOrderAndDeactivate()
    {
        AssertLegacySubmitMode(InputField.LineType.SingleLine, false);
        AssertLegacySubmitMode(InputField.LineType.MultiLineSubmit, true);
    }

    [Test]
    public void TmpInput_MultiLineNewlineKeepsEditingAndUsesUnityShiftEnter()
    {
        GameObject gameObject = CreateTmpInput(out TMP_InputField input);
        try
        {
            List<string> events = new List<string>();
            input.lineType = TMP_InputField.LineType.MultiLineNewline;
            input.text = "A";
            input.selectionStringAnchorPosition = 1;
            input.selectionStringFocusPosition = 1;
            input.onSubmit.AddListener(value => events.Add("submit"));
            input.onEndEdit.AddListener(value => events.Add("end"));
            SetFocused(input);

            Assert.That(ProcessEnter(input, false, false, 0, out bool finished), Is.True);
            Assert.That(finished, Is.False);
            Assert.That(input.text, Is.EqualTo("A\n"));
            Assert.That(input.isFocused, Is.True);

            Assert.That(ProcessEnter(input, false, false, 1, out finished), Is.True);
            Assert.That(finished, Is.False);
            Assert.That(input.text, Is.EqualTo("A\n\v"));
            Assert.That(input.isFocused, Is.True);
            Assert.That(events, Is.Empty);
        }
        finally
        {
            Object.DestroyImmediate(gameObject);
        }
    }

    [Test]
    public void LegacyInput_MultiLineNewlineKeepsEditingForShiftEnter()
    {
        GameObject gameObject = CreateLegacyInput(out InputField input);
        try
        {
            List<string> events = new List<string>();
            input.lineType = InputField.LineType.MultiLineNewline;
            input.text = "A";
            input.selectionAnchorPosition = 1;
            input.selectionFocusPosition = 1;
#if UNITY_2021_1_OR_NEWER
            input.onSubmit.AddListener(value => events.Add("submit"));
#endif
            input.onEndEdit.AddListener(value => events.Add("end"));
            SetFocused(input);

            Assert.That(ProcessEnter(input, true, false, 1, out bool finished), Is.True);
            Assert.That(finished, Is.False);
            Assert.That(input.text, Is.EqualTo("A\n"));
            Assert.That(input.isFocused, Is.True);
            Assert.That(events, Is.Empty);
        }
        finally
        {
            Object.DestroyImmediate(gameObject);
        }
    }

    [Test]
    public void PointerReleaseRecovery_ClearsClickStateExactlyOnce()
    {
        List<EventSystem> previousEventSystems = CaptureEventSystems();
        GameObject eventSystemObject = new GameObject(
            "EventSystem",
            typeof(EventSystem),
            typeof(StandaloneInputModule));
        GameObject inputObject = new GameObject("Input", typeof(PointerReleaseRecorder));
        try
        {
            EventSystem eventSystem = eventSystemObject.GetComponent<EventSystem>();
            StandaloneInputModule inputModule =
                eventSystemObject.GetComponent<StandaloneInputModule>();
            MakeCurrentEventSystem(eventSystem);
            SetCurrentInputModule(eventSystem, inputModule);

            PointerEventData pointerData = CreatePointerData(eventSystem, inputObject);
            pointerData.eligibleForClick = true;
            pointerData.dragging = false;
            SetLeftPointerData(inputModule, pointerData);

            PointerReleaseRecorder recorder =
                inputObject.GetComponent<PointerReleaseRecorder>();
            Assert.That(RecoverPointerRelease(true), Is.False);
            Assert.That(recorder.PointerUpCount, Is.Zero);

            Assert.That(RecoverPointerRelease(false), Is.True);
            Assert.That(recorder.PointerUpCount, Is.EqualTo(1));
            Assert.That(recorder.PointerClickCount, Is.EqualTo(1));
            Assert.That(pointerData.eligibleForClick, Is.False);
            Assert.That(pointerData.pointerPress, Is.Null);
#if UNITY_2021_1_OR_NEWER
            Assert.That(pointerData.pointerClick, Is.Null);
#endif
            Assert.That(pointerData.pointerDrag, Is.Null);
            Assert.That(pointerData.dragging, Is.False);

            Assert.That(RecoverPointerRelease(false), Is.False);
            Assert.That(recorder.PointerUpCount, Is.EqualTo(1));
            Assert.That(recorder.PointerClickCount, Is.EqualTo(1));
        }
        finally
        {
            Object.DestroyImmediate(inputObject);
            Object.DestroyImmediate(eventSystemObject);
            RestoreEventSystems(previousEventSystems);
        }
    }

    [Test]
    public void PointerReleaseRecovery_EndsDragAndDropsWithoutClick()
    {
        List<EventSystem> previousEventSystems = CaptureEventSystems();
        GameObject eventSystemObject = new GameObject(
            "EventSystem",
            typeof(EventSystem),
            typeof(StandaloneInputModule));
        GameObject inputObject = new GameObject("Input", typeof(PointerReleaseRecorder));
        GameObject dropObject = new GameObject("Drop", typeof(PointerReleaseRecorder));
        try
        {
            EventSystem eventSystem = eventSystemObject.GetComponent<EventSystem>();
            StandaloneInputModule inputModule =
                eventSystemObject.GetComponent<StandaloneInputModule>();
            MakeCurrentEventSystem(eventSystem);
            SetCurrentInputModule(eventSystem, inputModule);

            PointerEventData pointerData = CreatePointerData(eventSystem, inputObject);
            pointerData.eligibleForClick = false;
            pointerData.dragging = true;
            pointerData.pointerCurrentRaycast = new RaycastResult { gameObject = dropObject };
            SetLeftPointerData(inputModule, pointerData);

            Assert.That(RecoverPointerRelease(false), Is.True);
            PointerReleaseRecorder inputRecorder =
                inputObject.GetComponent<PointerReleaseRecorder>();
            PointerReleaseRecorder dropRecorder =
                dropObject.GetComponent<PointerReleaseRecorder>();
            Assert.That(inputRecorder.PointerUpCount, Is.EqualTo(1));
            Assert.That(inputRecorder.PointerClickCount, Is.Zero);
            Assert.That(inputRecorder.EndDragCount, Is.EqualTo(1));
            Assert.That(dropRecorder.DropCount, Is.EqualTo(1));
            Assert.That(pointerData.pointerDrag, Is.Null);
            Assert.That(pointerData.dragging, Is.False);
        }
        finally
        {
            Object.DestroyImmediate(dropObject);
            Object.DestroyImmediate(inputObject);
            Object.DestroyImmediate(eventSystemObject);
            RestoreEventSystems(previousEventSystems);
        }
    }

    [Test]
    public void PointerReleaseRecovery_DraggedGestureNeverSynthesizesClick()
    {
        List<EventSystem> previousEventSystems = CaptureEventSystems();
        GameObject eventSystemObject = new GameObject(
            "EventSystem",
            typeof(EventSystem),
            typeof(StandaloneInputModule));
        GameObject inputObject = new GameObject("Input", typeof(PointerReleaseRecorder));
        GameObject dropObject = new GameObject("Drop", typeof(PointerReleaseRecorder));
        try
        {
            EventSystem eventSystem = eventSystemObject.GetComponent<EventSystem>();
            StandaloneInputModule inputModule =
                eventSystemObject.GetComponent<StandaloneInputModule>();
            MakeCurrentEventSystem(eventSystem);
            SetCurrentInputModule(eventSystem, inputModule);

            // 拖选场景：Unity 漏掉了松开边沿，此时 eligibleForClick 仍然是 true。
            // 补发的释放绝不能产生 PointerClick，否则输入框会重新激活并全选。
            PointerEventData pointerData = CreatePointerData(eventSystem, inputObject);
            pointerData.eligibleForClick = true;
            pointerData.dragging = true;
            pointerData.pointerCurrentRaycast = new RaycastResult { gameObject = dropObject };
            SetLeftPointerData(inputModule, pointerData);

            Assert.That(RecoverPointerRelease(false), Is.True);

            PointerReleaseRecorder inputRecorder =
                inputObject.GetComponent<PointerReleaseRecorder>();
            PointerReleaseRecorder dropRecorder =
                dropObject.GetComponent<PointerReleaseRecorder>();
            Assert.That(inputRecorder.PointerClickCount, Is.Zero);
            Assert.That(inputRecorder.PointerUpCount, Is.EqualTo(1));
            Assert.That(inputRecorder.EndDragCount, Is.EqualTo(1));
            // 真实的松开（不是中断）仍然要保留拖放语义。
            Assert.That(dropRecorder.DropCount, Is.EqualTo(1));
            Assert.That(pointerData.dragging, Is.False);
            Assert.That(pointerData.pointerPress, Is.Null);
        }
        finally
        {
            Object.DestroyImmediate(dropObject);
            Object.DestroyImmediate(inputObject);
            Object.DestroyImmediate(eventSystemObject);
            RestoreEventSystems(previousEventSystems);
        }
    }

    [Test]
    public void PointerCancel_ClearsPressAndDragWithoutClickOrDrop()
    {
        List<EventSystem> previousEventSystems = CaptureEventSystems();
        GameObject eventSystemObject = new GameObject(
            "EventSystem",
            typeof(EventSystem),
            typeof(StandaloneInputModule));
        GameObject inputObject = new GameObject("Input", typeof(PointerReleaseRecorder));
        GameObject dropObject = new GameObject("Drop", typeof(PointerReleaseRecorder));
        try
        {
            EventSystem eventSystem = eventSystemObject.GetComponent<EventSystem>();
            StandaloneInputModule inputModule =
                eventSystemObject.GetComponent<StandaloneInputModule>();
            MakeCurrentEventSystem(eventSystem);
            SetCurrentInputModule(eventSystem, inputModule);

            PointerEventData pointerData = CreatePointerData(eventSystem, inputObject);
            pointerData.eligibleForClick = true;
            pointerData.dragging = true;
            pointerData.pointerCurrentRaycast = new RaycastResult { gameObject = dropObject };
            SetLeftPointerData(inputModule, pointerData);

            Assert.That(CancelPointerPress(), Is.True);

            PointerReleaseRecorder inputRecorder =
                inputObject.GetComponent<PointerReleaseRecorder>();
            PointerReleaseRecorder dropRecorder =
                dropObject.GetComponent<PointerReleaseRecorder>();
            Assert.That(inputRecorder.PointerUpCount, Is.EqualTo(1));
            Assert.That(inputRecorder.EndDragCount, Is.EqualTo(1));
            // 中断的手势没有产生浏览器 click，也不应该产生 drop。
            Assert.That(inputRecorder.PointerClickCount, Is.Zero);
            Assert.That(dropRecorder.DropCount, Is.Zero);
            Assert.That(pointerData.eligibleForClick, Is.False);
            Assert.That(pointerData.pointerPress, Is.Null);
            Assert.That(pointerData.rawPointerPress, Is.Null);
#if UNITY_2021_1_OR_NEWER
            Assert.That(pointerData.pointerClick, Is.Null);
#endif
            Assert.That(pointerData.pointerDrag, Is.Null);
            Assert.That(pointerData.dragging, Is.False);

            Assert.That(CancelPointerPress(), Is.False);
            Assert.That(inputRecorder.PointerUpCount, Is.EqualTo(1));
            Assert.That(inputRecorder.EndDragCount, Is.EqualTo(1));
        }
        finally
        {
            Object.DestroyImmediate(dropObject);
            Object.DestroyImmediate(inputObject);
            Object.DestroyImmediate(eventSystemObject);
            RestoreEventSystems(previousEventSystems);
        }
    }

    [Test]
    public void BrowserPointerCancelQueue_TakesPriorityOverPendingRelease()
    {
        FieldInfo releaseField = typeof(WebGLClipboardPasteBridge).GetField(
            "pointerReleaseRecoveryPending",
            BindingFlags.Static | BindingFlags.NonPublic);
        FieldInfo cancelField = typeof(WebGLClipboardPasteBridge).GetField(
            "pointerCancelRecoveryPending",
            BindingFlags.Static | BindingFlags.NonPublic);
        MethodInfo queueCancel = typeof(WebGLClipboardPasteBridge).GetMethod(
            "QueueBrowserPointerCancelRecovery",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.That(releaseField, Is.Not.Null);
        Assert.That(cancelField, Is.Not.Null);
        Assert.That(queueCancel, Is.Not.Null);

        releaseField.SetValue(null, false);
        cancelField.SetValue(null, false);
        try
        {
            queueCancel.Invoke(null, null);
            Assert.That((bool)cancelField.GetValue(null), Is.True);
            Assert.That((bool)releaseField.GetValue(null), Is.False);
        }
        finally
        {
            releaseField.SetValue(null, false);
            cancelField.SetValue(null, false);
        }
    }

    [Test]
    public void BrowserPointerReleaseQueue_DoesNotRequireActiveInput()
    {
        FieldInfo pendingField = typeof(WebGLClipboardPasteBridge).GetField(
            "pointerReleaseRecoveryPending",
            BindingFlags.Static | BindingFlags.NonPublic);
        MethodInfo queueRecovery = typeof(WebGLClipboardPasteBridge).GetMethod(
            "QueueBrowserPointerReleaseRecovery",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.That(pendingField, Is.Not.Null);
        Assert.That(queueRecovery, Is.Not.Null);

        pendingField.SetValue(null, false);
        try
        {
            queueRecovery.Invoke(null, null);
            Assert.That((bool)pendingField.GetValue(null), Is.True);
        }
        finally
        {
            pendingField.SetValue(null, false);
        }
    }

    [Test]
    public void DeferredPointerRelease_WaitsForUnityToConsumeMouseUpFirst()
    {
        List<EventSystem> previousEventSystems = CaptureEventSystems();
        GameObject eventSystemObject = new GameObject(
            "EventSystem",
            typeof(EventSystem),
            typeof(StandaloneInputModule));
        GameObject inputObject = new GameObject("Input", typeof(PointerReleaseRecorder));
        try
        {
            EventSystem eventSystem = eventSystemObject.GetComponent<EventSystem>();
            StandaloneInputModule inputModule =
                eventSystemObject.GetComponent<StandaloneInputModule>();
            MakeCurrentEventSystem(eventSystem);
            SetCurrentInputModule(eventSystem, inputModule);

            // 浏览器 mouseup 已派发但 Unity 尚未消费：PointerEventData 残留按下状态。
            PointerEventData pointerData = CreatePointerData(eventSystem, inputObject);
            pointerData.eligibleForClick = true;
            pointerData.dragging = false;
            SetLeftPointerData(inputModule, pointerData);
            ResetDeferredReleaseMissedCount();

            // 第一帧：残留存在，补发必须延迟，给 Unity 原生 mouseup 消费留窗口。
            Assert.That(DeferPointerReleaseRecovery(false), Is.True);
            // 残留被 Unity 清掉（下一帧 StandaloneInputModule 已处理 mouseup）。
            pointerData.eligibleForClick = false;
            pointerData.pointerPress = null;
#if UNITY_2021_1_OR_NEWER
            pointerData.pointerClick = null;
#endif
            pointerData.pointerDrag = null;
            Assert.That(DeferPointerReleaseRecovery(false), Is.False);
            Assert.That(RecoverPointerRelease(false), Is.False);

            PointerReleaseRecorder recorder =
                inputObject.GetComponent<PointerReleaseRecorder>();
            Assert.That(recorder.PointerUpCount, Is.Zero);
            Assert.That(recorder.PointerClickCount, Is.Zero);
        }
        finally
        {
            ResetDeferredReleaseMissedCount();
            Object.DestroyImmediate(inputObject);
            Object.DestroyImmediate(eventSystemObject);
            RestoreEventSystems(previousEventSystems);
        }
    }

    [Test]
    public void DeferredPointerRelease_StillRecoversWhenUnityDropsMouseUp()
    {
        List<EventSystem> previousEventSystems = CaptureEventSystems();
        GameObject eventSystemObject = new GameObject(
            "EventSystem",
            typeof(EventSystem),
            typeof(StandaloneInputModule));
        GameObject inputObject = new GameObject("Input", typeof(PointerReleaseRecorder));
        try
        {
            EventSystem eventSystem = eventSystemObject.GetComponent<EventSystem>();
            StandaloneInputModule inputModule =
                eventSystemObject.GetComponent<StandaloneInputModule>();
            MakeCurrentEventSystem(eventSystem);
            SetCurrentInputModule(eventSystem, inputModule);

            // 事件真实丢失：残留按下状态持续存在，鼠标已松开。
            PointerEventData pointerData = CreatePointerData(eventSystem, inputObject);
            pointerData.eligibleForClick = true;
            pointerData.dragging = false;
            SetLeftPointerData(inputModule, pointerData);
            ResetDeferredReleaseMissedCount();

            // 连续两帧都残留：第一帧延迟，第二帧确认丢失后补发。
            Assert.That(DeferPointerReleaseRecovery(false), Is.True);
            Assert.That(DeferPointerReleaseRecovery(false), Is.False);

            // DeferPointerReleaseRecovery 返回 false 后，调用方（RecoverPendingBrowserPointerRelease）
            // 会执行补发；这里模拟该路径。
            Assert.That(RecoverPointerRelease(false), Is.True);

            PointerReleaseRecorder recorder =
                inputObject.GetComponent<PointerReleaseRecorder>();
            Assert.That(recorder.PointerUpCount, Is.EqualTo(1));
            Assert.That(recorder.PointerClickCount, Is.EqualTo(1));
            Assert.That(pointerData.eligibleForClick, Is.False);
            Assert.That(pointerData.pointerPress, Is.Null);
        }
        finally
        {
            ResetDeferredReleaseMissedCount();
            Object.DestroyImmediate(inputObject);
            Object.DestroyImmediate(eventSystemObject);
            RestoreEventSystems(previousEventSystems);
        }
    }

    [Test]
    public void DeferredPointerRelease_ResetsMissCountWhenMouseStillHeld()
    {
        FieldInfo missedField = typeof(WebGLClipboardPasteBridge).GetField(
            "pointerReleaseMissedFrameCount",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.That(missedField, Is.Not.Null);
        missedField.SetValue(null, 0);
        try
        {
            // 鼠标仍按住：不累计丢失帧，继续等待。
            Assert.That(DeferPointerReleaseRecovery(true), Is.True);
            Assert.That((int)missedField.GetValue(null), Is.EqualTo(0));
        }
        finally
        {
            missedField.SetValue(null, 0);
        }
    }

    private static bool DeferPointerReleaseRecovery(bool mouseHeld)
    {
        MethodInfo method = typeof(WebGLClipboardPasteBridge).GetMethod(
            "DeferPointerReleaseRecovery",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.That(method, Is.Not.Null);
        return (bool)method.Invoke(null, new object[] { mouseHeld });
    }

    private static void ResetDeferredReleaseMissedCount()
    {
        FieldInfo missedField = typeof(WebGLClipboardPasteBridge).GetField(
            "pointerReleaseMissedFrameCount",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.That(missedField, Is.Not.Null);
        missedField.SetValue(null, 0);
    }

    private static List<EventSystem> CaptureEventSystems()
    {
        IList systems = GetEventSystems();
        List<EventSystem> snapshot = new List<EventSystem>(systems.Count);
        for (int i = 0; i < systems.Count; i++)
        {
            snapshot.Add((EventSystem)systems[i]);
        }

        return snapshot;
    }

    private static void MakeCurrentEventSystem(EventSystem eventSystem)
    {
        IList systems = GetEventSystems();
        int existingIndex = systems.IndexOf(eventSystem);
        if (existingIndex >= 0)
        {
            systems.RemoveAt(existingIndex);
        }

        systems.Insert(0, eventSystem);
        Assert.That(EventSystem.current, Is.SameAs(eventSystem));
    }

    private static void RestoreEventSystems(List<EventSystem> snapshot)
    {
        IList systems = GetEventSystems();
        systems.Clear();
        for (int i = 0; i < snapshot.Count; i++)
        {
            if (snapshot[i] != null)
            {
                systems.Add(snapshot[i]);
            }
        }
    }

    private static IList GetEventSystems()
    {
        FieldInfo field = typeof(EventSystem).GetField(
            "m_EventSystems",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.That(field, Is.Not.Null);
        IList systems = field.GetValue(null) as IList;
        Assert.That(systems, Is.Not.Null);
        return systems;
    }

    private static PointerEventData CreatePointerData(
        EventSystem eventSystem,
        GameObject inputObject)
    {
        return new PointerEventData(eventSystem)
        {
            pointerId = -1,
            button = PointerEventData.InputButton.Left,
            pointerPress = inputObject,
            rawPointerPress = inputObject,
#if UNITY_2021_1_OR_NEWER
            pointerClick = inputObject,
#endif
            pointerDrag = inputObject,
            pointerEnter = inputObject,
            pointerCurrentRaycast = new RaycastResult { gameObject = inputObject }
        };
    }

    private static bool RecoverPointerRelease(bool mouseHeld)
    {
        System.Type reflectionType = typeof(WebGLClipboardPasteBridge).GetNestedType(
            "EventSystemReflection",
            BindingFlags.NonPublic);
        Assert.That(reflectionType, Is.Not.Null);
        MethodInfo method = reflectionType.GetMethod(
            "TryRecoverMissedPointerRelease",
            BindingFlags.Static | BindingFlags.Public);
        Assert.That(method, Is.Not.Null);
        return (bool)method.Invoke(null, new object[] { mouseHeld });
    }

    private static bool CancelPointerPress()
    {
        System.Type reflectionType = typeof(WebGLClipboardPasteBridge).GetNestedType(
            "EventSystemReflection",
            BindingFlags.NonPublic);
        Assert.That(reflectionType, Is.Not.Null);
        MethodInfo method = reflectionType.GetMethod(
            "TryCancelPointerPress",
            BindingFlags.Static | BindingFlags.Public);
        Assert.That(method, Is.Not.Null);
        return (bool)method.Invoke(null, null);
    }

    private static void RestoreOriginalCaretWidth()
    {
        MethodInfo method = typeof(WebGLClipboardPasteBridge).GetMethod(
            "RestoreOriginalCaretWidth",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.That(method, Is.Not.Null);
        method.Invoke(null, null);
    }

    private static void SetCurrentInputModule(
        EventSystem eventSystem,
        StandaloneInputModule inputModule)
    {
        FieldInfo field = typeof(EventSystem).GetField(
            "m_CurrentInputModule",
            BindingFlags.Instance | BindingFlags.NonPublic);
        Assert.That(field, Is.Not.Null);
        field.SetValue(eventSystem, inputModule);
    }

    private static void SetLeftPointerData(
        StandaloneInputModule inputModule,
        PointerEventData pointerData)
    {
        FieldInfo field = typeof(PointerInputModule).GetField(
            "m_PointerData",
            BindingFlags.Instance | BindingFlags.NonPublic);
        Assert.That(field, Is.Not.Null);
        IDictionary values = field.GetValue(inputModule) as IDictionary;
        Assert.That(values, Is.Not.Null);
        values[-1] = pointerData;
    }

    private static bool MoveCaret(Component input, bool isLegacy, int direction)
    {
        object target = CreateTextInputTarget(input, isLegacy);
        MethodInfo method = target.GetType().GetMethod("TryMoveCaret", BindingFlags.Instance | BindingFlags.Public);
        Assert.That(method, Is.Not.Null);
        return (bool)method.Invoke(target, new object[] { direction, false, false });
    }

    private static int GetLineMode(Component input, bool isLegacy)
    {
        object target = CreateTextInputTarget(input, isLegacy);
        PropertyInfo property = target.GetType().GetProperty("LineMode", BindingFlags.Instance | BindingFlags.Public);
        Assert.That(property, Is.Not.Null);
        return (int)property.GetValue(target, null);
    }

    private static bool ProcessEnter(
        Component input,
        bool isLegacy,
        bool keypadEnter,
        int modifierFlags,
        out bool finished)
    {
        object target = CreateTextInputTarget(input, isLegacy);
        MethodInfo method = target.GetType().GetMethod(
            "TryProcessEnterKey",
            BindingFlags.Instance | BindingFlags.Public);
        Assert.That(method, Is.Not.Null);
        object[] arguments = { keypadEnter, modifierFlags, false };
        bool handled = (bool)method.Invoke(target, arguments);
        finished = (bool)arguments[2];
        return handled;
    }

    private static void AssertTmpSubmitMode(TMP_InputField.LineType lineType, bool keypadEnter)
    {
        GameObject gameObject = CreateTmpInput(out TMP_InputField input);
        try
        {
            List<string> events = new List<string>();
            input.lineType = lineType;
            input.resetOnDeActivation = false;
            input.text = "提交中文😀";
            input.onSubmit.AddListener(value => events.Add("submit:" + input.isFocused + ":" + value));
            input.onEndEdit.AddListener(value => events.Add("end:" + input.isFocused + ":" + value));
            SetFocused(input);

            Assert.That(ProcessEnter(input, false, keypadEnter, 1, out bool finished), Is.True);
            Assert.That(finished, Is.True);
            Assert.That(input.isFocused, Is.False);
            Assert.That(events, Is.EqualTo(new[]
            {
                "submit:True:提交中文😀",
                "end:False:提交中文😀"
            }));
        }
        finally
        {
            Object.DestroyImmediate(gameObject);
        }
    }

    private static void AssertLegacySubmitMode(InputField.LineType lineType, bool keypadEnter)
    {
        GameObject gameObject = CreateLegacyInput(out InputField input);
        try
        {
            List<string> events = new List<string>();
            input.lineType = lineType;
            input.text = "提交中文😀";
#if UNITY_2021_1_OR_NEWER
            input.onSubmit.AddListener(value => events.Add("submit:" + input.isFocused + ":" + value));
#endif
            input.onEndEdit.AddListener(value => events.Add("end:" + input.isFocused + ":" + value));
            SetFocused(input);

            Assert.That(ProcessEnter(input, true, keypadEnter, 1, out bool finished), Is.True);
            Assert.That(finished, Is.True);
            Assert.That(input.isFocused, Is.False);
#if UNITY_2021_1_OR_NEWER
            Assert.That(events, Is.EqualTo(new[]
            {
                "submit:True:提交中文😀",
                "end:False:提交中文😀"
            }));
#else
            // Unity 2019.4 的 UGUI InputField 没有公开 onSubmit 事件，
            // 提交只通过 OnSubmit 后的 onEndEdit 对业务可见。
            Assert.That(events, Is.EqualTo(new[]
            {
                "end:False:提交中文😀"
            }));
#endif
        }
        finally
        {
            Object.DestroyImmediate(gameObject);
        }
    }

    private static GameObject CreateTmpInput(out TMP_InputField input)
    {
        GameObject gameObject = new GameObject("TMP Input", typeof(RectTransform), typeof(TMP_InputField));
        GameObject textObject = new GameObject(
            "Text",
            typeof(RectTransform),
            typeof(CanvasRenderer),
            typeof(TextMeshProUGUI));
        textObject.transform.SetParent(gameObject.transform, false);
        input = gameObject.GetComponent<TMP_InputField>();
        input.textViewport = gameObject.GetComponent<RectTransform>();
        input.textComponent = textObject.GetComponent<TextMeshProUGUI>();
        return gameObject;
    }

    private static GameObject CreateLegacyInput(out InputField input)
    {
        GameObject gameObject = new GameObject("Legacy Input", typeof(RectTransform), typeof(InputField));
        GameObject textObject = new GameObject(
            "Text",
            typeof(RectTransform),
            typeof(CanvasRenderer),
            typeof(Text));
        textObject.transform.SetParent(gameObject.transform, false);
        input = gameObject.GetComponent<InputField>();
        input.textComponent = textObject.GetComponent<Text>();
        return gameObject;
    }

    private static void SetFocused(Component input)
    {
        FieldInfo field = input.GetType().GetField("m_AllowInput", BindingFlags.Instance | BindingFlags.NonPublic);
        Assert.That(field, Is.Not.Null);
        field.SetValue(input, true);
    }

    private static void EnsureVisibleCaret(Component input, bool isLegacy)
    {
        object target = CreateTextInputTarget(input, isLegacy);
        MethodInfo method = target.GetType().GetMethod("EnsureVisibleCaret", BindingFlags.Instance | BindingFlags.Public);
        Assert.That(method, Is.Not.Null);
        method.Invoke(target, null);
    }

    private static object CreateTextInputTarget(Component input, bool isLegacy)
    {
        System.Type targetType = typeof(WebGLClipboardPasteBridge).GetNestedType(
            "TextInputTarget",
            BindingFlags.NonPublic);
        Assert.That(targetType, Is.Not.Null);
        return System.Activator.CreateInstance(targetType, new object[] { input, isLegacy });
    }
}

internal sealed class PointerReleaseRecorder : MonoBehaviour,
    IPointerUpHandler,
    IPointerClickHandler,
    IEndDragHandler,
    IDropHandler
{
    public int PointerUpCount { get; private set; }
    public int PointerClickCount { get; private set; }
    public int EndDragCount { get; private set; }
    public int DropCount { get; private set; }

    public void OnPointerUp(PointerEventData eventData)
    {
        PointerUpCount += 1;
    }

    public void OnPointerClick(PointerEventData eventData)
    {
        PointerClickCount += 1;
    }

    public void OnEndDrag(PointerEventData eventData)
    {
        EndDragCount += 1;
    }

    public void OnDrop(PointerEventData eventData)
    {
        DropCount += 1;
    }
}
