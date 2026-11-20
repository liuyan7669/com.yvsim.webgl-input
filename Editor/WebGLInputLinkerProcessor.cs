using System.IO;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.PackageManager;
using UnityEditor.UnityLinker;

namespace Yvsim.WebGLInput.Editor
{
    internal sealed class WebGLInputLinkerProcessor : IUnityLinkerProcessor
    {
        public int callbackOrder
        {
            get { return 0; }
        }

        public string GenerateAdditionalLinkXmlFile(
            BuildReport report,
            UnityLinkerBuildPipelineData data)
        {
            PackageInfo packageInfo = PackageInfo.FindForAssembly(
                typeof(WebGLInputLinkerProcessor).Assembly);
            if (packageInfo == null || string.IsNullOrEmpty(packageInfo.resolvedPath))
            {
                return null;
            }

            string linkXmlPath = Path.Combine(packageInfo.resolvedPath, "Runtime", "link.xml");
            return File.Exists(linkXmlPath) ? linkXmlPath : null;
        }

        // Unity 2019.4 的 IUnityLinkerProcessor 还要求实现这两个回调；
        // Unity 2021.2 及更高版本不再要求，但保留普通公有方法不影响新版编译。
        public void OnBeforeRun(BuildReport report, UnityLinkerBuildPipelineData data)
        {
        }

        public void OnAfterRun(BuildReport report, UnityLinkerBuildPipelineData data)
        {
        }
    }
}
