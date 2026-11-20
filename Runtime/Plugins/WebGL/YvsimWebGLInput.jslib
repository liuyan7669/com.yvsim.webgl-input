var YvsimWebGLInputLibrary = {
  $YvsimWebGLInput: {
    pasteCallback: 0,
    copyCallback: 0,
    textInputCallback: 0,
    navigationCallback: 0,
    enterKeyCallback: 0,
    pointerReleaseCallback: 0,
    pointerCancelCallback: 0,
    pointerDownCallback: 0,
    pasteHandler: null,
    copyHandler: null,
    keyHandler: null,
    canvasPointerDownHandler: null,
    canvasPointerHandler: null,
    windowBlurHandler: null,
    canvasPointerInteractionActive: false,
    canvasPointerInteractionSessionId: 0,
    canvasPointerInteractionSource: '',
    canvasPointerInteractionPointerId: null,
    canvasPointerInteractionPointerType: '',
    canvasPointerInteractionHadTextInput: false,
    canvasPointerReleasePending: false,
    canvasMouseReleaseRecoveryPending: false,
    canvasMouseReleaseRecoveredSessionId: -1,
    canvasPointerCompletionTimer: null,
    fullscreenHandler: null,
    pointerLockHandler: null,
    resizeHandler: null,
    windowFocusHandler: null,
    fullscreenRequestPatches: [],
    fullscreenWrapper: null,
    fullscreenCanvasParent: null,
    fullscreenCanvasNextSibling: null,
    fullscreenCanvasStyleSnapshot: null,
    singleLineInput: null,
    multiLineInput: null,
    activeTextElement: null,
    activeLineMode: 0,
    textInputSessionId: 0,
    lineBreakHandledOnKeyDown: false,
    isComposing: false,
    compositionElement: null,
    compositionSessionId: 0,
    compositionStartValue: '',
    compositionStartAnchor: 0,
    compositionStartFocus: 0,
    inputMutationSerial: 0,
    suppressDomEvents: false,
    copyText: '',
    copyTextReady: false,
    textDecoder: null,
    textEncoder: null,

    getCanvas: function () {
      return typeof Module !== 'undefined' ? Module.canvas : null;
    },

    getFullscreenElement: function () {
      return document.fullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement ||
        document.webkitFullscreenElement ||
        document.webkitCurrentFullScreenElement ||
        null;
    },

    isManagedTextElement: function (element) {
      return !!element &&
        (element === YvsimWebGLInput.singleLineInput ||
         element === YvsimWebGLInput.multiLineInput);
    },

    isCanvasFullscreenTextElement: function (element) {
      var canvas = YvsimWebGLInput.getCanvas();
      return !!canvas &&
        element === YvsimWebGLInput.activeTextElement &&
        YvsimWebGLInput.getFullscreenElement() === canvas &&
        element.parentNode === canvas;
    },

    readUtf8: function (utf8Bytes, byteLength) {
      if (byteLength <= 0) {
        return '';
      }

      if (!YvsimWebGLInput.textDecoder) {
        YvsimWebGLInput.textDecoder = new TextDecoder('utf-8', { fatal: true });
      }

      return YvsimWebGLInput.textDecoder.decode(
        HEAPU8.subarray(utf8Bytes, utf8Bytes + byteLength)
      );
    },

    focusActiveTextElement: function () {
      var element = YvsimWebGLInput.activeTextElement;
      if (YvsimWebGLInput.canvasPointerInteractionActive ||
          (typeof document.hasFocus === 'function' && !document.hasFocus()) ||
          !element ||
          !document.contains(element) ||
          document.activeElement === element) {
        return;
      }

      try {
        element.focus({ preventScroll: true });
      } catch (exception) {
        element.focus();
      }
    },

    shouldTrackCanvasPointerDown: function (event) {
      if (!event || event.isPrimary === false) {
        return false;
      }

      if (event.type === 'pointerdown' || event.type === 'mousedown') {
        return typeof event.button === 'undefined' || event.button === 0;
      }

      return event.type === 'touchstart';
    },

    beginCanvasPointerInteraction: function (event) {
      if (!YvsimWebGLInput.shouldTrackCanvasPointerDown(event)) {
        return;
      }

      if (YvsimWebGLInput.canvasPointerInteractionActive &&
          !YvsimWebGLInput.canvasPointerReleasePending) {
        return;
      }

      YvsimWebGLInput.clearCanvasPointerCompletionTimer();
      YvsimWebGLInput.canvasPointerInteractionSessionId += 1;
      YvsimWebGLInput.canvasPointerInteractionActive = true;
      YvsimWebGLInput.canvasPointerInteractionSource =
        event.type === 'pointerdown' ? 'pointer' :
        (event.type === 'mousedown' ? 'mouse' : 'touch');
      YvsimWebGLInput.canvasPointerInteractionPointerId =
        event.type === 'pointerdown' && typeof event.pointerId !== 'undefined'
          ? event.pointerId
          : null;
      YvsimWebGLInput.canvasPointerInteractionPointerType =
        event.type === 'pointerdown' && typeof event.pointerType === 'string'
          ? event.pointerType
          : '';
      YvsimWebGLInput.canvasPointerInteractionHadTextInput =
        !!YvsimWebGLInput.activeTextElement;
      YvsimWebGLInput.canvasPointerReleasePending = false;
      YvsimWebGLInput.canvasMouseReleaseRecoveryPending = false;
      YvsimWebGLInput.notifyCanvasPointerDown(event);
    },

    getCanvasPointerScreenPosition: function (event) {
      var canvas = YvsimWebGLInput.getCanvas();
      if (!canvas || !event || !canvas.getBoundingClientRect) {
        return null;
      }

      var point = event;
      if (event.type === 'touchstart') {
        var touches = event.touches || event.changedTouches;
        point = touches && touches.length > 0 ? touches[0] : null;
      }
      if (!point || typeof point.clientX !== 'number' ||
          typeof point.clientY !== 'number') {
        return null;
      }

      var rect = canvas.getBoundingClientRect();
      var width = Number(canvas.width);
      var height = Number(canvas.height);
      if (!rect || rect.width <= 0 || rect.height <= 0 ||
          !isFinite(width) || !isFinite(height) || width <= 0 || height <= 0) {
        return null;
      }

      return {
        x: Math.round(Math.max(0, Math.min(width,
          (point.clientX - rect.left) * width / rect.width))),
        y: Math.round(Math.max(0, Math.min(height,
          (rect.bottom - point.clientY) * height / rect.height)))
      };
    },

    notifyCanvasPointerDown: function (event) {
      if (!YvsimWebGLInput.pointerDownCallback) {
        return false;
      }

      var position = YvsimWebGLInput.getCanvasPointerScreenPosition(event);
      if (!position) {
        return false;
      }

      try {
        var clickCount = typeof event.detail === 'number' && event.detail > 0
          ? Math.round(event.detail)
          : 1;
        return !!dynCall('iiiii', YvsimWebGLInput.pointerDownCallback, [
          position.x,
          position.y,
          event.shiftKey ? 1 : 0,
          clickCount
        ]);
      } catch (exception) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('Yvsim WebGL pointer down callback failed.', exception);
        }
        return false;
      }
    },

    isMatchingCanvasPointerRelease: function (event) {
      if (!YvsimWebGLInput.canvasPointerInteractionActive || !event) {
        return false;
      }

      var source = YvsimWebGLInput.canvasPointerInteractionSource;
      if (source === 'pointer') {
        if (event.type === 'pointerup' || event.type === 'pointercancel') {
          if (event.isPrimary === false) {
            return false;
          }

          var pointerId = YvsimWebGLInput.canvasPointerInteractionPointerId;
          if (pointerId !== null && typeof event.pointerId !== 'undefined' &&
              event.pointerId !== pointerId) {
            return false;
          }

          var pointerType = YvsimWebGLInput.canvasPointerInteractionPointerType;
          if (pointerType && event.pointerType && event.pointerType !== pointerType) {
            return false;
          }

          return event.type === 'pointercancel' ||
            typeof event.button === 'undefined' || event.button === 0;
        }

        return (YvsimWebGLInput.canvasPointerInteractionPointerType === '' ||
                YvsimWebGLInput.canvasPointerInteractionPointerType === 'mouse') &&
          event.type === 'mouseup' &&
          (typeof event.button === 'undefined' || event.button === 0);
      }

      if (source === 'mouse') {
        return event.type === 'mouseup' &&
          (typeof event.button === 'undefined' || event.button === 0);
      }

      return source === 'touch' &&
        (event.type === 'touchend' || event.type === 'touchcancel');
    },

    shouldRecoverCanvasMouseRelease: function (event) {
      if (!event) {
        return false;
      }

      if (event.type === 'mouseup') {
        return typeof event.button === 'undefined' || event.button === 0;
      }

      return event.type === 'pointerup' &&
        event.isPrimary !== false &&
        (typeof event.pointerType === 'undefined' || event.pointerType === 'mouse') &&
        (typeof event.button === 'undefined' || event.button === 0);
    },

    clearCanvasPointerCompletionTimer: function () {
      if (YvsimWebGLInput.canvasPointerCompletionTimer === null) {
        return;
      }

      if (typeof window.clearTimeout === 'function') {
        window.clearTimeout(YvsimWebGLInput.canvasPointerCompletionTimer);
      }
      YvsimWebGLInput.canvasPointerCompletionTimer = null;
    },

    scheduleCanvasPointerInteractionFallback: function (sessionId) {
      YvsimWebGLInput.clearCanvasPointerCompletionTimer();
      YvsimWebGLInput.canvasPointerCompletionTimer = window.setTimeout(function () {
        YvsimWebGLInput.canvasPointerCompletionTimer = null;
        if (sessionId !== YvsimWebGLInput.canvasPointerInteractionSessionId ||
            !YvsimWebGLInput.canvasPointerInteractionActive) {
          return;
        }

        // The managed callback normally completes the handshake after Unity has
        // consumed pointer-up. This timeout only prevents a permanently frozen
        // input proxy when an unsupported input module or callback failure blocks it.
        YvsimWebGLInput.scheduleCanvasPointerInteractionCompletion(sessionId);
      }, 1000);
    },

    scheduleCanvasMouseReleaseRecovery: function (event) {
      if (!YvsimWebGLInput.canvasPointerInteractionActive ||
          !YvsimWebGLInput.canvasPointerInteractionHadTextInput ||
          !YvsimWebGLInput.pointerReleaseCallback ||
          !YvsimWebGLInput.shouldRecoverCanvasMouseRelease(event)) {
        return false;
      }

      var sessionId = YvsimWebGLInput.canvasPointerInteractionSessionId;
      if (YvsimWebGLInput.canvasMouseReleaseRecoveryPending ||
          YvsimWebGLInput.canvasMouseReleaseRecoveredSessionId === sessionId) {
        return true;
      }

      YvsimWebGLInput.canvasMouseReleaseRecoveryPending = true;

      var recoverAfterBrowserRelease = function () {
        if (sessionId !== YvsimWebGLInput.canvasPointerInteractionSessionId ||
            !YvsimWebGLInput.canvasPointerInteractionActive) {
          return;
        }

        YvsimWebGLInput.canvasMouseReleaseRecoveryPending = false;
        YvsimWebGLInput.canvasMouseReleaseRecoveredSessionId = sessionId;
        var callbackHandled = false;
        try {
          if (YvsimWebGLInput.canvasPointerInteractionHadTextInput &&
              YvsimWebGLInput.pointerReleaseCallback) {
            callbackHandled = !!dynCall(
              'i',
              YvsimWebGLInput.pointerReleaseCallback,
              []
            );
          }
        } catch (exception) {
          if (typeof console !== 'undefined' && console.error) {
            console.error('Yvsim WebGL pointer release callback failed.', exception);
          }
        }

        if (!callbackHandled) {
          YvsimWebGLInput.completeCanvasPointerInteractionFromUnity();
        }
      };
      // Leave the capture listener first so Unity/Emscripten can consume the
      // native event, but notify C# before the next Unity frame processes a
      // buttonless move against stale PointerEventData.
      window.setTimeout(recoverAfterBrowserRelease, 0);
      return true;
    },

    isCanvasPointerCancelEvent: function (event) {
      return !!event &&
        (event.type === 'pointercancel' || event.type === 'touchcancel');
    },

    // An interrupted gesture (pointercancel, touchcancel, real window blur) never
    // produces a browser click, so C# uses cancel semantics here and only drops the
    // residual Unity press/drag state.
    notifyCanvasPointerCancel: function () {
      if (!YvsimWebGLInput.canvasPointerInteractionActive ||
          !YvsimWebGLInput.canvasPointerInteractionHadTextInput ||
          !YvsimWebGLInput.pointerCancelCallback) {
        return false;
      }

      try {
        return !!dynCall('i', YvsimWebGLInput.pointerCancelCallback, []);
      } catch (exception) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('Yvsim WebGL pointer cancel callback failed.', exception);
        }
        return false;
      }
    },

    scheduleCanvasPointerInteractionCompletion: function (sessionId) {
      YvsimWebGLInput.clearCanvasPointerCompletionTimer();
      var completeRelease = function () {
        if (sessionId !== YvsimWebGLInput.canvasPointerInteractionSessionId) {
          return;
        }

        YvsimWebGLInput.canvasPointerInteractionActive = false;
        YvsimWebGLInput.canvasPointerInteractionSource = '';
        YvsimWebGLInput.canvasPointerInteractionPointerId = null;
        YvsimWebGLInput.canvasPointerInteractionPointerType = '';
        YvsimWebGLInput.canvasPointerInteractionHadTextInput = false;
        YvsimWebGLInput.canvasPointerReleasePending = false;
        YvsimWebGLInput.canvasMouseReleaseRecoveryPending = false;
        if (!YvsimWebGLInput.activeTextElement) {
          return;
        }

        YvsimWebGLInput.exitPointerLockForTextInput();
        YvsimWebGLInput.mountTextElements();
        YvsimWebGLInput.focusActiveTextElement();
      };
      var scheduleAfterUnityFrame = function () {
        // Restore DOM focus only after Unity has consumed the recovered release.
        window.setTimeout(completeRelease, 0);
      };

      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(scheduleAfterUnityFrame);
      } else {
        scheduleAfterUnityFrame();
      }
    },

    finishCanvasPointerInteraction: function (waitForUnityCompletion) {
      if (!YvsimWebGLInput.canvasPointerInteractionActive) {
        return;
      }

      var sessionId = YvsimWebGLInput.canvasPointerInteractionSessionId;
      if (YvsimWebGLInput.canvasPointerReleasePending) {
        return;
      }

      YvsimWebGLInput.canvasPointerReleasePending = true;
      if (waitForUnityCompletion) {
        YvsimWebGLInput.scheduleCanvasPointerInteractionFallback(sessionId);
      } else {
        YvsimWebGLInput.scheduleCanvasPointerInteractionCompletion(sessionId);
      }
    },

    completeCanvasPointerInteractionFromUnity: function () {
      if (!YvsimWebGLInput.canvasPointerInteractionActive ||
          !YvsimWebGLInput.canvasPointerReleasePending) {
        return;
      }

      YvsimWebGLInput.scheduleCanvasPointerInteractionCompletion(
        YvsimWebGLInput.canvasPointerInteractionSessionId
      );
    },

    cancelCanvasPointerInteraction: function () {
      YvsimWebGLInput.clearCanvasPointerCompletionTimer();
      YvsimWebGLInput.canvasPointerInteractionSessionId += 1;
      YvsimWebGLInput.canvasPointerInteractionActive = false;
      YvsimWebGLInput.canvasPointerInteractionSource = '';
      YvsimWebGLInput.canvasPointerInteractionPointerId = null;
      YvsimWebGLInput.canvasPointerInteractionPointerType = '';
      YvsimWebGLInput.canvasPointerInteractionHadTextInput = false;
      YvsimWebGLInput.canvasPointerReleasePending = false;
      YvsimWebGLInput.canvasMouseReleaseRecoveryPending = false;
    },

    exitPointerLockForTextInput: function () {
      if (!YvsimWebGLInput.activeTextElement) {
        return;
      }

      var lockedElement = document.pointerLockElement ||
        document.mozPointerLockElement ||
        document.webkitPointerLockElement ||
        null;
      if (!lockedElement) {
        return;
      }

      var exitPointerLock = document.exitPointerLock ||
        document.mozExitPointerLock ||
        document.webkitExitPointerLock;
      if (exitPointerLock) {
        exitPointerLock.call(document);
      }
    },

    getTextElementHost: function () {
      var fullscreenElement = YvsimWebGLInput.getFullscreenElement();

      if (fullscreenElement &&
          typeof fullscreenElement.appendChild === 'function') {
        return fullscreenElement;
      }

      return document.body || document.documentElement;
    },

    mountTextElementsToHost: function (host) {
      if (!host) {
        return;
      }

      if (YvsimWebGLInput.singleLineInput &&
          YvsimWebGLInput.singleLineInput.parentNode !== host) {
        host.appendChild(YvsimWebGLInput.singleLineInput);
      }

      if (YvsimWebGLInput.multiLineInput &&
          YvsimWebGLInput.multiLineInput.parentNode !== host) {
        host.appendChild(YvsimWebGLInput.multiLineInput);
      }
    },

    mountTextElements: function () {
      YvsimWebGLInput.mountTextElementsToHost(
        YvsimWebGLInput.getTextElementHost()
      );
    },

    getNextSibling: function (element) {
      if (!element || !element.parentNode) {
        return null;
      }

      if (typeof element.nextSibling !== 'undefined') {
        return element.nextSibling;
      }

      var children = element.parentNode.children;
      if (!children) {
        return null;
      }

      for (var i = 0; i < children.length - 1; i += 1) {
        if (children[i] === element) {
          return children[i + 1];
        }
      }

      return null;
    },

    captureFullscreenCanvasStyle: function (canvas) {
      if (!canvas || !canvas.style) {
        return null;
      }

      var style = canvas.style;
      return {
        width: style.width,
        height: style.height,
        display: style.display,
        margin: style.margin,
        minWidth: style.minWidth,
        maxWidth: style.maxWidth,
        minHeight: style.minHeight,
        maxHeight: style.maxHeight,
        boxSizing: style.boxSizing,
        objectFit: style.objectFit
      };
    },

    applyFullscreenCanvasStyle: function (canvas) {
      if (!canvas || !canvas.style) {
        return;
      }

      var sourceWidth = Number(canvas.width);
      var sourceHeight = Number(canvas.height);
      if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
        var currentRect = canvas.getBoundingClientRect
          ? canvas.getBoundingClientRect()
          : null;
        sourceWidth = sourceWidth > 0
          ? sourceWidth
          : (currentRect && currentRect.width > 0 ? currentRect.width : 1);
        sourceHeight = sourceHeight > 0
          ? sourceHeight
          : (currentRect && currentRect.height > 0 ? currentRect.height : 1);
      }

      var host = YvsimWebGLInput.fullscreenWrapper || canvas.parentNode;
      var hostRect = host && host.getBoundingClientRect
        ? host.getBoundingClientRect()
        : null;
      var availableWidth = typeof window.innerWidth === 'number' && window.innerWidth > 0
        ? window.innerWidth
        : (hostRect && hostRect.width > 0 ? hostRect.width : sourceWidth);
      var availableHeight = typeof window.innerHeight === 'number' && window.innerHeight > 0
        ? window.innerHeight
        : (hostRect && hostRect.height > 0 ? hostRect.height : sourceHeight);
      var scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
      var fittedWidth = Math.max(sourceWidth * scale, 1);
      var fittedHeight = Math.max(sourceHeight * scale, 1);

      var style = canvas.style;
      // The Canvas CSS box must be the exact visible game rectangle. A full-screen
      // box plus object-fit:contain leaves letterbox pixels inside the bounding rect,
      // while Unity maps pointer coordinates across that entire rect.
      style.width = fittedWidth + 'px';
      style.height = fittedHeight + 'px';
      style.display = 'block';
      style.margin = '0';
      style.minWidth = '0';
      style.maxWidth = 'none';
      style.minHeight = '0';
      style.maxHeight = 'none';
      style.boxSizing = 'border-box';
      style.objectFit = 'fill';
    },

    maintainFullscreenCanvasStyle: function () {
      if (YvsimWebGLInput.fullscreenWrapper &&
          YvsimWebGLInput.getFullscreenElement() ===
            YvsimWebGLInput.fullscreenWrapper) {
        YvsimWebGLInput.applyFullscreenCanvasStyle(
          YvsimWebGLInput.getCanvas()
        );
      }
    },

    restoreFullscreenCanvasStyle: function (canvas) {
      var snapshot = YvsimWebGLInput.fullscreenCanvasStyleSnapshot;
      YvsimWebGLInput.fullscreenCanvasStyleSnapshot = null;
      if (!canvas || !canvas.style || !snapshot) {
        return;
      }

      var style = canvas.style;
      style.width = snapshot.width;
      style.height = snapshot.height;
      style.display = snapshot.display;
      style.margin = snapshot.margin;
      style.minWidth = snapshot.minWidth;
      style.maxWidth = snapshot.maxWidth;
      style.minHeight = snapshot.minHeight;
      style.maxHeight = snapshot.maxHeight;
      style.boxSizing = snapshot.boxSizing;
      style.objectFit = snapshot.objectFit;
    },

    // expectedWrapper is the wrapper a specific fullscreen request created. When it
    // is passed, cleanup only runs while that wrapper is still the current one, so a
    // late reject from an older request cannot tear down a newer request's wrapper
    // and style snapshot. Omitting it cleans up the current wrapper unconditionally.
    cleanupFullscreenWrapper: function (expectedWrapper) {
      var wrapper = YvsimWebGLInput.fullscreenWrapper;
      if (expectedWrapper && expectedWrapper !== wrapper) {
        return;
      }

      var canvas = YvsimWebGLInput.getCanvas();
      var parent = YvsimWebGLInput.fullscreenCanvasParent;
      var nextSibling = YvsimWebGLInput.fullscreenCanvasNextSibling;
      if (!wrapper) {
        YvsimWebGLInput.restoreFullscreenCanvasStyle(canvas);
        return;
      }

      YvsimWebGLInput.mountTextElementsToHost(
        document.body || document.documentElement
      );
      YvsimWebGLInput.restoreFullscreenCanvasStyle(canvas);

      if (canvas && parent) {
        if (nextSibling && nextSibling.parentNode === parent && parent.insertBefore) {
          parent.insertBefore(canvas, nextSibling);
        } else {
          parent.appendChild(canvas);
        }
      }

      if (wrapper.parentNode) {
        wrapper.parentNode.removeChild(wrapper);
      }

      YvsimWebGLInput.fullscreenWrapper = null;
      YvsimWebGLInput.fullscreenCanvasParent = null;
      YvsimWebGLInput.fullscreenCanvasNextSibling = null;
    },

    requestFullscreenThroughWrapper: function (nativeRequest, requestName, args) {
      var canvas = YvsimWebGLInput.getCanvas();
      if (typeof nativeRequest !== 'function') {
        return undefined;
      }
      if (!canvas || !canvas.parentNode) {
        return nativeRequest.apply(canvas, args);
      }

      if (YvsimWebGLInput.fullscreenWrapper) {
        YvsimWebGLInput.cleanupFullscreenWrapper();
      }

      var parent = canvas.parentNode;
      var wrapper = document.createElement('div');
      wrapper.setAttribute('data-yvsim-webgl-fullscreen-host', 'true');
      wrapper.setAttribute('data-yvsim-webgl-fullscreen-request', requestName);
      wrapper.style.position = 'fixed';
      wrapper.style.left = '0';
      wrapper.style.top = '0';
      wrapper.style.right = '0';
      wrapper.style.bottom = '0';
      wrapper.style.width = '100%';
      wrapper.style.height = '100%';
      wrapper.style.margin = '0';
      wrapper.style.padding = '0';
      wrapper.style.boxSizing = 'border-box';
      wrapper.style.overflow = 'hidden';
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.justifyContent = 'center';
      wrapper.style.backgroundColor = canvas.style.backgroundColor || '#000';

      YvsimWebGLInput.fullscreenCanvasParent = parent;
      YvsimWebGLInput.fullscreenCanvasNextSibling =
        YvsimWebGLInput.getNextSibling(canvas);
      YvsimWebGLInput.fullscreenCanvasStyleSnapshot =
        YvsimWebGLInput.captureFullscreenCanvasStyle(canvas);
      YvsimWebGLInput.fullscreenWrapper = wrapper;

      if (parent.insertBefore) {
        parent.insertBefore(wrapper, canvas);
      } else {
        parent.appendChild(wrapper);
      }
      wrapper.appendChild(canvas);
      YvsimWebGLInput.applyFullscreenCanvasStyle(canvas);
      YvsimWebGLInput.mountTextElementsToHost(wrapper);
      YvsimWebGLInput.focusActiveTextElement();

      var result;
      try {
        result = nativeRequest.apply(wrapper, args);
      } catch (exception) {
        YvsimWebGLInput.cleanupFullscreenWrapper(wrapper);
        throw exception;
      }

      if (result && typeof result.catch === 'function') {
        result.catch(function () {
          if (YvsimWebGLInput.getFullscreenElement() !== wrapper) {
            YvsimWebGLInput.cleanupFullscreenWrapper(wrapper);
          }
        });
      }

      return result;
    },

    installCanvasFullscreenRedirect: function () {
      if (YvsimWebGLInput.fullscreenRequestPatches.length > 0) {
        return;
      }

      var canvas = YvsimWebGLInput.getCanvas();
      if (!canvas) {
        return;
      }

      var names = [
        'requestFullscreen',
        'mozRequestFullScreen',
        'msRequestFullscreen',
        'webkitRequestFullscreen',
        'webkitRequestFullScreen'
      ];
      for (var i = 0; i < names.length; i += 1) {
        var name = names[i];
        var nativeRequest = canvas[name];
        if (typeof nativeRequest !== 'function') {
          continue;
        }

        var hadOwnProperty = Object.prototype.hasOwnProperty.call(canvas, name);
        var wrappedRequest = (function (request, requestName) {
          return function () {
            return YvsimWebGLInput.requestFullscreenThroughWrapper(
              request,
              requestName,
              arguments
            );
          };
        })(nativeRequest, name);

        try {
          canvas[name] = wrappedRequest;
        } catch (ignored) {
          continue;
        }

        if (canvas[name] === wrappedRequest) {
          YvsimWebGLInput.fullscreenRequestPatches.push({
            name: name,
            nativeRequest: nativeRequest,
            wrappedRequest: wrappedRequest,
            hadOwnProperty: hadOwnProperty
          });
        }
      }
    },

    restoreCanvasFullscreenRedirect: function () {
      var canvas = YvsimWebGLInput.getCanvas();
      for (var i = 0; canvas && i < YvsimWebGLInput.fullscreenRequestPatches.length; i += 1) {
        var patch = YvsimWebGLInput.fullscreenRequestPatches[i];
        if (canvas[patch.name] !== patch.wrappedRequest) {
          continue;
        }

        try {
          if (patch.hadOwnProperty) {
            canvas[patch.name] = patch.nativeRequest;
          } else {
            delete canvas[patch.name];
          }
        } catch (ignored) {
        }
      }

      YvsimWebGLInput.fullscreenRequestPatches = [];
      if (YvsimWebGLInput.fullscreenWrapper) {
        YvsimWebGLInput.cleanupFullscreenWrapper();
      }
    },

    applyBaseStyle: function (element) {
      element.setAttribute('autocomplete', 'off');
      element.setAttribute('autocapitalize', 'off');
      element.setAttribute('spellcheck', 'false');
      element.setAttribute('data-yvsim-webgl-input', 'true');
      element.tabIndex = -1;

      var style = element.style;
      style.position = 'fixed';
      style.display = 'none';
      style.boxSizing = 'border-box';
      style.padding = '0';
      style.margin = '0';
      style.border = '0';
      style.outline = 'none';
      style.background = 'transparent';
      style.color = 'transparent';
      style.caretColor = 'transparent';
      style.opacity = '0.02';
      style.pointerEvents = 'none';
      style.zIndex = '2147483647';
      style.fontSize = '16px';
      style.fontFamily = 'sans-serif';
      style.lineHeight = '1';
      style.resize = 'none';
      style.overflow = 'hidden';
      style.whiteSpace = 'pre-wrap';
      style.transform = 'none';
      style.webkitTransform = 'none';
    },

    normalizeReplacementText: function (element, replacement) {
      replacement = typeof replacement === 'string' ? replacement : '';
      if (element.tagName === 'INPUT') {
        return replacement.replace(/[\r\n]+/g, '');
      }

      return replacement.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    },

    replaceTextRange: function (element, anchor, focus, replacement) {
      var value = element.value || '';
      var start = Math.max(0, Math.min(Math.min(anchor, focus), value.length));
      var end = Math.max(start, Math.min(Math.max(anchor, focus), value.length));
      var text = YvsimWebGLInput.normalizeReplacementText(element, replacement);
      element.value = value.substring(0, start) + text + value.substring(end);
      var position = start + text.length;
      YvsimWebGLInput.setSelection(element, position, position);
      YvsimWebGLInput.inputMutationSerial += 1;
    },

    previousCodePointStart: function (value, position) {
      var start = Math.max(0, position - 1);
      if (start > 0) {
        var current = value.charCodeAt(start);
        var previous = value.charCodeAt(start - 1);
        if (current >= 0xDC00 && current <= 0xDFFF &&
            previous >= 0xD800 && previous <= 0xDBFF) {
          start -= 1;
        }
      }

      return start;
    },

    nextCodePointEnd: function (value, position) {
      var end = Math.min(value.length, position + 1);
      if (position + 1 < value.length) {
        var current = value.charCodeAt(position);
        var next = value.charCodeAt(position + 1);
        if (current >= 0xD800 && current <= 0xDBFF &&
            next >= 0xDC00 && next <= 0xDFFF) {
          end += 1;
        }
      }

      return end;
    },

    stopHandledEvent: function (event) {
      if (event.preventDefault) {
        event.preventDefault();
      }
      if (event.stopImmediatePropagation) {
        event.stopImmediatePropagation();
      } else if (event.stopPropagation) {
        event.stopPropagation();
      }
    },

    isEnterEvent: function (event) {
      if (!event) {
        return false;
      }

      var key = typeof event.key === 'string' ? event.key : '';
      var code = typeof event.code === 'string' ? event.code : '';
      return key === 'Enter' || key === 'Return' || key === 'NumpadEnter' ||
        code === 'Enter' || code === 'NumpadEnter' ||
        event.keyCode === 13 || event.which === 13;
    },

    isCompositionEvent: function (event) {
      return YvsimWebGLInput.isComposing || !!(event && event.isComposing) ||
        !!(event && (event.keyCode === 229 || event.which === 229));
    },

    getModifierFlags: function (event) {
      if (!event) {
        return 0;
      }

      return (event.shiftKey ? 1 : 0) |
        (event.ctrlKey ? 2 : 0) |
        (event.altKey ? 4 : 0) |
        (event.metaKey ? 8 : 0);
    },

    tryProcessEnterKey: function (element, event, forceEnter) {
      if (element !== YvsimWebGLInput.activeTextElement ||
          !YvsimWebGLInput.enterKeyCallback ||
          YvsimWebGLInput.isCompositionEvent(event) ||
          (!forceEnter && !YvsimWebGLInput.isEnterEvent(event))) {
        return false;
      }

      YvsimWebGLInput.sendTextInputState(element);
      if (element !== YvsimWebGLInput.activeTextElement) {
        return false;
      }

      var keypadEnter = !!(event &&
        (event.key === 'NumpadEnter' || event.code === 'NumpadEnter'));
      var handled = dynCall('iii', YvsimWebGLInput.enterKeyCallback, [
        keypadEnter ? 1 : 0,
        YvsimWebGLInput.getModifierFlags(event)
      ]);
      if (!handled) {
        return false;
      }

      YvsimWebGLInput.stopHandledEvent(event);
      return true;
    },

    handleCanvasBeforeInput: function (element, event) {
      if (!YvsimWebGLInput.isCanvasFullscreenTextElement(element) ||
          YvsimWebGLInput.isComposing) {
        return false;
      }

      var selection = YvsimWebGLInput.getSelection(element);
      var value = element.value || '';
      var replacement = null;
      var anchor = selection.anchor;
      var focus = selection.focus;
      switch (event.inputType) {
        case 'insertText':
        case 'insertReplacementText':
          if (typeof event.data !== 'string') {
            return false;
          }
          replacement = event.data;
          break;
        case 'insertLineBreak':
        case 'insertParagraph':
          replacement = YvsimWebGLInput.activeLineMode === 2 ? '\n' : '';
          break;
        case 'deleteContentBackward':
          replacement = '';
          if (anchor === focus) {
            anchor = YvsimWebGLInput.previousCodePointStart(value, anchor);
          }
          break;
        case 'deleteContentForward':
          replacement = '';
          if (anchor === focus) {
            focus = YvsimWebGLInput.nextCodePointEnd(value, focus);
          }
          break;
        default:
          return false;
      }

      YvsimWebGLInput.replaceTextRange(element, anchor, focus, replacement);
      YvsimWebGLInput.stopHandledEvent(event);
      YvsimWebGLInput.sendTextInputState(element);
      return true;
    },

    handleCanvasPaste: function (element, event) {
      if (!YvsimWebGLInput.isCanvasFullscreenTextElement(element)) {
        return;
      }

      var clipboardData = event.clipboardData || window.clipboardData;
      if (!clipboardData) {
        return;
      }

      var value = clipboardData.getData('text/plain');
      if (typeof value !== 'string') {
        return;
      }

      var selection = YvsimWebGLInput.getSelection(element);
      YvsimWebGLInput.replaceTextRange(
        element,
        selection.anchor,
        selection.focus,
        value
      );
      YvsimWebGLInput.stopHandledEvent(event);
      YvsimWebGLInput.sendTextInputState(element);
    },

    handleCanvasCopyOrCut: function (element, event, cut) {
      if (!YvsimWebGLInput.isCanvasFullscreenTextElement(element) ||
          !event.clipboardData) {
        return;
      }

      var selection = YvsimWebGLInput.getSelection(element);
      var start = Math.min(selection.anchor, selection.focus);
      var end = Math.max(selection.anchor, selection.focus);
      if (start === end) {
        return;
      }

      event.clipboardData.setData('text/plain', element.value.substring(start, end));
      if (cut) {
        YvsimWebGLInput.replaceTextRange(element, start, end, '');
        YvsimWebGLInput.sendTextInputState(element);
      }
      YvsimWebGLInput.stopHandledEvent(event);
    },

    createTextElement: function (multiline) {
      var element = document.createElement(multiline ? 'textarea' : 'input');
      if (!multiline) {
        element.type = 'text';
      }

      YvsimWebGLInput.applyBaseStyle(element);

      element.addEventListener('compositionstart', function () {
        if (element !== YvsimWebGLInput.activeTextElement) {
          return;
        }

        YvsimWebGLInput.isComposing = true;
        YvsimWebGLInput.compositionElement = element;
        YvsimWebGLInput.compositionSessionId = YvsimWebGLInput.textInputSessionId;
        var selection = YvsimWebGLInput.getSelection(element);
        YvsimWebGLInput.compositionStartValue = element.value || '';
        YvsimWebGLInput.compositionStartAnchor = selection.anchor;
        YvsimWebGLInput.compositionStartFocus = selection.focus;
      }, false);

      element.addEventListener('compositionend', function (event) {
        if (element !== YvsimWebGLInput.activeTextElement ||
            element !== YvsimWebGLInput.compositionElement ||
            YvsimWebGLInput.compositionSessionId !== YvsimWebGLInput.textInputSessionId) {
          return;
        }

        YvsimWebGLInput.isComposing = false;
        YvsimWebGLInput.compositionElement = null;
        if (YvsimWebGLInput.isCanvasFullscreenTextElement(element) &&
            element.value === YvsimWebGLInput.compositionStartValue &&
            event && typeof event.data === 'string' && event.data.length > 0) {
          YvsimWebGLInput.replaceTextRange(
            element,
            YvsimWebGLInput.compositionStartAnchor,
            YvsimWebGLInput.compositionStartFocus,
            event.data
          );
        }
        YvsimWebGLInput.sendTextInputState(element);
      }, false);

      element.addEventListener('input', function () {
        YvsimWebGLInput.inputMutationSerial += 1;
        YvsimWebGLInput.sendTextInputState(element);
      }, false);

      element.addEventListener('beforeinput', function (event) {
        var lineBreak = event &&
          (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph');
        if (lineBreak && YvsimWebGLInput.lineBreakHandledOnKeyDown) {
          YvsimWebGLInput.lineBreakHandledOnKeyDown = false;
          YvsimWebGLInput.stopHandledEvent(event);
          return;
        }
        if (lineBreak && YvsimWebGLInput.tryProcessEnterKey(element, event, true)) {
          return;
        }

        YvsimWebGLInput.handleCanvasBeforeInput(element, event);
      }, false);

      element.addEventListener('paste', function (event) {
        YvsimWebGLInput.handleCanvasPaste(element, event);
      }, false);

      element.addEventListener('copy', function (event) {
        YvsimWebGLInput.handleCanvasCopyOrCut(element, event, false);
      }, false);

      element.addEventListener('cut', function (event) {
        YvsimWebGLInput.handleCanvasCopyOrCut(element, event, true);
      }, false);

      element.addEventListener('select', function () {
        YvsimWebGLInput.sendTextInputState(element);
      }, false);

      element.addEventListener('selectionchange', function () {
        YvsimWebGLInput.sendTextInputState(element);
      }, false);

      element.addEventListener('keyup', function (event) {
        if (YvsimWebGLInput.isEnterEvent(event)) {
          YvsimWebGLInput.lineBreakHandledOnKeyDown = false;
        }

        var key = event && typeof event.key === 'string' ? event.key : '';
        if (YvsimWebGLInput.suppressedNavigationKeys[key]) {
          delete YvsimWebGLInput.suppressedNavigationKeys[key];
          event.stopPropagation();
          return;
        }

        if (YvsimWebGLInput.isModifierKey(key)) {
          event.stopPropagation();
          return;
        }

        YvsimWebGLInput.sendTextInputState(element);
      }, false);

      element.addEventListener('keydown', function (event) {
        var inputSessionId = YvsimWebGLInput.textInputSessionId;
        if (YvsimWebGLInput.tryProcessEnterKey(element, event, false)) {
          if (element === YvsimWebGLInput.activeTextElement) {
            YvsimWebGLInput.lineBreakHandledOnKeyDown = true;
            window.setTimeout(function () {
              if (inputSessionId === YvsimWebGLInput.textInputSessionId) {
                YvsimWebGLInput.lineBreakHandledOnKeyDown = false;
              }
            }, 0);
          }
          return;
        }

        var direction = YvsimWebGLInput.getNavigationDirection(event.key);
        if (!YvsimWebGLInput.isComposing &&
            direction >= 0 &&
            YvsimWebGLInput.navigationCallback) {
          var handled = dynCall('iiii', YvsimWebGLInput.navigationCallback, [
            direction,
            event.shiftKey ? 1 : 0,
            event.ctrlKey || event.metaKey ? 1 : 0
          ]);
          if (handled) {
            YvsimWebGLInput.suppressedNavigationKeys[event.key] = true;
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
        }

        var key = typeof event.key === 'string' ? event.key : '';
        if (YvsimWebGLInput.isModifierKey(key)) {
          event.stopPropagation();
          return;
        }

        var serial = YvsimWebGLInput.inputMutationSerial;
        var valueBeforeKey = element.value;
        var selectionBeforeKey = YvsimWebGLInput.getSelection(element);
        var manualPrintableFallback =
          YvsimWebGLInput.isCanvasFullscreenTextElement(element) &&
          key.length === 1 &&
          !event.ctrlKey && !event.metaKey && !event.altKey;
        event.stopPropagation();
        window.setTimeout(function () {
          if (inputSessionId === YvsimWebGLInput.textInputSessionId &&
              element === YvsimWebGLInput.activeTextElement &&
              !YvsimWebGLInput.isComposing) {
            var currentSelection = YvsimWebGLInput.getSelection(element);
            if (manualPrintableFallback &&
                serial === YvsimWebGLInput.inputMutationSerial &&
                element.value === valueBeforeKey &&
                currentSelection.anchor === selectionBeforeKey.anchor &&
                currentSelection.focus === selectionBeforeKey.focus) {
              YvsimWebGLInput.replaceTextRange(
                element,
                selectionBeforeKey.anchor,
                selectionBeforeKey.focus,
                key
              );
            }
            YvsimWebGLInput.sendTextInputState(element);
          }
        }, 0);
      }, false);

      return element;
    },

    suppressedNavigationKeys: {},

    getNavigationDirection: function (key) {
      switch (key) {
        case 'ArrowLeft':
          return 0;
        case 'ArrowRight':
          return 1;
        case 'ArrowUp':
          return 2;
        case 'ArrowDown':
          return 3;
        default:
          return -1;
      }
    },

    isModifierKey: function (key) {
      return key === 'Control' || key === 'Shift' || key === 'Alt' ||
        key === 'Meta' || key === 'AltGraph';
    },

    ensureTextElements: function () {
      if (!YvsimWebGLInput.singleLineInput) {
        YvsimWebGLInput.singleLineInput = YvsimWebGLInput.createTextElement(false);
      }

      if (!YvsimWebGLInput.multiLineInput) {
        YvsimWebGLInput.multiLineInput = YvsimWebGLInput.createTextElement(true);
      }

      YvsimWebGLInput.mountTextElements();
    },

    getSelection: function (element) {
      var start = typeof element.selectionStart === 'number' ? element.selectionStart : 0;
      var end = typeof element.selectionEnd === 'number' ? element.selectionEnd : start;
      if (element.selectionDirection === 'backward') {
        return { anchor: end, focus: start };
      }

      return { anchor: start, focus: end };
    },

    setSelection: function (element, anchor, focus) {
      var textLength = element.value.length;
      anchor = Math.max(0, Math.min(anchor, textLength));
      focus = Math.max(0, Math.min(focus, textLength));

      var start = Math.min(anchor, focus);
      var end = Math.max(anchor, focus);
      var direction = anchor > focus ? 'backward' : 'forward';
      try {
        element.setSelectionRange(start, end, direction);
      } catch (exception) {
        try {
          element.setSelectionRange(start, end);
        } catch (ignored) {
        }
      }
    },

    sendTextInputState: function (element) {
      if (YvsimWebGLInput.suppressDomEvents ||
          element !== YvsimWebGLInput.activeTextElement ||
          !YvsimWebGLInput.textInputCallback) {
        return;
      }

      if (!YvsimWebGLInput.textEncoder) {
        YvsimWebGLInput.textEncoder = new TextEncoder();
      }

      var bytes = YvsimWebGLInput.textEncoder.encode(element.value);
      var pointer = _malloc(Math.max(bytes.length, 1));
      if (!pointer) {
        console.error('YvsimWebGLInput failed to allocate UTF-8 memory.');
        return;
      }

      var selection = YvsimWebGLInput.getSelection(element);
      try {
        if (bytes.length > 0) {
          HEAPU8.set(bytes, pointer);
        }

        dynCall('viiiii', YvsimWebGLInput.textInputCallback, [
          pointer,
          bytes.length,
          selection.anchor,
          selection.focus,
          YvsimWebGLInput.canvasPointerInteractionActive ? 0 : 1
        ]);
      } finally {
        _free(pointer);
      }
    },

    updateElementGeometry: function (
      element,
      screenX,
      screenY,
      screenWidth,
      screenHeight,
      unityScreenWidth,
      unityScreenHeight
    ) {
      var canvas = YvsimWebGLInput.getCanvas();
      if (!canvas || !canvas.getBoundingClientRect) {
        return;
      }

      var canvasRect = canvas.getBoundingClientRect();
      var safeUnityWidth = Math.max(unityScreenWidth, 1);
      var safeUnityHeight = Math.max(unityScreenHeight, 1);
      var left = canvasRect.left + screenX / safeUnityWidth * canvasRect.width;
      var top = canvasRect.top +
        (safeUnityHeight - screenY - screenHeight) / safeUnityHeight * canvasRect.height;
      var width = Math.max(screenWidth / safeUnityWidth * canvasRect.width, 1);
      var height = Math.max(screenHeight / safeUnityHeight * canvasRect.height, 1);

      element.style.left = left + 'px';
      element.style.top = top + 'px';
      element.style.width = width + 'px';
      element.style.height = height + 'px';
    },

    beginOrUpdateTextInput: function (
      utf8Bytes,
      byteLength,
      selectionAnchor,
      selectionFocus,
      lineMode,
      screenX,
      screenY,
      screenWidth,
      screenHeight,
      unityScreenWidth,
      unityScreenHeight,
      begin
    ) {
      YvsimWebGLInput.ensureTextElements();
      var element = lineMode === 0 ?
        YvsimWebGLInput.singleLineInput :
        YvsimWebGLInput.multiLineInput;
      if (!element) {
        return;
      }

      YvsimWebGLInput.mountTextElements();
      YvsimWebGLInput.maintainFullscreenCanvasStyle();
      YvsimWebGLInput.exitPointerLockForTextInput();
      YvsimWebGLInput.updateElementGeometry(
        element,
        screenX,
        screenY,
        screenWidth,
        screenHeight,
        unityScreenWidth,
        unityScreenHeight
      );

      if (begin || YvsimWebGLInput.activeTextElement !== element) {
        var previousElement = YvsimWebGLInput.activeTextElement;
        YvsimWebGLInput.textInputSessionId += 1;
        YvsimWebGLInput.lineBreakHandledOnKeyDown = false;
        YvsimWebGLInput.activeTextElement = null;
        YvsimWebGLInput.isComposing = false;
        YvsimWebGLInput.compositionElement = null;
        if (previousElement) {
          previousElement.style.display = 'none';
          previousElement.blur();
        }

        YvsimWebGLInput.activeTextElement = element;
        element.style.display = 'block';
      }

      // A pointer session can begin on an unfocused Unity input field and
      // activate browser text input before pointerup. Keep this flag monotonic
      // for the session so its release receives the same recovery guarantee.
      if (YvsimWebGLInput.canvasPointerInteractionActive) {
        YvsimWebGLInput.canvasPointerInteractionHadTextInput = true;
      }

      YvsimWebGLInput.activeLineMode = lineMode;

      if (!YvsimWebGLInput.isComposing) {
        var value = YvsimWebGLInput.readUtf8(utf8Bytes, byteLength);
        YvsimWebGLInput.suppressDomEvents = true;
        try {
          if (element.value !== value) {
            element.value = value;
          }
          var currentSelection = YvsimWebGLInput.getSelection(element);
          if (currentSelection.anchor !== selectionAnchor ||
              currentSelection.focus !== selectionFocus) {
            YvsimWebGLInput.setSelection(element, selectionAnchor, selectionFocus);
          }
        } finally {
          YvsimWebGLInput.suppressDomEvents = false;
        }
      }

      YvsimWebGLInput.exitPointerLockForTextInput();
      YvsimWebGLInput.focusActiveTextElement();
    },

    endTextInput: function () {
      var element = YvsimWebGLInput.activeTextElement;
      YvsimWebGLInput.activeTextElement = null;
      YvsimWebGLInput.activeLineMode = 0;
      YvsimWebGLInput.textInputSessionId += 1;
      YvsimWebGLInput.lineBreakHandledOnKeyDown = false;
      YvsimWebGLInput.isComposing = false;
      YvsimWebGLInput.compositionElement = null;
      YvsimWebGLInput.compositionStartValue = '';
      YvsimWebGLInput.compositionStartAnchor = 0;
      YvsimWebGLInput.compositionStartFocus = 0;
      YvsimWebGLInput.inputMutationSerial = 0;
      YvsimWebGLInput.suppressedNavigationKeys = {};
      if (element) {
        element.blur();
        element.style.display = 'none';
      }
    },

    removeTextElements: function () {
      YvsimWebGLInput.endTextInput();

      if (YvsimWebGLInput.singleLineInput && YvsimWebGLInput.singleLineInput.parentNode) {
        YvsimWebGLInput.singleLineInput.parentNode.removeChild(YvsimWebGLInput.singleLineInput);
      }
      if (YvsimWebGLInput.multiLineInput && YvsimWebGLInput.multiLineInput.parentNode) {
        YvsimWebGLInput.multiLineInput.parentNode.removeChild(YvsimWebGLInput.multiLineInput);
      }

      YvsimWebGLInput.singleLineInput = null;
      YvsimWebGLInput.multiLineInput = null;
    },

    removeHandlers: function () {
      if (YvsimWebGLInput.pasteHandler) {
        document.removeEventListener('paste', YvsimWebGLInput.pasteHandler, true);
        YvsimWebGLInput.pasteHandler = null;
      }

      if (YvsimWebGLInput.copyHandler) {
        document.removeEventListener('copy', YvsimWebGLInput.copyHandler, true);
        YvsimWebGLInput.copyHandler = null;
      }

      if (YvsimWebGLInput.keyHandler) {
        window.removeEventListener('keydown', YvsimWebGLInput.keyHandler, true);
        YvsimWebGLInput.keyHandler = null;
      }

      var canvas = YvsimWebGLInput.getCanvas();
      if (canvas && YvsimWebGLInput.canvasPointerDownHandler) {
        canvas.removeEventListener('pointerdown', YvsimWebGLInput.canvasPointerDownHandler, true);
        canvas.removeEventListener('mousedown', YvsimWebGLInput.canvasPointerDownHandler, true);
        canvas.removeEventListener('touchstart', YvsimWebGLInput.canvasPointerDownHandler, true);
      }
      YvsimWebGLInput.canvasPointerDownHandler = null;

      if (YvsimWebGLInput.canvasPointerHandler) {
        window.removeEventListener('pointerup', YvsimWebGLInput.canvasPointerHandler, true);
        window.removeEventListener('mouseup', YvsimWebGLInput.canvasPointerHandler, true);
        window.removeEventListener('touchend', YvsimWebGLInput.canvasPointerHandler, true);
        window.removeEventListener('pointercancel', YvsimWebGLInput.canvasPointerHandler, true);
        window.removeEventListener('touchcancel', YvsimWebGLInput.canvasPointerHandler, true);
      }
      YvsimWebGLInput.canvasPointerHandler = null;

      if (YvsimWebGLInput.windowBlurHandler) {
        window.removeEventListener('blur', YvsimWebGLInput.windowBlurHandler, true);
        YvsimWebGLInput.windowBlurHandler = null;
      }
      YvsimWebGLInput.cancelCanvasPointerInteraction();

      if (YvsimWebGLInput.fullscreenHandler) {
        document.removeEventListener('fullscreenchange', YvsimWebGLInput.fullscreenHandler, false);
        document.removeEventListener('mozfullscreenchange', YvsimWebGLInput.fullscreenHandler, false);
        document.removeEventListener('webkitfullscreenchange', YvsimWebGLInput.fullscreenHandler, false);
        document.removeEventListener('MSFullscreenChange', YvsimWebGLInput.fullscreenHandler, false);
        YvsimWebGLInput.fullscreenHandler = null;
      }

      if (YvsimWebGLInput.pointerLockHandler) {
        document.removeEventListener('pointerlockchange', YvsimWebGLInput.pointerLockHandler, false);
        document.removeEventListener('mozpointerlockchange', YvsimWebGLInput.pointerLockHandler, false);
        document.removeEventListener('webkitpointerlockchange', YvsimWebGLInput.pointerLockHandler, false);
        YvsimWebGLInput.pointerLockHandler = null;
      }

      if (YvsimWebGLInput.resizeHandler) {
        window.removeEventListener('resize', YvsimWebGLInput.resizeHandler, false);
        window.removeEventListener('orientationchange', YvsimWebGLInput.resizeHandler, false);
        YvsimWebGLInput.resizeHandler = null;
      }

      if (YvsimWebGLInput.windowFocusHandler) {
        window.removeEventListener('focus', YvsimWebGLInput.windowFocusHandler, false);
        YvsimWebGLInput.windowFocusHandler = null;
      }

      YvsimWebGLInput.restoreCanvasFullscreenRedirect();
    },

    isUnityCanvasTarget: function (event) {
      var canvas = YvsimWebGLInput.getCanvas();
      return !!canvas && (event.target === canvas || document.activeElement === canvas);
    },

    handleKeyDown: function (event) {
      if (YvsimWebGLInput.isManagedTextElement(event.target)) {
        return;
      }

      if ((!event.ctrlKey && !event.metaKey) || event.altKey ||
          !YvsimWebGLInput.isUnityCanvasTarget(event)) {
        return;
      }

      var key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
      if (key === 'c' || key === 'v') {
        event.stopImmediatePropagation();
      }
    },

    handlePaste: function (event) {
      if (YvsimWebGLInput.isManagedTextElement(event.target)) {
        return;
      }

      // Unrelated HTML controls on the page must keep native clipboard behaviour, so
      // only clipboard events that belong to the Unity Canvas reach the bridge.
      if (!YvsimWebGLInput.pasteCallback ||
          !YvsimWebGLInput.isUnityCanvasTarget(event)) {
        return;
      }

      var clipboardData = event.clipboardData || window.clipboardData;
      if (!clipboardData) {
        return;
      }

      var value = clipboardData.getData('text/plain');
      if (typeof value !== 'string') {
        return;
      }

      if (!YvsimWebGLInput.textEncoder) {
        YvsimWebGLInput.textEncoder = new TextEncoder();
      }

      var bytes = YvsimWebGLInput.textEncoder.encode(value);
      var pointer = _malloc(Math.max(bytes.length, 1));
      if (!pointer) {
        console.error('YvsimWebGLInput failed to allocate UTF-8 memory.');
        return;
      }

      var handled = 0;
      try {
        if (bytes.length > 0) {
          HEAPU8.set(bytes, pointer);
        }

        handled = dynCall('iii', YvsimWebGLInput.pasteCallback, [
          pointer,
          bytes.length
        ]);
      } finally {
        _free(pointer);
      }

      if (handled) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },

    handleCopy: function (event) {
      if (YvsimWebGLInput.isManagedTextElement(event.target)) {
        return;
      }

      // Same rule as handlePaste: copying from an external HTML control stays native.
      if (!YvsimWebGLInput.copyCallback || !event.clipboardData ||
          !YvsimWebGLInput.isUnityCanvasTarget(event)) {
        return;
      }

      YvsimWebGLInput.copyText = '';
      YvsimWebGLInput.copyTextReady = false;
      var handled = dynCall('i', YvsimWebGLInput.copyCallback, []);
      if (!handled || !YvsimWebGLInput.copyTextReady) {
        return;
      }

      event.clipboardData.setData('text/plain', YvsimWebGLInput.copyText);
      event.preventDefault();
      event.stopImmediatePropagation();
    },

    installCanvasAndFullscreenHandlers: function () {
      YvsimWebGLInput.installCanvasFullscreenRedirect();
      var canvas = YvsimWebGLInput.getCanvas();
      if (canvas && !YvsimWebGLInput.canvasPointerDownHandler) {
        YvsimWebGLInput.canvasPointerDownHandler = function (event) {
          YvsimWebGLInput.beginCanvasPointerInteraction(event);
        };
        canvas.addEventListener('pointerdown', YvsimWebGLInput.canvasPointerDownHandler, true);
        canvas.addEventListener('mousedown', YvsimWebGLInput.canvasPointerDownHandler, true);
        canvas.addEventListener('touchstart', YvsimWebGLInput.canvasPointerDownHandler, true);
      }

      if (!YvsimWebGLInput.canvasPointerHandler) {
        YvsimWebGLInput.canvasPointerHandler = function (event) {
          if (!YvsimWebGLInput.isMatchingCanvasPointerRelease(event)) {
            return;
          }

          if (YvsimWebGLInput.isCanvasPointerCancelEvent(event)) {
            var cancelRecoveryScheduled = YvsimWebGLInput.notifyCanvasPointerCancel();
            YvsimWebGLInput.finishCanvasPointerInteraction(cancelRecoveryScheduled);
            return;
          }

          var mouseReleaseRecoveryScheduled =
            YvsimWebGLInput.scheduleCanvasMouseReleaseRecovery(event);
          YvsimWebGLInput.finishCanvasPointerInteraction(mouseReleaseRecoveryScheduled);
        };
        window.addEventListener('pointerup', YvsimWebGLInput.canvasPointerHandler, true);
        window.addEventListener('mouseup', YvsimWebGLInput.canvasPointerHandler, true);
        window.addEventListener('touchend', YvsimWebGLInput.canvasPointerHandler, true);
        window.addEventListener('pointercancel', YvsimWebGLInput.canvasPointerHandler, true);
        window.addEventListener('touchcancel', YvsimWebGLInput.canvasPointerHandler, true);
      }

      if (!YvsimWebGLInput.windowBlurHandler) {
        YvsimWebGLInput.windowBlurHandler = function (event) {
          // This capture listener also sees blur events from the hidden text
          // element and Canvas. Only a real window blur ends the pointer session.
          if (event && event.target !== window) {
            return;
          }

          var cancelRecoveryScheduled = YvsimWebGLInput.notifyCanvasPointerCancel();
          if (cancelRecoveryScheduled) {
            YvsimWebGLInput.finishCanvasPointerInteraction(true);
          } else {
            YvsimWebGLInput.cancelCanvasPointerInteraction();
          }
        };
        window.addEventListener('blur', YvsimWebGLInput.windowBlurHandler, true);
      }

      if (!YvsimWebGLInput.fullscreenHandler) {
        YvsimWebGLInput.fullscreenHandler = function () {
          if (YvsimWebGLInput.fullscreenWrapper &&
              YvsimWebGLInput.getFullscreenElement() !==
                YvsimWebGLInput.fullscreenWrapper) {
            YvsimWebGLInput.cleanupFullscreenWrapper();
          }
          YvsimWebGLInput.maintainFullscreenCanvasStyle();
          YvsimWebGLInput.exitPointerLockForTextInput();
          YvsimWebGLInput.mountTextElements();
          window.setTimeout(function () {
            YvsimWebGLInput.maintainFullscreenCanvasStyle();
            YvsimWebGLInput.exitPointerLockForTextInput();
            YvsimWebGLInput.mountTextElements();
            YvsimWebGLInput.focusActiveTextElement();
          }, 0);
          window.setTimeout(function () {
            YvsimWebGLInput.maintainFullscreenCanvasStyle();
            YvsimWebGLInput.exitPointerLockForTextInput();
            YvsimWebGLInput.mountTextElements();
            YvsimWebGLInput.focusActiveTextElement();
          }, 150);
        };
        document.addEventListener('fullscreenchange', YvsimWebGLInput.fullscreenHandler, false);
        document.addEventListener('mozfullscreenchange', YvsimWebGLInput.fullscreenHandler, false);
        document.addEventListener('webkitfullscreenchange', YvsimWebGLInput.fullscreenHandler, false);
        document.addEventListener('MSFullscreenChange', YvsimWebGLInput.fullscreenHandler, false);
      }

      if (!YvsimWebGLInput.pointerLockHandler) {
        YvsimWebGLInput.pointerLockHandler = function () {
          if (!YvsimWebGLInput.activeTextElement) {
            return;
          }

          YvsimWebGLInput.exitPointerLockForTextInput();
          window.setTimeout(function () {
            YvsimWebGLInput.mountTextElements();
            YvsimWebGLInput.focusActiveTextElement();
          }, 0);
        };
        document.addEventListener('pointerlockchange', YvsimWebGLInput.pointerLockHandler, false);
        document.addEventListener('mozpointerlockchange', YvsimWebGLInput.pointerLockHandler, false);
        document.addEventListener('webkitpointerlockchange', YvsimWebGLInput.pointerLockHandler, false);
      }

      if (!YvsimWebGLInput.resizeHandler) {
        YvsimWebGLInput.resizeHandler = function () {
          window.setTimeout(function () {
            YvsimWebGLInput.maintainFullscreenCanvasStyle();
            YvsimWebGLInput.mountTextElements();
            YvsimWebGLInput.focusActiveTextElement();
          }, 0);
          window.setTimeout(function () {
            YvsimWebGLInput.maintainFullscreenCanvasStyle();
            YvsimWebGLInput.mountTextElements();
            YvsimWebGLInput.focusActiveTextElement();
          }, 150);
        };
        window.addEventListener('resize', YvsimWebGLInput.resizeHandler, false);
        window.addEventListener('orientationchange', YvsimWebGLInput.resizeHandler, false);
      }

      if (!YvsimWebGLInput.windowFocusHandler) {
        YvsimWebGLInput.windowFocusHandler = function () {
          window.setTimeout(function () {
            YvsimWebGLInput.mountTextElements();
            YvsimWebGLInput.focusActiveTextElement();
          }, 0);
        };
        window.addEventListener('focus', YvsimWebGLInput.windowFocusHandler, false);
      }
    }
  },

  YvsimWebGLInput_RegisterClipboardCallbacks__deps: ['$YvsimWebGLInput'],
  YvsimWebGLInput_RegisterClipboardCallbacks: function (pasteCallback, copyCallback) {
    YvsimWebGLInput.removeHandlers();
    YvsimWebGLInput.pasteCallback = pasteCallback;
    YvsimWebGLInput.copyCallback = copyCallback;
    YvsimWebGLInput.pasteHandler = YvsimWebGLInput.handlePaste;
    YvsimWebGLInput.copyHandler = YvsimWebGLInput.handleCopy;
    YvsimWebGLInput.keyHandler = YvsimWebGLInput.handleKeyDown;
    document.addEventListener('paste', YvsimWebGLInput.pasteHandler, true);
    document.addEventListener('copy', YvsimWebGLInput.copyHandler, true);
    window.addEventListener('keydown', YvsimWebGLInput.keyHandler, true);
    YvsimWebGLInput.installCanvasAndFullscreenHandlers();
  },

  YvsimWebGLInput_RegisterTextInputCallback__deps: ['$YvsimWebGLInput'],
  YvsimWebGLInput_RegisterTextInputCallback: function (callback) {
    YvsimWebGLInput.textInputCallback = callback;
    YvsimWebGLInput.ensureTextElements();
    YvsimWebGLInput.installCanvasAndFullscreenHandlers();
  },

  YvsimWebGLInput_RegisterNavigationCallback__deps: ['$YvsimWebGLInput'],
  YvsimWebGLInput_RegisterNavigationCallback: function (callback) {
    YvsimWebGLInput.navigationCallback = callback;
  },

  YvsimWebGLInput_RegisterEnterKeyCallback__deps: ['$YvsimWebGLInput'],
  YvsimWebGLInput_RegisterEnterKeyCallback: function (callback) {
    YvsimWebGLInput.enterKeyCallback = callback;
  },

  YvsimWebGLInput_RegisterPointerReleaseCallback__deps: ['$YvsimWebGLInput'],
  YvsimWebGLInput_RegisterPointerReleaseCallback: function (callback) {
    YvsimWebGLInput.pointerReleaseCallback = callback;
  },

  YvsimWebGLInput_RegisterPointerCancelCallback__deps: ['$YvsimWebGLInput'],
  YvsimWebGLInput_RegisterPointerCancelCallback: function (callback) {
    YvsimWebGLInput.pointerCancelCallback = callback;
  },

  YvsimWebGLInput_RegisterPointerDownCallback__deps: ['$YvsimWebGLInput'],
  YvsimWebGLInput_RegisterPointerDownCallback: function (callback) {
    YvsimWebGLInput.pointerDownCallback = callback;
    YvsimWebGLInput.installCanvasAndFullscreenHandlers();
  },

  YvsimWebGLInput_UnregisterCallbacks__deps: ['$YvsimWebGLInput'],
  YvsimWebGLInput_UnregisterCallbacks: function () {
    YvsimWebGLInput.removeHandlers();
    YvsimWebGLInput.removeTextElements();
    YvsimWebGLInput.pasteCallback = 0;
    YvsimWebGLInput.copyCallback = 0;
    YvsimWebGLInput.textInputCallback = 0;
    YvsimWebGLInput.navigationCallback = 0;
    YvsimWebGLInput.enterKeyCallback = 0;
    YvsimWebGLInput.pointerReleaseCallback = 0;
    YvsimWebGLInput.pointerCancelCallback = 0;
    YvsimWebGLInput.pointerDownCallback = 0;
    YvsimWebGLInput.copyText = '';
    YvsimWebGLInput.copyTextReady = false;
  },

  YvsimWebGLInput_SetCopyText__deps: ['$YvsimWebGLInput'],
  YvsimWebGLInput_SetCopyText: function (utf8Bytes, byteLength) {
    YvsimWebGLInput.copyText = YvsimWebGLInput.readUtf8(utf8Bytes, byteLength);
    YvsimWebGLInput.copyTextReady = true;
  },

  YvsimWebGLInput_BeginTextInput__deps: ['$YvsimWebGLInput'],
  YvsimWebGLInput_BeginTextInput: function (
    utf8Bytes,
    byteLength,
    selectionAnchor,
    selectionFocus,
    lineMode,
    screenX,
    screenY,
    screenWidth,
    screenHeight,
    unityScreenWidth,
    unityScreenHeight
  ) {
    YvsimWebGLInput.beginOrUpdateTextInput(
      utf8Bytes,
      byteLength,
      selectionAnchor,
      selectionFocus,
      lineMode,
      screenX,
      screenY,
      screenWidth,
      screenHeight,
      unityScreenWidth,
      unityScreenHeight,
      true
    );
  },

  YvsimWebGLInput_UpdateTextInput__deps: ['$YvsimWebGLInput'],
  YvsimWebGLInput_UpdateTextInput: function (
    utf8Bytes,
    byteLength,
    selectionAnchor,
    selectionFocus,
    lineMode,
    screenX,
    screenY,
    screenWidth,
    screenHeight,
    unityScreenWidth,
    unityScreenHeight
  ) {
    YvsimWebGLInput.beginOrUpdateTextInput(
      utf8Bytes,
      byteLength,
      selectionAnchor,
      selectionFocus,
      lineMode,
      screenX,
      screenY,
      screenWidth,
      screenHeight,
      unityScreenWidth,
      unityScreenHeight,
      false
    );
  },

  YvsimWebGLInput_EndTextInput__deps: ['$YvsimWebGLInput'],
  YvsimWebGLInput_EndTextInput: function () {
    YvsimWebGLInput.endTextInput();
  },

  YvsimWebGLInput_CompletePointerInteraction__deps: ['$YvsimWebGLInput'],
  YvsimWebGLInput_CompletePointerInteraction: function () {
    YvsimWebGLInput.completeCanvasPointerInteractionFromUnity();
  },

  YvsimWebGLInput_EnsureTextInputFocus__deps: ['$YvsimWebGLInput'],
  YvsimWebGLInput_EnsureTextInputFocus: function () {
    YvsimWebGLInput.maintainFullscreenCanvasStyle();
    YvsimWebGLInput.exitPointerLockForTextInput();
    YvsimWebGLInput.mountTextElements();
    if (document.activeElement !== YvsimWebGLInput.activeTextElement) {
      YvsimWebGLInput.focusActiveTextElement();
    }
  }
};

mergeInto(LibraryManager.library, YvsimWebGLInputLibrary);
