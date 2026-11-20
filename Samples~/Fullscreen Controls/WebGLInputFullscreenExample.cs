using UnityEngine;

namespace Yvsim.WebGLInput.Samples
{
    /// <summary>
    /// Button actions for validating WebGL input before and after fullscreen transitions.
    /// Call these methods directly from a UI Button OnClick event.
    /// </summary>
    public sealed class WebGLInputFullscreenExample : MonoBehaviour
    {
        private int windowedWidth;
        private int windowedHeight;
        private bool hasWindowedResolution;

        public void ToggleFullscreen()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            Screen.fullScreen = !Screen.fullScreen;
#else
            Debug.Log("WebGL fullscreen switching is only available in a WebGL Player build.");
#endif
        }

        public void ToggleFullscreenWithSetResolution()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            bool enterFullscreen = !Screen.fullScreen;
            GetTargetResolution(enterFullscreen, out int width, out int height);
            Screen.SetResolution(width, height, enterFullscreen);
#else
            Debug.Log("WebGL SetResolution fullscreen switching is only available in a WebGL Player build.");
#endif
        }

        public void ToggleFullscreenWithSetResolutionMode()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            bool enterFullscreen = !Screen.fullScreen;
            GetTargetResolution(enterFullscreen, out int width, out int height);
            Screen.SetResolution(
                width,
                height,
                enterFullscreen ? FullScreenMode.FullScreenWindow : FullScreenMode.Windowed);
#else
            Debug.Log("WebGL FullScreenMode switching is only available in a WebGL Player build.");
#endif
        }

        private void GetTargetResolution(bool enterFullscreen, out int width, out int height)
        {
            width = Mathf.Max(Screen.width, 1);
            height = Mathf.Max(Screen.height, 1);
            if (enterFullscreen)
            {
                windowedWidth = width;
                windowedHeight = height;
                hasWindowedResolution = true;
            }
            else if (hasWindowedResolution)
            {
                width = windowedWidth;
                height = windowedHeight;
            }
        }
    }
}
