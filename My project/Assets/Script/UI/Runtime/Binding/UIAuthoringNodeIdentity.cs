#nullable disable

using UnityEngine;

namespace PuerTsTemplate.UI
{
    [DisallowMultipleComponent]
    public sealed class UIAuthoringNodeIdentity : MonoBehaviour
    {
        [HideInInspector] public string artifactKey;
        [HideInInspector] public string nodeId;
    }
}


