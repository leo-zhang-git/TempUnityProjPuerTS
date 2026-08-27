Shader "Hidden/UI/ShapeSoftMask Unsupported"
{
    SubShader
    {
        Tags { "Queue"="Transparent" "IgnoreProjector"="True" "RenderType"="Transparent" }
        Cull Off
        Lighting Off
        ZWrite Off
        ZTest [unity_GUIZTestMode]
        Blend SrcAlpha OneMinusSrcAlpha

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 2.0
            #include "UnityCG.cginc"

            struct appdata { float4 vertex : POSITION; };
            struct v2f { float4 vertex : SV_POSITION; };
            v2f vert(appdata input) { v2f output; output.vertex = UnityObjectToClipPos(input.vertex); return output; }
            fixed4 frag(v2f input) : SV_Target { return 0; }
            ENDCG
        }
    }
}
