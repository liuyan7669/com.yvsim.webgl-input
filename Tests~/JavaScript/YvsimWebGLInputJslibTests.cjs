const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeNode {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.listeners = Object.create(null);
    this.attributes = Object.create(null);
    this.style = Object.create(null);
    this.value = '';
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.selectionDirection = 'forward';
    this.focusCount = 0;
    this.blurCount = 0;
    this.capturedPointerIds = new Set();
  }

  appendChild(child) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  insertBefore(child, reference) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    const index = this.children.indexOf(reference);
    if (index < 0) {
      return this.appendChild(child);
    }
    this.children.splice(index, 0, child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  addEventListener(name, listener) {
    (this.listeners[name] || (this.listeners[name] = [])).push(listener);
  }

  removeEventListener(name, listener) {
    const listeners = this.listeners[name] || [];
    const index = listeners.indexOf(listener);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
  }

  dispatch(name, event) {
    const value = event || {};
    value.type = value.type || name;
    value.target = value.target || this;
    const listeners = (this.listeners[name] || []).slice();
    for (const listener of listeners) {
      listener(value);
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  focus() {
    this.focusCount += 1;
    this.ownerDocument.activeElement = this;
  }

  blur() {
    this.blurCount += 1;
    if (this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = null;
    }
  }

  setSelectionRange(start, end, direction) {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction || 'forward';
  }

  getBoundingClientRect() {
    const width = Number.parseFloat(this.style.width) || 800;
    const height = Number.parseFloat(this.style.height) || 600;
    return {
      left: 10,
      top: 20,
      right: 10 + width,
      bottom: 20 + height,
      width,
      height
    };
  }

  setPointerCapture(pointerId) {
    this.capturedPointerIds.add(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.capturedPointerIds.has(pointerId);
  }

}

function createEventTarget() {
  return {
    listeners: Object.create(null),
    addEventListener(name, listener) {
      (this.listeners[name] || (this.listeners[name] = [])).push(listener);
    },
    removeEventListener(name, listener) {
      const listeners = this.listeners[name] || [];
      const index = listeners.indexOf(listener);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
    dispatch(name, event) {
      const value = event || {};
      value.type = value.type || name;
      value.target = value.target || this;
      const listeners = (this.listeners[name] || []).slice();
      for (const listener of listeners) {
        listener(value);
      }
    }
  };
}

function createHarness(jslibPath) {
  const document = createEventTarget();
  document.activeElement = null;
  document.fullscreenElement = null;
  document.mozFullScreenElement = null;
  document.msFullscreenElement = null;
  document.webkitFullscreenElement = null;
  document.webkitCurrentFullScreenElement = null;
  document.pointerLockElement = null;
  document.mozPointerLockElement = null;
  document.webkitPointerLockElement = null;
  document.focused = true;
  document.hasFocus = () => document.focused;
  document.exitPointerLockCount = 0;
  document.exitPointerLock = () => {
    document.exitPointerLockCount += 1;
    document.pointerLockElement = null;
    document.mozPointerLockElement = null;
    document.webkitPointerLockElement = null;
  };
  document.createElement = tagName => new FakeNode(tagName, document);
  document.body = new FakeNode('body', document);
  document.documentElement = new FakeNode('html', document);
  document.documentElement.appendChild(document.body);
  document.contains = node => {
    let cursor = node;
    while (cursor) {
      if (cursor === document.documentElement) {
        return true;
      }
      cursor = cursor.parentNode;
    }
    return false;
  };

  const window = createEventTarget();
  window.innerWidth = 1920;
  window.innerHeight = 1080;
  const timers = [];
  let nextTimerId = 1;
  window.setTimeout = (callback, delay) => {
    const id = nextTimerId++;
    timers.push({ callback, delay: Number(delay) || 0, id });
    return id;
  };
  window.clearTimeout = id => {
    const index = timers.findIndex(timer => timer.id === id);
    if (index >= 0) {
      timers.splice(index, 1);
    }
  };
  window.flushTimers = maxDelay => {
    const limit = typeof maxDelay === 'number' ? maxDelay : Number.POSITIVE_INFINITY;
    while (true) {
      const index = timers.findIndex(timer => timer.delay <= limit);
      if (index < 0) {
        break;
      }
      const timer = timers.splice(index, 1)[0];
      timer.callback();
    }
  };
  const animationFrames = [];
  window.requestAnimationFrame = callback => {
    animationFrames.push(callback);
    return animationFrames.length;
  };
  window.flushAnimationFrames = () => {
    while (animationFrames.length > 0) {
      animationFrames.shift()();
    }
  };

  const canvas = new FakeNode('canvas', document);
  document.body.appendChild(canvas);
  const heap = new Uint8Array(8192);
  const dynCalls = [];
  const dynCallHandlers = new Map();
  const freedPointers = [];
  const consoleErrors = [];
  const library = {};
  const context = {
    console: {
      error(...args) {
        consoleErrors.push(args);
      }
    },
    document,
    window,
    Module: { canvas },
    HEAPU8: heap,
    TextDecoder,
    TextEncoder,
    LibraryManager: { library },
    mergeInto(target, source) {
      Object.assign(target, source);
    },
    _malloc() {
      return 256;
    },
    _free(pointer) {
      freedPointers.push(pointer);
    },
    dynCall(signature, callback, args) {
      dynCalls.push({ signature, callback, args: args.slice() });
      const handler = dynCallHandlers.get(callback);
      if (handler) {
        return handler(signature, args);
      }
      return 1;
    }
  };

  vm.runInNewContext(fs.readFileSync(jslibPath, 'utf8'), context, {
    filename: jslibPath
  });
  const runtime = context.YvsimWebGLInputLibrary.$YvsimWebGLInput;
  context.YvsimWebGLInput = runtime;
  return {
    canvas,
    consoleErrors,
    context,
    document,
    dynCallHandlers,
    dynCalls,
    freedPointers,
    heap,
    library,
    runtime,
    window
  };
}

function writeUtf8(harness, pointer, value) {
  const bytes = new harness.context.TextEncoder().encode(value);
  harness.heap.set(bytes, pointer);
  return bytes.length;
}

function createClipboardEvent(target, initialValue) {
  const values = new Map([['text/plain', initialValue || '']]);
  return {
    target,
    clipboardData: {
      getData(type) {
        return values.get(type);
      },
      setData(type, value) {
        values.set(type, value);
      }
    },
    preventDefaultCount: 0,
    stopImmediatePropagationCount: 0,
    preventDefault() {
      this.preventDefaultCount += 1;
    },
    stopImmediatePropagation() {
      this.stopImmediatePropagationCount += 1;
    },
    getValue() {
      return values.get('text/plain');
    }
  };
}

function createBeforeInputEvent(inputType, data) {
  return {
    inputType,
    data,
    preventDefaultCount: 0,
    stopImmediatePropagationCount: 0,
    preventDefault() {
      this.preventDefaultCount += 1;
    },
    stopImmediatePropagation() {
      this.stopImmediatePropagationCount += 1;
    }
  };
}

function createKeyboardEvent(values) {
  return Object.assign({
    key: '',
    code: '',
    keyCode: 0,
    which: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    preventDefaultCount: 0,
    stopImmediatePropagationCount: 0,
    stopPropagationCount: 0,
    preventDefault() {
      this.preventDefaultCount += 1;
    },
    stopImmediatePropagation() {
      this.stopImmediatePropagationCount += 1;
    },
    stopPropagation() {
      this.stopPropagationCount += 1;
    }
  }, values || {});
}

function testUtf8AndSelectionCallback(harness) {
  const { context, dynCalls, heap, runtime } = harness;
  const element = runtime.createTextElement(true);
  const value = '中文😀 !@#$%^&*()\nsecond';
  element.value = value;
  element.setSelectionRange(2, 5, 'backward');
  runtime.activeTextElement = element;
  runtime.textInputCallback = 73;

  runtime.sendTextInputState(element);

  assert.strictEqual(dynCalls.length, 1);
  assert.strictEqual(dynCalls[0].signature, 'viiiii');
  assert.strictEqual(dynCalls[0].callback, 73);
  assert.strictEqual(dynCalls[0].args[2], 5);
  assert.strictEqual(dynCalls[0].args[3], 2);
  assert.strictEqual(dynCalls[0].args[4], 1);
  const byteLength = dynCalls[0].args[1];
  const actual = new context.TextDecoder().decode(heap.subarray(256, 256 + byteLength));
  assert.strictEqual(actual, value);
}

function testKeydownSelectionSyncAndCompositionGuard(harness) {
  const { runtime, window } = harness;
  const element = runtime.createTextElement(true);
  const snapshots = [];
  let stopped = 0;
  runtime.activeTextElement = element;
  runtime.textInputCallback = 1;
  runtime.sendTextInputState = value => {
    snapshots.push({
      anchor: value.selectionStart,
      focus: value.selectionEnd,
      text: value.value
    });
  };

  element.value = 'AAA\nBBB\nCCC';
  element.setSelectionRange(11, 11, 'forward');
  element.dispatch('keydown', {
    stopPropagation() {
      stopped += 1;
    }
  });
  assert.strictEqual(snapshots.length, 0);
  element.setSelectionRange(7, 7, 'forward');
  window.flushTimers();
  assert.strictEqual(stopped, 1);
  assert.deepStrictEqual(snapshots[0], { anchor: 7, focus: 7, text: 'AAA\nBBB\nCCC' });

  snapshots.length = 0;
  element.dispatch('compositionstart');
  element.dispatch('keydown', { stopPropagation() {} });
  element.setSelectionRange(4, 4, 'forward');
  window.flushTimers();
  assert.strictEqual(snapshots.length, 0);
  element.dispatch('compositionend');
  assert.strictEqual(runtime.isComposing, false);
  assert.deepStrictEqual(snapshots[0], { anchor: 4, focus: 4, text: 'AAA\nBBB\nCCC' });
}

function testArrowNavigationDelegatesToUnity(harness) {
  const { dynCallHandlers, runtime, window } = harness;
  const element = runtime.createTextElement(true);
  const snapshots = [];
  const navigationCalls = [];
  runtime.activeTextElement = element;
  runtime.navigationCallback = 303;
  runtime.textInputCallback = 1;
  runtime.sendTextInputState = value => {
    snapshots.push({
      anchor: value.selectionStart,
      focus: value.selectionEnd
    });
  };
  dynCallHandlers.set(303, (signature, args) => {
    navigationCalls.push({ signature, args: args.slice() });
    return 1;
  });

  const handledKeyDown = {
    key: 'ArrowUp',
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    preventDefaultCount: 0,
    stopImmediatePropagationCount: 0,
    preventDefault() {
      this.preventDefaultCount += 1;
    },
    stopImmediatePropagation() {
      this.stopImmediatePropagationCount += 1;
    },
    stopPropagation() {}
  };
  element.dispatch('keydown', handledKeyDown);
  assert.strictEqual(navigationCalls[0].signature, 'iiii');
  assert.strictEqual(navigationCalls[0].args[0], 2);
  assert.strictEqual(navigationCalls[0].args[1], 1);
  assert.strictEqual(navigationCalls[0].args[2], 0);
  assert.strictEqual(handledKeyDown.preventDefaultCount, 1);
  assert.strictEqual(handledKeyDown.stopImmediatePropagationCount, 1);

  element.dispatch('keyup', {
    key: 'ArrowUp',
    stopPropagation() {}
  });
  window.flushTimers();
  assert.strictEqual(snapshots.length, 0);

  dynCallHandlers.set(303, () => 0);
  element.dispatch('keydown', {
    key: 'ArrowDown',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault() {
      throw new Error('Fallback navigation must not be prevented.');
    },
    stopImmediatePropagation() {
      throw new Error('Fallback navigation must not stop immediately.');
    },
    stopPropagation() {}
  });
  element.setSelectionRange(4, 4, 'forward');
  window.flushTimers();
  assert.deepStrictEqual(snapshots[0], { anchor: 4, focus: 4 });

  const callCountBeforeComposition = navigationCalls.length;
  snapshots.length = 0;
  runtime.isComposing = true;
  element.dispatch('keydown', {
    key: 'ArrowLeft',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    stopPropagation() {}
  });
  window.flushTimers();
  assert.strictEqual(navigationCalls.length, callCountBeforeComposition);
  assert.strictEqual(snapshots.length, 0);
}

function testClipboardEventsPreserveExactUnicode(harness) {
  const {
    canvas,
    context,
    dynCallHandlers,
    dynCalls,
    freedPointers,
    heap,
    library,
    runtime
  } = harness;
  const pastedValue = 'paste 中文😀 !@#$%^&*()\n{"key":"值"}';
  let callbackValue = null;
  runtime.pasteCallback = 101;
  dynCallHandlers.set(101, (signature, args) => {
    assert.strictEqual(signature, 'iii');
    callbackValue = new context.TextDecoder().decode(
      heap.subarray(args[0], args[0] + args[1])
    );
    return 1;
  });

  const pasteEvent = createClipboardEvent(canvas, pastedValue);
  runtime.handlePaste(pasteEvent);
  assert.strictEqual(callbackValue, pastedValue);
  assert.strictEqual(pasteEvent.preventDefaultCount, 1);
  assert.strictEqual(pasteEvent.stopImmediatePropagationCount, 1);
  assert.deepStrictEqual(freedPointers, [256]);

  runtime.ensureTextElements();
  const ignoredPaste = createClipboardEvent(runtime.multiLineInput, 'should stay native');
  runtime.handlePaste(ignoredPaste);
  assert.strictEqual(dynCalls.length, 1);
  assert.strictEqual(ignoredPaste.preventDefaultCount, 0);

  const copiedValue = 'copy 中文😀\nsecond line\\';
  runtime.copyCallback = 202;
  dynCallHandlers.set(202, signature => {
    assert.strictEqual(signature, 'i');
    const pointer = 1024;
    const byteLength = writeUtf8(harness, pointer, copiedValue);
    library.YvsimWebGLInput_SetCopyText(pointer, byteLength);
    return 1;
  });

  const copyEvent = createClipboardEvent(canvas, '');
  runtime.handleCopy(copyEvent);
  assert.strictEqual(copyEvent.getValue(), copiedValue);
  assert.strictEqual(copyEvent.preventDefaultCount, 1);
  assert.strictEqual(copyEvent.stopImmediatePropagationCount, 1);
}

function testClipboardIgnoresUnrelatedHtmlControls(harness) {
  const { canvas, document, dynCalls, runtime } = harness;
  runtime.pasteCallback = 111;
  runtime.copyCallback = 222;

  // 页面中与 Unity 无关的普通 HTML 输入控件。
  const externalInput = document.createElement('input');
  document.body.appendChild(externalInput);
  document.activeElement = externalInput;

  const externalPaste = createClipboardEvent(externalInput, 'external paste');
  runtime.handlePaste(externalPaste);
  assert.strictEqual(dynCalls.length, 0);
  assert.strictEqual(externalPaste.preventDefaultCount, 0);
  assert.strictEqual(externalPaste.stopImmediatePropagationCount, 0);

  const externalCopy = createClipboardEvent(externalInput, 'external copy');
  runtime.handleCopy(externalCopy);
  assert.strictEqual(dynCalls.length, 0);
  assert.strictEqual(externalCopy.getValue(), 'external copy');
  assert.strictEqual(externalCopy.preventDefaultCount, 0);
  assert.strictEqual(externalCopy.stopImmediatePropagationCount, 0);

  // Unity Canvas 聚焦时事件仍然必须被桥接处理。
  document.activeElement = canvas;
  const canvasPaste = createClipboardEvent(canvas, 'unity paste');
  runtime.handlePaste(canvasPaste);
  assert.strictEqual(canvasPaste.preventDefaultCount, 1);
}

function testConcurrentFullscreenRequestsOnlyCleanUpOwnWrapper(harness) {
  const { canvas, runtime } = harness;
  runtime.ensureTextElements();
  let rejectFirstRequest = null;
  let requestIndex = 0;
  canvas.requestFullscreen = function () {
    requestIndex += 1;
    if (requestIndex === 1) {
      return new Promise((resolve, reject) => {
        rejectFirstRequest = reject;
      });
    }

    return Promise.resolve();
  };

  runtime.installCanvasAndFullscreenHandlers();
  canvas.requestFullscreen();
  const firstWrapper = runtime.fullscreenWrapper;
  assert.ok(firstWrapper);

  canvas.requestFullscreen();
  const secondWrapper = runtime.fullscreenWrapper;
  assert.ok(secondWrapper);
  assert.notStrictEqual(secondWrapper, firstWrapper);
  assert.strictEqual(canvas.parentNode, secondWrapper);

  // 旧请求的 reject 迟到，不能拆掉新请求的 wrapper。
  rejectFirstRequest(new Error('first fullscreen request failed'));
  return Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => {
      assert.strictEqual(runtime.fullscreenWrapper, secondWrapper);
      assert.strictEqual(canvas.parentNode, secondWrapper);
    });
}

function testPointerCancelUsesCancelCallbackInsteadOfRelease(harness) {
  const { canvas, document, dynCallHandlers, library, runtime, window } = harness;
  runtime.ensureTextElements();
  runtime.activeTextElement = runtime.multiLineInput;
  let releaseCount = 0;
  let cancelCount = 0;
  dynCallHandlers.set(401, () => {
    releaseCount += 1;
    return 1;
  });
  dynCallHandlers.set(402, (signature, args) => {
    assert.strictEqual(signature, 'i');
    assert.strictEqual(args.length, 0);
    cancelCount += 1;
    return 1;
  });
  library.YvsimWebGLInput_RegisterPointerReleaseCallback(401);
  library.YvsimWebGLInput_RegisterPointerCancelCallback(402);
  runtime.installCanvasAndFullscreenHandlers();
  document.activeElement = canvas;

  canvas.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 21 });
  window.dispatch('pointercancel', {
    isPrimary: true,
    pointerId: 21,
    target: canvas
  });
  assert.strictEqual(cancelCount, 1);
  assert.strictEqual(releaseCount, 0);
  assert.strictEqual(runtime.canvasPointerInteractionActive, true);
  assert.strictEqual(runtime.canvasPointerReleasePending, true);
  library.YvsimWebGLInput_CompletePointerInteraction();
  window.flushAnimationFrames();
  window.flushTimers(0);
  assert.strictEqual(runtime.canvasPointerInteractionActive, false);

  // 真正的窗口失焦同样走 cancel 语义。
  runtime.multiLineInput.blur();
  document.activeElement = canvas;
  canvas.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 22 });
  window.dispatch('blur', { target: runtime.multiLineInput });
  assert.strictEqual(cancelCount, 1);
  document.focused = false;
  window.dispatch('blur');
  assert.strictEqual(cancelCount, 2);
  assert.strictEqual(releaseCount, 0);
  assert.strictEqual(runtime.canvasPointerInteractionActive, true);
  library.YvsimWebGLInput_CompletePointerInteraction();
  window.flushAnimationFrames();
  window.flushTimers(0);
  assert.strictEqual(runtime.canvasPointerInteractionActive, false);
  assert.strictEqual(document.activeElement, canvas);
  document.focused = true;

  // 正常松开仍然走 release 恢复。
  canvas.dispatch('pointerdown', {
    button: 0,
    isPrimary: true,
    pointerType: 'mouse',
    pointerId: 23
  });
  window.dispatch('pointerup', {
    button: 0,
    isPrimary: true,
    pointerType: 'mouse',
    pointerId: 23,
    target: canvas
  });
  window.flushTimers(0);
  assert.strictEqual(runtime.canvasPointerInteractionActive, true);
  assert.strictEqual(document.activeElement, canvas);
  library.YvsimWebGLInput_CompletePointerInteraction();
  window.flushAnimationFrames();
  window.flushTimers(0);
  assert.strictEqual(runtime.canvasPointerInteractionActive, false);
  assert.strictEqual(document.activeElement, runtime.multiLineInput);
  assert.strictEqual(releaseCount, 1);
  assert.strictEqual(cancelCount, 2);

  library.YvsimWebGLInput_UnregisterCallbacks();
  assert.strictEqual(runtime.pointerCancelCallback, 0);
}

function testPointerSelectionAuthorityWaitsForUnityCompletion(harness) {
  const {
    canvas,
    document,
    dynCalls,
    dynCallHandlers,
    library,
    runtime,
    window
  } = harness;
  const value = '0123456789 中文';
  const pointer = 1700;
  const length = writeUtf8(harness, pointer, value);
  let releaseCount = 0;
  let pointerDownCount = 0;
  dynCallHandlers.set(502, () => {
    releaseCount += 1;
    return 1;
  });
  dynCallHandlers.set(503, (signature, args) => {
    assert.strictEqual(signature, 'iiiii');
    assert.deepStrictEqual(Array.from(args), [480, 300, 0, 1]);
    pointerDownCount += 1;
    return 1;
  });
  library.YvsimWebGLInput_RegisterTextInputCallback(501);
  library.YvsimWebGLInput_RegisterPointerReleaseCallback(502);
  library.YvsimWebGLInput_RegisterPointerDownCallback(503);
  runtime.installCanvasAndFullscreenHandlers();
  canvas.width = 960;
  canvas.height = 600;
  library.YvsimWebGLInput_BeginTextInput(
    pointer,
    length,
    2,
    8,
    2,
    0,
    0,
    500,
    200,
    1000,
    500
  );

  const input = runtime.multiLineInput;
  canvas.dispatch('pointerdown', {
    button: 0,
    isPrimary: true,
    pointerType: 'mouse',
    pointerId: 31,
    clientX: 410,
    clientY: 320,
    shiftKey: false,
    detail: 1
  });
  assert.strictEqual(pointerDownCount, 1);
  document.activeElement = canvas;

  // 拖动期间 DOM 仍可报告文字变化，但它保存的旧选区不能覆盖 Unity。
  input.setSelectionRange(0, 1, 'forward');
  input.dispatch('select');
  let textCalls = dynCalls.filter(call => call.callback === 501);
  assert.strictEqual(textCalls.length, 1);
  assert.strictEqual(textCalls[0].signature, 'viiiii');
  assert.deepStrictEqual(Array.from(textCalls[0].args.slice(2)), [0, 1, 0]);

  // Unity 的最终反向选区要一直保留到 release 握手结束。
  library.YvsimWebGLInput_UpdateTextInput(
    pointer,
    length,
    9,
    3,
    2,
    0,
    0,
    500,
    200,
    1000,
    500
  );
  assert.strictEqual(input.selectionStart, 3);
  assert.strictEqual(input.selectionEnd, 9);
  assert.strictEqual(input.selectionDirection, 'backward');
  assert.strictEqual(document.activeElement, canvas);

  const callsBeforeModifiers = dynCalls.length;
  input.dispatch('keydown', createKeyboardEvent({ key: 'Control', ctrlKey: true }));
  input.dispatch('keyup', createKeyboardEvent({ key: 'Control' }));
  window.flushTimers(0);
  assert.strictEqual(dynCalls.length, callsBeforeModifiers);

  window.dispatch('pointerup', {
    button: 0,
    isPrimary: true,
    pointerType: 'mouse',
    pointerId: 31,
    target: canvas
  });
  window.flushTimers(0);
  assert.strictEqual(releaseCount, 1);
  assert.strictEqual(runtime.canvasPointerInteractionActive, true);
  assert.strictEqual(document.activeElement, canvas);

  library.YvsimWebGLInput_CompletePointerInteraction();
  window.flushAnimationFrames();
  window.flushTimers(0);
  assert.strictEqual(runtime.canvasPointerInteractionActive, false);
  assert.strictEqual(document.activeElement, input);
  assert.strictEqual(input.selectionStart, 3);
  assert.strictEqual(input.selectionEnd, 9);
  assert.strictEqual(input.selectionDirection, 'backward');

  input.dispatch('select');
  textCalls = dynCalls.filter(call => call.callback === 501);
  assert.strictEqual(textCalls.length, 2);
  assert.deepStrictEqual(Array.from(textCalls[1].args.slice(2)), [9, 3, 1]);

  library.YvsimWebGLInput_UnregisterCallbacks();
  assert.strictEqual(runtime.pointerDownCallback, 0);
}

function testSingleAndMultilineInputLifecycle(harness) {
  const { library, runtime } = harness;
  const singleValue = 'single 中文😀';
  const singlePointer = 1200;
  const singleLength = writeUtf8(harness, singlePointer, singleValue);
  library.YvsimWebGLInput_BeginTextInput(
    singlePointer,
    singleLength,
    5,
    2,
    0,
    100,
    200,
    400,
    80,
    1000,
    500
  );

  const single = runtime.singleLineInput;
  assert.strictEqual(runtime.activeTextElement, single);
  assert.strictEqual(single.value, singleValue);
  assert.strictEqual(single.style.display, 'block');
  assert.strictEqual(single.selectionStart, 2);
  assert.strictEqual(single.selectionEnd, 5);
  assert.strictEqual(single.selectionDirection, 'backward');
  assert.strictEqual(single.style.left, '90px');
  assert.strictEqual(single.style.top, '284px');
  assert.strictEqual(single.style.width, '320px');
  assert.strictEqual(single.style.height, '96px');

  const multilineValue = 'AAA\n中文😀\nCCC';
  const multilinePointer = 1600;
  const multilineLength = writeUtf8(harness, multilinePointer, multilineValue);
  library.YvsimWebGLInput_BeginTextInput(
    multilinePointer,
    multilineLength,
    multilineValue.length,
    multilineValue.length,
    2,
    0,
    0,
    500,
    200,
    1000,
    500
  );

  const multiline = runtime.multiLineInput;
  assert.strictEqual(single.style.display, 'none');
  assert.ok(single.blurCount > 0);
  assert.strictEqual(runtime.activeTextElement, multiline);
  assert.strictEqual(multiline.value, multilineValue);
  assert.strictEqual(multiline.style.display, 'block');

  runtime.isComposing = true;
  const stalePointer = 2000;
  const staleLength = writeUtf8(harness, stalePointer, 'stale C# value');
  library.YvsimWebGLInput_UpdateTextInput(
    stalePointer,
    staleLength,
    0,
    0,
    2,
    0,
    0,
    500,
    200,
    1000,
    500
  );
  assert.strictEqual(multiline.value, multilineValue);

  library.YvsimWebGLInput_EndTextInput();
  assert.strictEqual(runtime.activeTextElement, null);
  assert.strictEqual(multiline.style.display, 'none');
  assert.ok(multiline.blurCount > 0);
}

function testCanvasPointerAndWindowEventsRestoreFocus(harness) {
  const {
    canvas,
    consoleErrors,
    document,
    dynCallHandlers,
    library,
    runtime,
    window
  } = harness;
  runtime.ensureTextElements();
  runtime.activeTextElement = runtime.multiLineInput;
  let pointerReleaseRecoveryCount = 0;
  dynCallHandlers.set(303, (signature, args) => {
    assert.strictEqual(signature, 'i');
    assert.strictEqual(args.length, 0);
    pointerReleaseRecoveryCount += 1;
    return 1;
  });
  library.YvsimWebGLInput_RegisterPointerReleaseCallback(303);
  canvas.width = 960;
  canvas.height = 600;
  runtime.installCanvasAndFullscreenHandlers();
  document.activeElement = canvas;

  const focusCountBeforePointerDown = runtime.multiLineInput.focusCount;
  canvas.dispatch('pointerdown', {
    button: 0,
    buttons: 1,
    isPrimary: true,
    pointerId: 7
  });
  assert.strictEqual(runtime.canvasPointerInteractionActive, true);
  assert.strictEqual(canvas.hasPointerCapture(7), false);

  window.dispatch('mouseup', { button: 2, buttons: 0, target: canvas });
  window.dispatch('pointerup', {
    button: 0,
    buttons: 0,
    isPrimary: false,
    pointerType: 'mouse',
    pointerId: 7,
    target: canvas
  });
  window.dispatch('pointerup', {
    button: 0,
    buttons: 0,
    isPrimary: true,
    pointerType: 'mouse',
    pointerId: 70,
    target: canvas
  });
  window.dispatch('touchend', { target: canvas });
  window.flushAnimationFrames();
  window.flushTimers();
  assert.strictEqual(runtime.canvasPointerInteractionActive, true);
  assert.strictEqual(runtime.canvasPointerReleasePending, false);
  assert.strictEqual(pointerReleaseRecoveryCount, 0);

  runtime.focusActiveTextElement();
  library.YvsimWebGLInput_EnsureTextInputFocus();
  assert.strictEqual(document.activeElement, canvas);
  assert.strictEqual(runtime.multiLineInput.focusCount, focusCountBeforePointerDown);

  const pointer = 2048;
  const length = writeUtf8(harness, pointer, 'drag selection update');
  library.YvsimWebGLInput_UpdateTextInput(
    pointer,
    length,
    length,
    length,
    2,
    0,
    0,
    500,
    200,
    1000,
    500
  );
  assert.strictEqual(document.activeElement, canvas);
  assert.strictEqual(runtime.multiLineInput.focusCount, focusCountBeforePointerDown);

  window.dispatch('pointerup', {
    button: 0,
    buttons: 0,
    isPrimary: true,
    pointerType: 'mouse',
    pointerId: 7,
    target: canvas
  });
  assert.strictEqual(runtime.canvasPointerInteractionActive, true);
  assert.strictEqual(pointerReleaseRecoveryCount, 0);
  window.dispatch('mouseup', {
    button: 0,
    buttons: 0,
    target: canvas
  });
  window.flushTimers();
  assert.strictEqual(pointerReleaseRecoveryCount, 1);
  assert.strictEqual(document.activeElement, canvas);
  window.flushAnimationFrames();
  assert.strictEqual(document.activeElement, canvas);
  window.flushTimers();
  assert.strictEqual(runtime.canvasPointerInteractionActive, false);
  assert.strictEqual(document.activeElement, runtime.multiLineInput);
  assert.strictEqual(pointerReleaseRecoveryCount, 1);

  runtime.multiLineInput.blur();
  document.activeElement = canvas;
  canvas.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 8 });
  window.dispatch('pointercancel', { pointerId: 8, target: canvas });
  window.flushAnimationFrames();
  window.flushTimers();
  assert.strictEqual(runtime.canvasPointerInteractionActive, false);
  assert.strictEqual(document.activeElement, runtime.multiLineInput);

  runtime.multiLineInput.blur();
  document.activeElement = canvas;
  canvas.dispatch('pointerdown', { button: 2, isPrimary: true, pointerId: 9 });
  assert.strictEqual(runtime.canvasPointerInteractionActive, false);

  canvas.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 10 });
  window.dispatch('pointerup', { pointerId: 10, target: canvas });
  canvas.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 11 });
  window.flushAnimationFrames();
  window.flushTimers();
  assert.strictEqual(runtime.canvasPointerInteractionActive, true);
  assert.strictEqual(document.activeElement, canvas);
  assert.strictEqual(pointerReleaseRecoveryCount, 1);
  window.dispatch('pointerup', { pointerId: 11, target: canvas });
  window.flushAnimationFrames();
  window.flushTimers();
  window.flushAnimationFrames();
  window.flushTimers();
  assert.strictEqual(runtime.canvasPointerInteractionActive, false);
  assert.strictEqual(document.activeElement, runtime.multiLineInput);
  assert.strictEqual(pointerReleaseRecoveryCount, 2);

  runtime.multiLineInput.blur();
  document.activeElement = canvas;
  canvas.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 12 });
  window.dispatch('blur', { target: runtime.multiLineInput });
  assert.strictEqual(runtime.canvasPointerInteractionActive, true);
  assert.strictEqual(runtime.canvasPointerReleasePending, false);
  assert.strictEqual(document.activeElement, canvas);
  window.dispatch('blur');
  assert.strictEqual(runtime.canvasPointerInteractionActive, false);
  assert.strictEqual(runtime.canvasPointerReleasePending, false);
  assert.strictEqual(document.activeElement, canvas);

  runtime.multiLineInput.blur();
  window.dispatch('resize');
  window.flushTimers();
  assert.strictEqual(document.activeElement, runtime.multiLineInput);

  runtime.multiLineInput.blur();
  window.dispatch('focus');
  window.flushTimers();
  assert.strictEqual(document.activeElement, runtime.multiLineInput);

  runtime.multiLineInput.blur();
  document.activeElement = canvas;
  canvas.dispatch('pointerdown', {
    button: 0,
    isPrimary: true,
    pointerType: 'mouse',
    pointerId: 13
  });
  // Selecting another Unity control can end the browser text-input session
  // before pointerup. Recovery still belongs to the session that began while
  // the text input was active.
  runtime.activeTextElement = null;
  window.dispatch('pointerup', {
    button: 0,
    isPrimary: true,
    pointerType: 'mouse',
    pointerId: 13,
    target: canvas
  });
  window.flushAnimationFrames();
  window.flushTimers();
  window.flushAnimationFrames();
  window.flushTimers();
  assert.strictEqual(runtime.canvasPointerInteractionActive, false);
  assert.strictEqual(runtime.canvasPointerReleasePending, false);
  assert.strictEqual(pointerReleaseRecoveryCount, 3);

  document.activeElement = canvas;
  canvas.dispatch('pointerdown', {
    button: 0,
    isPrimary: true,
    pointerType: 'mouse',
    pointerId: 131
  });
  assert.strictEqual(runtime.canvasPointerInteractionHadTextInput, false);
  library.YvsimWebGLInput_BeginTextInput(
    pointer,
    length,
    length,
    length,
    2,
    0,
    0,
    500,
    200,
    1000,
    500
  );
  assert.strictEqual(runtime.canvasPointerInteractionHadTextInput, true);
  window.dispatch('pointerup', {
    button: 0,
    isPrimary: true,
    pointerType: 'mouse',
    pointerId: 131,
    target: canvas
  });
  window.flushTimers();
  window.flushAnimationFrames();
  window.flushTimers();
  assert.strictEqual(runtime.canvasPointerInteractionActive, false);
  assert.strictEqual(pointerReleaseRecoveryCount, 4);

  runtime.activeTextElement = runtime.multiLineInput;
  dynCallHandlers.set(304, () => {
    throw new Error('expected callback failure');
  });
  library.YvsimWebGLInput_RegisterPointerReleaseCallback(304);
  canvas.dispatch('pointerdown', {
    button: 0,
    isPrimary: true,
    pointerType: 'mouse',
    pointerId: 14
  });
  window.dispatch('pointerup', {
    button: 0,
    isPrimary: true,
    pointerType: 'mouse',
    pointerId: 14,
    target: canvas
  });
  window.flushAnimationFrames();
  window.flushTimers();
  window.flushAnimationFrames();
  window.flushTimers();
  assert.strictEqual(runtime.canvasPointerInteractionActive, false);
  assert.strictEqual(document.activeElement, runtime.multiLineInput);
  assert.strictEqual(consoleErrors.length, 1);

  library.YvsimWebGLInput_RegisterPointerReleaseCallback(303);
  runtime.multiLineInput.blur();
  document.activeElement = canvas;
  canvas.dispatch('pointerdown', {
    button: 0,
    isPrimary: true,
    pointerType: 'mouse',
    pointerId: 15
  });
  window.dispatch('pointerup', {
    button: 0,
    isPrimary: true,
    pointerType: 'mouse',
    pointerId: 15,
    target: canvas
  });
  library.YvsimWebGLInput_UnregisterCallbacks();
  window.flushAnimationFrames();
  window.flushTimers();
  window.flushAnimationFrames();
  window.flushTimers();
  assert.strictEqual(runtime.pointerReleaseCallback, 0);
  assert.strictEqual(runtime.canvasPointerInteractionActive, false);
  assert.strictEqual(document.activeElement, canvas);
  assert.strictEqual(pointerReleaseRecoveryCount, 4);
}

function testFullscreenHostRemountAndRefocus(harness) {
  const { document, runtime, window } = harness;
  runtime.ensureTextElements();
  const input = runtime.multiLineInput;
  runtime.activeTextElement = input;
  assert.strictEqual(input.parentNode, document.body);

  const unityFullscreenContainer = new FakeNode('div', document);
  document.body.appendChild(unityFullscreenContainer);
  document.fullscreenElement = unityFullscreenContainer;
  runtime.installCanvasAndFullscreenHandlers();
  document.dispatch('fullscreenchange');
  window.flushTimers();
  assert.strictEqual(runtime.singleLineInput.parentNode, unityFullscreenContainer);
  assert.strictEqual(runtime.multiLineInput.parentNode, unityFullscreenContainer);
  assert.ok(input.focusCount > 0);

  document.fullscreenElement = null;
  document.dispatch('fullscreenchange');
  window.flushTimers();
  assert.strictEqual(runtime.singleLineInput.parentNode, document.body);
  assert.strictEqual(runtime.multiLineInput.parentNode, document.body);

  document.fullscreenElement = harness.canvas;
  document.dispatch('fullscreenchange');
  window.flushTimers();
  assert.strictEqual(runtime.singleLineInput.parentNode, harness.canvas);
  assert.strictEqual(runtime.multiLineInput.parentNode, harness.canvas);
  assert.strictEqual(document.activeElement, input);
}

function testCanvasFullscreenRequestUsesSiblingWrapper(harness) {
  const { canvas, document, runtime, window } = harness;
  runtime.ensureTextElements();
  runtime.activeTextElement = runtime.multiLineInput;
  canvas.width = 960;
  canvas.height = 600;
  canvas.style.width = '960px';
  canvas.style.height = '600px';
  canvas.style.display = 'inline-block';
  canvas.style.margin = '7px';
  canvas.style.minWidth = '320px';
  canvas.style.maxWidth = '1280px';
  canvas.style.minHeight = '200px';
  canvas.style.maxHeight = '720px';
  canvas.style.boxSizing = 'content-box';
  canvas.style.objectFit = 'fill';
  let requestedTarget = null;
  let childrenAtRequest = null;
  let canvasStyleAtRequest = null;
  const nativeRequest = function () {
    requestedTarget = this;
    childrenAtRequest = this.children.slice();
    canvasStyleAtRequest = {
      width: canvas.style.width,
      height: canvas.style.height,
      display: canvas.style.display,
      margin: canvas.style.margin,
      minWidth: canvas.style.minWidth,
      maxWidth: canvas.style.maxWidth,
      minHeight: canvas.style.minHeight,
      maxHeight: canvas.style.maxHeight,
      boxSizing: canvas.style.boxSizing,
      objectFit: canvas.style.objectFit
    };
    document.fullscreenElement = this;
    return Promise.resolve();
  };
  canvas.requestFullscreen = nativeRequest;

  runtime.installCanvasAndFullscreenHandlers();
  const wrappedRequest = canvas.requestFullscreen;
  assert.notStrictEqual(wrappedRequest, nativeRequest);
  canvas.requestFullscreen();

  const wrapper = runtime.fullscreenWrapper;
  assert.ok(wrapper);
  assert.strictEqual(requestedTarget, wrapper);
  assert.notStrictEqual(requestedTarget, canvas);
  assert.strictEqual(wrapper.attributes['data-yvsim-webgl-fullscreen-host'], 'true');
  assert.strictEqual(wrapper.style.position, 'fixed');
  assert.strictEqual(wrapper.style.left, '0');
  assert.strictEqual(wrapper.style.top, '0');
  assert.strictEqual(wrapper.style.right, '0');
  assert.strictEqual(wrapper.style.bottom, '0');
  assert.strictEqual(wrapper.style.width, '100%');
  assert.strictEqual(wrapper.style.height, '100%');
  assert.strictEqual(wrapper.style.overflow, 'hidden');
  assert.strictEqual(wrapper.style.display, 'flex');
  assert.strictEqual(wrapper.style.alignItems, 'center');
  assert.strictEqual(wrapper.style.justifyContent, 'center');
  assert.strictEqual(canvas.parentNode, wrapper);
  assert.strictEqual(runtime.singleLineInput.parentNode, wrapper);
  assert.strictEqual(runtime.multiLineInput.parentNode, wrapper);
  assert.ok(childrenAtRequest.includes(canvas));
  assert.ok(childrenAtRequest.includes(runtime.multiLineInput));
  assert.deepStrictEqual(canvasStyleAtRequest, {
    width: '1728px',
    height: '1080px',
    display: 'block',
    margin: '0',
    minWidth: '0',
    maxWidth: 'none',
    minHeight: '0',
    maxHeight: 'none',
    boxSizing: 'border-box',
    objectFit: 'fill'
  });

  canvas.style.width = '640px';
  canvas.style.height = '480px';
  canvas.width = 1920;
  canvas.height = 1080;
  document.dispatch('fullscreenchange');
  assert.strictEqual(canvas.style.width, '1920px');
  assert.strictEqual(canvas.style.height, '1080px');
  assert.strictEqual(canvas.getBoundingClientRect().width, 1920);
  assert.strictEqual(canvas.getBoundingClientRect().height, 1080);

  document.fullscreenElement = null;
  document.dispatch('fullscreenchange');
  window.flushTimers();
  assert.strictEqual(runtime.fullscreenWrapper, null);
  assert.strictEqual(canvas.parentNode, document.body);
  assert.strictEqual(runtime.singleLineInput.parentNode, document.body);
  assert.strictEqual(runtime.multiLineInput.parentNode, document.body);
  assert.strictEqual(canvas.requestFullscreen, wrappedRequest);
  assert.strictEqual(canvas.style.width, '960px');
  assert.strictEqual(canvas.style.height, '600px');
  assert.strictEqual(canvas.style.display, 'inline-block');
  assert.strictEqual(canvas.style.margin, '7px');
  assert.strictEqual(canvas.style.minWidth, '320px');
  assert.strictEqual(canvas.style.maxWidth, '1280px');
  assert.strictEqual(canvas.style.minHeight, '200px');
  assert.strictEqual(canvas.style.maxHeight, '720px');
  assert.strictEqual(canvas.style.boxSizing, 'content-box');
  assert.strictEqual(canvas.style.objectFit, 'fill');
  assert.strictEqual(canvas.width, 1920);
  assert.strictEqual(canvas.height, 1080);

  runtime.removeHandlers();
  assert.strictEqual(canvas.requestFullscreen, nativeRequest);
}

function testCanvasFullscreenManualEditingAndClipboard(harness) {
  const { canvas, document, runtime, window } = harness;
  const snapshots = [];
  runtime.ensureTextElements();
  document.fullscreenElement = canvas;
  runtime.mountTextElements();
  const input = runtime.multiLineInput;
  runtime.activeTextElement = input;
  runtime.textInputCallback = 1;
  runtime.sendTextInputState = element => {
    snapshots.push({
      text: element.value,
      anchor: runtime.getSelection(element).anchor,
      focus: runtime.getSelection(element).focus
    });
  };

  input.value = 'A\uD83D\uDE00B\nCD';
  input.setSelectionRange(1, 1, 'forward');
  const insertEvent = createBeforeInputEvent('insertText', '\u4E2D\u6587');
  input.dispatch('beforeinput', insertEvent);
  assert.strictEqual(input.value, 'A\u4E2D\u6587\uD83D\uDE00B\nCD');
  assert.strictEqual(runtime.getSelection(input).anchor, 3);
  assert.strictEqual(runtime.getSelection(input).focus, 3);
  assert.strictEqual(insertEvent.preventDefaultCount, 1);
  assert.strictEqual(insertEvent.stopImmediatePropagationCount, 1);

  input.setSelectionRange(5, 5, 'forward');
  const deleteEvent = createBeforeInputEvent('deleteContentBackward', null);
  input.dispatch('beforeinput', deleteEvent);
  assert.strictEqual(input.value, 'A\u4E2D\u6587B\nCD');
  assert.strictEqual(runtime.getSelection(input).anchor, 3);
  assert.strictEqual(runtime.getSelection(input).focus, 3);

  input.dispatch('compositionstart', {});
  input.dispatch('compositionend', { data: '\u8F93\u5165' });
  assert.strictEqual(input.value, 'A\u4E2D\u6587\u8F93\u5165B\nCD');
  assert.strictEqual(runtime.getSelection(input).anchor, 5);
  assert.strictEqual(runtime.getSelection(input).focus, 5);

  const pasteEvent = createClipboardEvent(input, '\u7C98\u8D34\n\u884C');
  input.dispatch('paste', pasteEvent);
  assert.strictEqual(input.value, 'A\u4E2D\u6587\u8F93\u5165\u7C98\u8D34\n\u884CB\nCD');
  assert.strictEqual(pasteEvent.preventDefaultCount, 1);
  assert.strictEqual(pasteEvent.stopImmediatePropagationCount, 1);

  input.setSelectionRange(0, 3, 'forward');
  const copyEvent = createClipboardEvent(input, '');
  input.dispatch('copy', copyEvent);
  assert.strictEqual(copyEvent.getValue(), 'A\u4E2D\u6587');
  assert.strictEqual(copyEvent.preventDefaultCount, 1);

  const cutStart = input.value.indexOf('\u8F93\u5165');
  input.setSelectionRange(cutStart, cutStart + 2, 'forward');
  const cutEvent = createClipboardEvent(input, '');
  input.dispatch('cut', cutEvent);
  assert.strictEqual(cutEvent.getValue(), '\u8F93\u5165');
  assert.strictEqual(input.value, 'A\u4E2D\u6587\u7C98\u8D34\n\u884CB\nCD');

  input.setSelectionRange(input.value.length, input.value.length, 'forward');
  input.dispatch('keydown', {
    key: 'x',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    stopPropagation() {}
  });
  window.flushTimers();
  assert.strictEqual(input.value, 'A\u4E2D\u6587\u7C98\u8D34\n\u884CB\nCDx');
  assert.ok(snapshots.length >= 6);
}

function testEnterKeysDelegateToUnityForEveryLineMode(harness) {
  const { dynCallHandlers, library, runtime, window } = harness;
  const valuePointer = 2600;
  const valueLength = writeUtf8(harness, valuePointer, '中文 input');
  const callbackCalls = [];
  const order = [];
  let callbackResult = 1;

  library.YvsimWebGLInput_RegisterEnterKeyCallback(909);
  runtime.sendTextInputState = element => {
    order.push('sync:' + element.value);
  };
  dynCallHandlers.set(909, (signature, args) => {
    order.push('enter');
    callbackCalls.push({ signature, args: Array.from(args) });
    return callbackResult;
  });

  function begin(lineMode) {
    library.YvsimWebGLInput_BeginTextInput(
      valuePointer,
      valueLength,
      8,
      8,
      lineMode,
      0,
      0,
      500,
      200,
      1000,
      500
    );
    order.length = 0;
    return runtime.activeTextElement;
  }

  let element = begin(0);
  let enter = createKeyboardEvent({ key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
  element.dispatch('keydown', enter);
  assert.deepStrictEqual(order, ['sync:中文 input', 'enter']);
  assert.deepStrictEqual(callbackCalls[0], { signature: 'iii', args: [0, 0] });
  assert.strictEqual(enter.preventDefaultCount, 1);
  assert.strictEqual(enter.stopImmediatePropagationCount, 1);
  window.flushTimers();

  element = begin(1);
  enter = createKeyboardEvent({
    key: 'Enter',
    code: 'NumpadEnter',
    shiftKey: true,
    ctrlKey: true,
    altKey: true,
    metaKey: true
  });
  element.dispatch('keydown', enter);
  assert.deepStrictEqual(callbackCalls[1], { signature: 'iii', args: [1, 15] });
  assert.strictEqual(enter.preventDefaultCount, 1);
  window.flushTimers();

  element = begin(2);
  enter = createKeyboardEvent({ keyCode: 13 });
  element.dispatch('keydown', enter);
  assert.deepStrictEqual(callbackCalls[2], { signature: 'iii', args: [0, 0] });
  assert.strictEqual(enter.preventDefaultCount, 1);
  window.flushTimers();

  const callsBeforeRejected = callbackCalls.length;
  callbackResult = 0;
  enter = createKeyboardEvent({ which: 13 });
  element.dispatch('keydown', enter);
  assert.strictEqual(callbackCalls.length, callsBeforeRejected + 1);
  assert.strictEqual(enter.preventDefaultCount, 0);
  assert.strictEqual(enter.stopImmediatePropagationCount, 0);
  window.flushTimers();

  callbackResult = 1;
  const callsBeforeComposition = callbackCalls.length;
  runtime.isComposing = true;
  element.dispatch('keydown', createKeyboardEvent({ key: 'Enter', keyCode: 13 }));
  runtime.isComposing = false;
  element.dispatch('keydown', createKeyboardEvent({ key: 'Enter', isComposing: true }));
  element.dispatch('keydown', createKeyboardEvent({ key: 'Enter', keyCode: 229 }));
  window.flushTimers();
  assert.strictEqual(callbackCalls.length, callsBeforeComposition);

  const callsBeforeFallback = callbackCalls.length;
  const beforeInput = createBeforeInputEvent('insertParagraph', null);
  element.dispatch('beforeinput', beforeInput);
  assert.strictEqual(callbackCalls.length, callsBeforeFallback + 1);
  assert.strictEqual(beforeInput.preventDefaultCount, 1);

  const callsBeforeDeduplication = callbackCalls.length;
  enter = createKeyboardEvent({ key: 'Enter' });
  element.dispatch('keydown', enter);
  const duplicateBeforeInput = createBeforeInputEvent('insertLineBreak', null);
  element.dispatch('beforeinput', duplicateBeforeInput);
  assert.strictEqual(callbackCalls.length, callsBeforeDeduplication + 1);
  assert.strictEqual(duplicateBeforeInput.preventDefaultCount, 1);
  window.flushTimers();

  const textarea = begin(1);
  library.YvsimWebGLInput_UpdateTextInput(
    valuePointer,
    valueLength,
    8,
    8,
    2,
    0,
    0,
    500,
    200,
    1000,
    500
  );
  assert.strictEqual(runtime.activeTextElement, textarea);
  assert.strictEqual(runtime.activeLineMode, 2);
}

function testEndedInputSessionIgnoresOldKeydownFallback(harness) {
  const { canvas, document, library, runtime, window } = harness;
  const valuePointer = 3000;
  const valueLength = writeUtf8(harness, valuePointer, 'A');
  runtime.ensureTextElements();
  document.fullscreenElement = canvas;
  runtime.mountTextElements();
  runtime.activeTextElement = runtime.multiLineInput;
  runtime.activeLineMode = 2;
  runtime.textInputCallback = 1;
  runtime.multiLineInput.value = 'A';
  runtime.multiLineInput.setSelectionRange(1, 1, 'forward');

  runtime.multiLineInput.dispatch('keydown', createKeyboardEvent({ key: 'x' }));
  runtime.endTextInput();
  library.YvsimWebGLInput_BeginTextInput(
    valuePointer,
    valueLength,
    1,
    1,
    2,
    0,
    0,
    500,
    200,
    1000,
    500
  );
  window.flushTimers();
  assert.strictEqual(runtime.multiLineInput.value, 'A');
}

function testStaleCompositionCannotWriteNewInputSession(harness) {
  const { library, runtime } = harness;
  const oldPointer = 3200;
  const newPointer = 3300;
  const oldLength = writeUtf8(harness, oldPointer, 'old');
  const newLength = writeUtf8(harness, newPointer, 'new');
  const snapshots = [];

  runtime.sendTextInputState = element => {
    snapshots.push(element.value);
  };

  library.YvsimWebGLInput_BeginTextInput(
    oldPointer,
    oldLength,
    3,
    3,
    2,
    0,
    0,
    500,
    200,
    1000,
    500
  );
  const oldElement = runtime.activeTextElement;
  oldElement.dispatch('compositionstart', {});
  const originalBlur = oldElement.blur.bind(oldElement);
  oldElement.blur = () => {
    originalBlur();
    oldElement.value = 'old composition';
    oldElement.dispatch('compositionend', { data: 'old composition' });
  };

  library.YvsimWebGLInput_BeginTextInput(
    newPointer,
    newLength,
    3,
    3,
    0,
    0,
    0,
    500,
    200,
    1000,
    500
  );
  assert.strictEqual(runtime.activeTextElement, runtime.singleLineInput);
  assert.deepStrictEqual(snapshots, []);

  const reusedElement = runtime.activeTextElement;
  reusedElement.dispatch('compositionstart', {});
  const previousSessionId = runtime.textInputSessionId;
  library.YvsimWebGLInput_BeginTextInput(
    newPointer,
    newLength,
    3,
    3,
    0,
    0,
    0,
    500,
    200,
    1000,
    500
  );
  assert.ok(runtime.textInputSessionId > previousSessionId);
  reusedElement.dispatch('compositionend', { data: 'stale' });
  assert.deepStrictEqual(snapshots, []);
  assert.strictEqual(runtime.isComposing, false);
}

function testTextInputReleasesPointerLock(harness) {
  const { canvas, document, library, runtime, window } = harness;
  const valuePointer = 2400;
  const valueLength = writeUtf8(harness, valuePointer, 'pointer lock test');
  document.pointerLockElement = canvas;

  library.YvsimWebGLInput_BeginTextInput(
    valuePointer,
    valueLength,
    0,
    0,
    2,
    0,
    0,
    500,
    200,
    1000,
    500
  );
  assert.strictEqual(document.pointerLockElement, null);
  assert.strictEqual(document.exitPointerLockCount, 1);

  runtime.installCanvasAndFullscreenHandlers();
  document.pointerLockElement = canvas;
  document.dispatch('pointerlockchange');
  assert.strictEqual(document.pointerLockElement, null);
  assert.strictEqual(document.exitPointerLockCount, 2);
  window.flushTimers();
  assert.strictEqual(document.activeElement, runtime.multiLineInput);
}

const jslibPath = path.resolve(
  __dirname,
  '..',
  '..',
  'Runtime',
  'Plugins',
  'WebGL',
  'YvsimWebGLInput.jslib'
);

const tests = [
  testUtf8AndSelectionCallback,
  testKeydownSelectionSyncAndCompositionGuard,
  testArrowNavigationDelegatesToUnity,
  testClipboardEventsPreserveExactUnicode,
  testClipboardIgnoresUnrelatedHtmlControls,
  testSingleAndMultilineInputLifecycle,
  testCanvasPointerAndWindowEventsRestoreFocus,
  testPointerCancelUsesCancelCallbackInsteadOfRelease,
  testPointerSelectionAuthorityWaitsForUnityCompletion,
  testFullscreenHostRemountAndRefocus,
  testCanvasFullscreenRequestUsesSiblingWrapper,
  testConcurrentFullscreenRequestsOnlyCleanUpOwnWrapper,
  testCanvasFullscreenManualEditingAndClipboard,
  testEnterKeysDelegateToUnityForEveryLineMode,
  testEndedInputSessionIgnoresOldKeydownFallback,
  testStaleCompositionCannotWriteNewInputSession,
  testTextInputReleasesPointerLock
];

(async () => {
  for (const test of tests) {
    // 部分用例需要真实微任务来复现异步 Promise 竞态，因此逐个 await。
    await test(createHarness(jslibPath));
    process.stdout.write('PASS ' + test.name + '\n');
  }
})();
