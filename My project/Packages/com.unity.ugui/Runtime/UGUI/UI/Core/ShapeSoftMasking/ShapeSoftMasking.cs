using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using UnityEngine.Pool;

namespace UnityEngine.UI
{
    public sealed class ShapeSoftMaskContext : IDisposable
    {
        internal readonly Transform Target;
        internal ShapeSoftMasking.ChainEntry Chain;
        internal int HierarchyVersion = -1;
        internal int ManagerGeneration = -1;
        internal bool Disposed;

        internal ShapeSoftMaskContext(Transform target)
        {
            Target = target;
        }

        public int Count
        {
            get
            {
                Refresh();
                return Chain?.Count ?? 0;
            }
        }

        public void Refresh()
        {
            if (!Disposed) ShapeSoftMasking.Refresh(this);
        }

        public Material GetModifiedMaterial(Material baseMaterial, Component owner = null)
        {
            Refresh();
            return ShapeSoftMasking.GetModifiedMaterial(this, baseMaterial, owner);
        }

        public void Apply(MaterialPropertyBlock properties)
        {
            if (properties == null) throw new ArgumentNullException(nameof(properties));
            Refresh();
            ShapeSoftMasking.Apply(this, properties);
        }

        public void Dispose()
        {
            if (Disposed) return;
            Disposed = true;
            ShapeSoftMasking.Release(this);
        }
    }

    public static class ShapeSoftMasking
    {
        public const string ContractPropertyName = "_ShapeSoftMaskContract";
        public const string ChainOffsetPropertyName = "_ShapeSoftMaskChainOffset";
        public const string ChainCountPropertyName = "_ShapeSoftMaskChainCount";
        public const string ShaderKeywordName = "LETRON_UI_SHAPE_SOFT_MASK";

        private const string RecordsBufferName = "_ShapeSoftMaskRecords";
        private const string ChainBufferName = "_ShapeSoftMaskChain";
        private const string UnsupportedMaterialResource = "ShapeSoftMask-Unsupported";
        private const string UnsupportedShaderName = "Hidden/UI/ShapeSoftMask Unsupported";

        private static readonly int ContractPropertyId = Shader.PropertyToID(ContractPropertyName);
        private static readonly int ChainOffsetPropertyId = Shader.PropertyToID(ChainOffsetPropertyName);
        private static readonly int ChainCountPropertyId = Shader.PropertyToID(ChainCountPropertyName);
        private static readonly int RecordsBufferId = Shader.PropertyToID(RecordsBufferName);
        private static readonly int ChainBufferId = Shader.PropertyToID(ChainBufferName);
        private static readonly Dictionary<ShapeSoftMask, MaskEntry> Masks = new Dictionary<ShapeSoftMask, MaskEntry>();
        private static readonly Dictionary<MaskChainKey, ChainEntry> Chains = new Dictionary<MaskChainKey, ChainEntry>();
        private static readonly List<MaskEntry> MaskSlots = new List<MaskEntry>();
        private static readonly Stack<int> FreeMaskSlots = new Stack<int>();
        private static readonly List<FreeRange> FreeChainRanges = new List<FreeRange>();
        private static readonly HashSet<UnsupportedErrorKey> UnsupportedErrors = new HashSet<UnsupportedErrorKey>();

        private static ShapeSoftMaskGpuRecord[] s_RecordData = new ShapeSoftMaskGpuRecord[4];
        private static int[] s_ChainData = new int[8];
        private static GraphicsBuffer s_RecordBuffer;
        private static GraphicsBuffer s_ChainBuffer;
        private static int s_NextMaskSlot;
        private static int s_ChainLength;
        private static int s_HierarchyVersion;
        private static int s_ManagerGeneration;
        private static bool s_CallbackRegistered;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetRuntimeState()
        {
            ReleaseAllResources();
        }

#if UNITY_EDITOR
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterAssembliesLoaded)]
        private static void ResetEditorState()
        {
            ReleaseAllResources();
        }
#endif

        public static ShapeSoftMaskContext Acquire(Transform target)
        {
            if (target == null) throw new ArgumentNullException(nameof(target));
            var context = new ShapeSoftMaskContext(target);
            Refresh(context, true);
            return context;
        }

        public static int GetActiveDepth(Transform target)
        {
            if (target == null) return 0;
            var count = 0;
            for (var current = target; current != null; current = current.parent)
            {
                var mask = current.GetComponent<ShapeSoftMask>();
                if (mask != null && mask.isActiveAndEnabled) count++;
                var canvas = current.GetComponent<Canvas>();
                if (canvas != null && canvas.overrideSorting) break;
            }
            return count;
        }

        public static void ReleaseAllResources()
        {
            if (s_CallbackRegistered)
            {
                Canvas.preWillRenderCanvases -= UpdateMaskRecords;
                s_CallbackRegistered = false;
            }

            foreach (var chain in Chains.Values) DestroyChainMaterials(chain);
            Chains.Clear();
            Masks.Clear();
            MaskSlots.Clear();
            FreeMaskSlots.Clear();
            FreeChainRanges.Clear();
            UnsupportedErrors.Clear();
            DisposeBuffer(ref s_RecordBuffer);
            DisposeBuffer(ref s_ChainBuffer);
            s_RecordData = new ShapeSoftMaskGpuRecord[4];
            s_ChainData = new int[8];
            s_NextMaskSlot = 0;
            s_ChainLength = 0;
            s_HierarchyVersion++;
            s_ManagerGeneration++;
        }

        internal static void Register(ShapeSoftMask mask)
        {
            if (mask == null) return;
            EnsureCallback();
            var entry = GetOrCreateMaskEntry(mask);
            if (entry.Active) return;
            entry.Active = true;
            WriteMaskRecord(entry, true);
            NotifyHierarchyChanged(mask);
        }

        internal static void Unregister(ShapeSoftMask mask)
        {
            if (mask == null || !Masks.TryGetValue(mask, out var entry) || !entry.Active) return;
            entry.Active = false;
            WriteMaskRecord(entry, false);
            NotifyHierarchyChanged(mask);
        }

        internal static void Destroy(ShapeSoftMask mask)
        {
            if (mask == null) return;
            Unregister(mask);
            if (!Masks.TryGetValue(mask, out var entry)) return;
            Masks.Remove(mask);
            entry.Retired = true;
            if (entry.ChainReferenceCount == 0) RecycleMaskSlot(entry);
        }

        internal static void NotifyMaskChanged(ShapeSoftMask mask)
        {
            if (mask == null || !mask.isActiveAndEnabled) return;
            var entry = GetOrCreateMaskEntry(mask);
            entry.Active = true;
            WriteMaskRecord(entry, true);
        }

        internal static void NotifyHierarchyChanged(ShapeSoftMask mask)
        {
            if (mask == null) return;
            s_HierarchyVersion++;
            if (Masks.TryGetValue(mask, out var entry) && entry.Active) WriteMaskRecord(entry, true);
            InvalidateSubtree(mask.transform);
        }

        internal static void Refresh(ShapeSoftMaskContext context)
        {
            Refresh(context, false);
        }

        internal static void Release(ShapeSoftMaskContext context)
        {
            if (context.Chain != null)
            {
                if (context.ManagerGeneration == s_ManagerGeneration) ReleaseChain(context.Chain);
                context.Chain = null;
            }
        }

        internal static Material GetModifiedMaterial(ShapeSoftMaskContext context, Material baseMaterial, Component owner)
        {
            if (baseMaterial == null || context == null || context.Disposed || context.Chain == null) return baseMaterial;
            EnsureBuffers();

            var key = baseMaterial.GetEntityId();
            var supported = baseMaterial.HasProperty(ContractPropertyId);
            if (context.Chain.Materials.TryGetValue(key, out var cached)
                && cached.BaseMaterial == baseMaterial
                && cached.BaseShader == baseMaterial.shader
                && cached.Material != null)
            {
                if (supported)
                {
                    cached.Material.CopyPropertiesFromMaterial(baseMaterial);
                    ApplyChainProperties(cached.Material, context.Chain);
                }
                return cached.Material;
            }
            if (cached != null)
            {
                DestroyUnityObject(cached.Material);
                context.Chain.Materials.Remove(key);
            }

            Material result;
            if (supported)
            {
                result = new Material(baseMaterial)
                {
                    name = $"{baseMaterial.name} (ShapeSoftMask {context.Chain.Offset}:{context.Chain.Count})",
                    hideFlags = HideFlags.HideAndDontSave,
                };
                ApplyChainProperties(result, context.Chain);
            }
            else
            {
                result = CreateUnsupportedMaterial(baseMaterial);
                LogUnsupported(owner, context.Target, baseMaterial.shader);
            }

            context.Chain.Materials[key] = new MaterialCache(baseMaterial, result);
            return result;
        }

        private static void ApplyChainProperties(Material material, ChainEntry chain)
        {
            material.EnableKeyword(ShaderKeywordName);
            material.SetInt(ChainOffsetPropertyId, chain.Offset);
            material.SetInt(ChainCountPropertyId, chain.Count);
        }

        internal static void Apply(ShapeSoftMaskContext context, MaterialPropertyBlock properties)
        {
            EnsureBuffers();
            var chain = context != null && !context.Disposed ? context.Chain : null;
            properties.SetInt(ChainOffsetPropertyId, chain?.Offset ?? 0);
            properties.SetInt(ChainCountPropertyId, chain?.Count ?? 0);
            properties.SetBuffer(RecordsBufferId, s_RecordBuffer);
            properties.SetBuffer(ChainBufferId, s_ChainBuffer);
        }

        private static void Refresh(ShapeSoftMaskContext context, bool force)
        {
            if (context == null || context.Disposed) return;
            if (context.Target == null)
            {
                Release(context);
                return;
            }
            if (!force && context.ManagerGeneration == s_ManagerGeneration && context.HierarchyVersion == s_HierarchyVersion) return;

            if (context.ManagerGeneration != s_ManagerGeneration) context.Chain = null;

            context.ManagerGeneration = s_ManagerGeneration;
            context.HierarchyVersion = s_HierarchyVersion;
            var masks = ListPool<ShapeSoftMask>.Get();
            try
            {
                CollectMasks(context.Target, masks);
                if (masks.Count == 0)
                {
                    Release(context);
                    return;
                }

                var ids = new EntityId[masks.Count];
                var slots = new int[masks.Count];
                for (var index = 0; index < masks.Count; index++)
                {
                    var mask = masks[index];
                    var entry = GetOrCreateMaskEntry(mask);
                    entry.Active = true;
                    WriteMaskRecord(entry, true);
                    ids[index] = mask.GetEntityId();
                    slots[index] = entry.Slot;
                }

                var lookup = new MaskChainKey(ids);
                if (context.Chain != null && context.Chain.Key.Equals(lookup)) return;

                if (!Chains.TryGetValue(lookup, out var chain))
                {
                    chain = CreateChain(lookup, slots);
                    Chains.Add(lookup, chain);
                }
                chain.ReferenceCount++;
                var previous = context.Chain;
                context.Chain = chain;
                if (previous != null) ReleaseChain(previous);
            }
            finally
            {
                ListPool<ShapeSoftMask>.Release(masks);
            }
        }

        private static void CollectMasks(Transform target, List<ShapeSoftMask> result)
        {
            for (var current = target; current != null; current = current.parent)
            {
                var mask = current.GetComponent<ShapeSoftMask>();
                if (mask != null && mask.isActiveAndEnabled) result.Add(mask);
                var canvas = current.GetComponent<Canvas>();
                if (canvas != null && canvas.overrideSorting) break;
            }
        }

        private static MaskEntry GetOrCreateMaskEntry(ShapeSoftMask mask)
        {
            EnsureCallback();
            if (Masks.TryGetValue(mask, out var entry)) return entry;
            var slot = FreeMaskSlots.Count > 0 ? FreeMaskSlots.Pop() : s_NextMaskSlot++;
            EnsureRecordArray(slot + 1);
            entry = new MaskEntry(mask, slot);
            while (MaskSlots.Count <= slot) MaskSlots.Add(null);
            MaskSlots[slot] = entry;
            Masks.Add(mask, entry);
            return entry;
        }

        private static ChainEntry CreateChain(MaskChainKey key, int[] slots)
        {
            var offset = AllocateChainRange(slots.Length);
            EnsureChainArray(offset + slots.Length);
            Array.Copy(slots, 0, s_ChainData, offset, slots.Length);
            EnsureBuffers();
            s_ChainBuffer.SetData(s_ChainData, offset, offset, slots.Length);
            var chain = new ChainEntry(key, offset, slots);
            for (var index = 0; index < slots.Length; index++) MaskSlots[slots[index]].ChainReferenceCount++;
            return chain;
        }

        private static void ReleaseChain(ChainEntry chain)
        {
            chain.ReferenceCount--;
            if (chain.ReferenceCount > 0) return;
            Chains.Remove(chain.Key);
            DestroyChainMaterials(chain);
            FreeChainRange(chain.Offset, chain.Count);
            for (var index = 0; index < chain.Slots.Length; index++)
            {
                var entry = MaskSlots[chain.Slots[index]];
                if (entry == null) continue;
                entry.ChainReferenceCount--;
                if (entry.Retired && entry.ChainReferenceCount == 0) RecycleMaskSlot(entry);
            }
        }

        private static void RecycleMaskSlot(MaskEntry entry)
        {
            if (entry.Slot >= MaskSlots.Count || MaskSlots[entry.Slot] != entry) return;
            MaskSlots[entry.Slot] = null;
            s_RecordData[entry.Slot] = default;
            FreeMaskSlots.Push(entry.Slot);
        }

        private static int AllocateChainRange(int count)
        {
            for (var index = 0; index < FreeChainRanges.Count; index++)
            {
                var range = FreeChainRanges[index];
                if (range.Count < count) continue;
                var offset = range.Offset;
                if (range.Count == count) FreeChainRanges.RemoveAt(index);
                else FreeChainRanges[index] = new FreeRange(range.Offset + count, range.Count - count);
                return offset;
            }
            var result = s_ChainLength;
            s_ChainLength += count;
            return result;
        }

        private static void FreeChainRange(int offset, int count)
        {
            var insertion = 0;
            while (insertion < FreeChainRanges.Count && FreeChainRanges[insertion].Offset < offset) insertion++;
            FreeChainRanges.Insert(insertion, new FreeRange(offset, count));
            if (insertion > 0) insertion = MergeRanges(insertion - 1);
            MergeRanges(insertion);
        }

        private static int MergeRanges(int index)
        {
            if (index < 0 || index + 1 >= FreeChainRanges.Count) return index;
            var left = FreeChainRanges[index];
            var right = FreeChainRanges[index + 1];
            if (left.Offset + left.Count != right.Offset) return index + 1;
            FreeChainRanges[index] = new FreeRange(left.Offset, left.Count + right.Count);
            FreeChainRanges.RemoveAt(index + 1);
            return index;
        }

        private static void UpdateMaskRecords()
        {
            foreach (var entry in Masks.Values)
            {
                if (entry.Active && entry.Mask != null && entry.Mask.isActiveAndEnabled) WriteMaskRecord(entry, true);
            }
        }

        private static void WriteMaskRecord(MaskEntry entry, bool active)
        {
            var record = active ? BuildRecord(entry.Mask) : default;
            if (s_RecordData[entry.Slot].Equals(record)) return;
            s_RecordData[entry.Slot] = record;
            if (s_RecordBuffer == null || !s_RecordBuffer.IsValid()) return;
            EnsureRecordBuffer(entry.Slot + 1);
            s_RecordBuffer.SetData(s_RecordData, entry.Slot, entry.Slot, 1);
        }

        private static ShapeSoftMaskGpuRecord BuildRecord(ShapeSoftMask mask)
        {
            if (mask == null || !mask.isActiveAndEnabled) return default;
            var rectTransform = mask.RectTransform;
            var canvas = rectTransform.GetComponentInParent<Canvas>();
            if (canvas == null) return default;
            var rootCanvas = canvas.rootCanvas.transform;

            var canvasToMask = rectTransform.worldToLocalMatrix * rootCanvas.localToWorldMatrix;
            var localToCanvas = rootCanvas.worldToLocalMatrix * rectTransform.localToWorldMatrix;
            var a = localToCanvas.m00;
            var b = localToCanvas.m01;
            var c = localToCanvas.m10;
            var d = localToCanvas.m11;
            var determinant = a * d - b * c;
            if (Mathf.Abs(determinant) < 0.000001f) return default;
            var inverseDeterminant = 1f / determinant;
            var rect = rectTransform.rect;

            return new ShapeSoftMaskGpuRecord
            {
                CanvasToMaskX = new Vector4(canvasToMask.m00, canvasToMask.m01, canvasToMask.m02, canvasToMask.m03),
                CanvasToMaskY = new Vector4(canvasToMask.m10, canvasToMask.m11, canvasToMask.m12, canvasToMask.m13),
                Rect = new Vector4(rect.xMin, rect.yMin, rect.xMax, rect.yMax),
                RectSoftness = mask.RectSoftness,
                Parameters = new Vector4(mask.RadialSoftness, Mathf.Min(mask.CornerRadius, Mathf.Min(rect.width, rect.height) * 0.5f), mask.Falloff, (float)mask.Shape),
                DomainInverseTranspose = new Vector4(d * inverseDeterminant, -c * inverseDeterminant, -b * inverseDeterminant, a * inverseDeterminant),
            };
        }

        private static void InvalidateSubtree(Transform root)
        {
            if (root == null) return;
            var pending = ListPool<Transform>.Get();
            try
            {
                pending.Add(root);
                while (pending.Count > 0)
                {
                    var index = pending.Count - 1;
                    var current = pending[index];
                    pending.RemoveAt(index);
                    if (current != root)
                    {
                        var canvas = current.GetComponent<Canvas>();
                        if (canvas != null && canvas.overrideSorting) continue;
                    }
                    var graphic = current.GetComponent<Graphic>();
                    if (graphic != null)
                    {
                        graphic.InvalidateShapeSoftMaskContext();
                        graphic.SetMaterialDirty();
                    }
                    for (var childIndex = 0; childIndex < current.childCount; childIndex++) pending.Add(current.GetChild(childIndex));
                }
            }
            finally
            {
                ListPool<Transform>.Release(pending);
            }
        }

        private static void EnsureCallback()
        {
            if (s_CallbackRegistered) return;
            Canvas.preWillRenderCanvases -= UpdateMaskRecords;
            Canvas.preWillRenderCanvases += UpdateMaskRecords;
            s_CallbackRegistered = true;
        }

        private static void EnsureBuffers()
        {
            EnsureRecordBuffer(Mathf.Max(1, s_NextMaskSlot));
            EnsureChainBuffer(Mathf.Max(1, s_ChainLength));
        }

        private static void EnsureRecordArray(int required)
        {
            if (required <= s_RecordData.Length) return;
            Array.Resize(ref s_RecordData, NextCapacity(s_RecordData.Length, required));
        }

        private static void EnsureChainArray(int required)
        {
            if (required <= s_ChainData.Length) return;
            Array.Resize(ref s_ChainData, NextCapacity(s_ChainData.Length, required));
        }

        private static void EnsureRecordBuffer(int required)
        {
            EnsureRecordArray(required);
            if (s_RecordBuffer != null && s_RecordBuffer.IsValid() && s_RecordBuffer.count >= required) return;
            DisposeBuffer(ref s_RecordBuffer);
            var capacity = NextCapacity(0, required);
            s_RecordBuffer = new GraphicsBuffer(GraphicsBuffer.Target.Structured, capacity, Marshal.SizeOf<ShapeSoftMaskGpuRecord>());
            s_RecordBuffer.name = "ShapeSoftMask Records";
            s_RecordBuffer.SetData(s_RecordData, 0, 0, Mathf.Min(capacity, s_RecordData.Length));
            Shader.SetGlobalBuffer(RecordsBufferId, s_RecordBuffer);
        }

        private static void EnsureChainBuffer(int required)
        {
            EnsureChainArray(required);
            if (s_ChainBuffer != null && s_ChainBuffer.IsValid() && s_ChainBuffer.count >= required) return;
            DisposeBuffer(ref s_ChainBuffer);
            var capacity = NextCapacity(0, required);
            s_ChainBuffer = new GraphicsBuffer(GraphicsBuffer.Target.Structured, capacity, sizeof(int));
            s_ChainBuffer.name = "ShapeSoftMask Chains";
            s_ChainBuffer.SetData(s_ChainData, 0, 0, Mathf.Min(capacity, s_ChainData.Length));
            Shader.SetGlobalBuffer(ChainBufferId, s_ChainBuffer);
        }

        private static int NextCapacity(int current, int required)
        {
            var capacity = Mathf.Max(4, current);
            while (capacity < required) capacity *= 2;
            return capacity;
        }

        private static Material CreateUnsupportedMaterial(Material baseMaterial)
        {
            var template = Resources.Load<Material>(UnsupportedMaterialResource);
            Material material;
            if (template != null) material = new Material(template);
            else
            {
                var shader = Shader.Find(UnsupportedShaderName);
                if (shader == null) return null;
                material = new Material(shader);
            }
            material.name = $"{baseMaterial.name} (ShapeSoftMask Unsupported)";
            material.hideFlags = HideFlags.HideAndDontSave;
            return material;
        }

        private static void LogUnsupported(Component owner, Transform target, Shader shader)
        {
            var ownerId = owner != null ? owner.GetEntityId() : target != null ? target.GetEntityId() : EntityId.None;
            var shaderId = shader != null ? shader.GetEntityId() : EntityId.None;
            var key = new UnsupportedErrorKey(ownerId, shaderId);
            if (!UnsupportedErrors.Add(key)) return;
            Debug.LogError($"ShapeSoftMask hid '{HierarchyPath(target)}' because Shader '{(shader != null ? shader.name : "<missing>")}' does not declare {ContractPropertyName}.", owner);
        }

        private static string HierarchyPath(Transform target)
        {
            if (target == null) return "<destroyed>";
            var names = ListPool<string>.Get();
            try
            {
                for (var current = target; current != null; current = current.parent) names.Add(current.name);
                names.Reverse();
                return string.Join("/", names);
            }
            finally
            {
                ListPool<string>.Release(names);
            }
        }

        private static void DestroyChainMaterials(ChainEntry chain)
        {
            foreach (var cached in chain.Materials.Values) DestroyUnityObject(cached.Material);
            chain.Materials.Clear();
        }

        private static void DestroyUnityObject(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }

        private static void DisposeBuffer(ref GraphicsBuffer buffer)
        {
            if (buffer == null) return;
            buffer.Dispose();
            buffer = null;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ShapeSoftMaskGpuRecord : IEquatable<ShapeSoftMaskGpuRecord>
        {
            public Vector4 CanvasToMaskX;
            public Vector4 CanvasToMaskY;
            public Vector4 Rect;
            public Vector4 RectSoftness;
            public Vector4 Parameters;
            public Vector4 DomainInverseTranspose;

            public bool Equals(ShapeSoftMaskGpuRecord other)
            {
                return CanvasToMaskX == other.CanvasToMaskX
                    && CanvasToMaskY == other.CanvasToMaskY
                    && Rect == other.Rect
                    && RectSoftness == other.RectSoftness
                    && Parameters == other.Parameters
                    && DomainInverseTranspose == other.DomainInverseTranspose;
            }
        }

        private sealed class MaskEntry
        {
            public readonly ShapeSoftMask Mask;
            public readonly int Slot;
            public bool Active;
            public bool Retired;
            public int ChainReferenceCount;

            public MaskEntry(ShapeSoftMask mask, int slot)
            {
                Mask = mask;
                Slot = slot;
            }
        }

        internal sealed class ChainEntry
        {
            public readonly MaskChainKey Key;
            public readonly int Offset;
            public readonly int Count;
            public readonly int[] Slots;
            public readonly Dictionary<EntityId, MaterialCache> Materials = new Dictionary<EntityId, MaterialCache>();
            public int ReferenceCount;

            public ChainEntry(MaskChainKey key, int offset, int[] slots)
            {
                Key = key;
                Offset = offset;
                Count = slots.Length;
                Slots = slots;
            }
        }

        internal sealed class MaskChainKey : IEquatable<MaskChainKey>
        {
            private readonly EntityId[] m_MaskIds;
            private readonly int m_HashCode;

            public MaskChainKey(EntityId[] maskIds)
            {
                m_MaskIds = maskIds;
                unchecked
                {
                    var hash = 17;
                    for (var index = 0; index < maskIds.Length; index++) hash = hash * 31 + maskIds[index].GetHashCode();
                    m_HashCode = hash;
                }
            }

            public bool Equals(MaskChainKey other)
            {
                if (ReferenceEquals(this, other)) return true;
                if (other == null || m_MaskIds.Length != other.m_MaskIds.Length || m_HashCode != other.m_HashCode) return false;
                for (var index = 0; index < m_MaskIds.Length; index++)
                {
                    if (m_MaskIds[index] != other.m_MaskIds[index]) return false;
                }
                return true;
            }

            public override bool Equals(object obj) => Equals(obj as MaskChainKey);
            public override int GetHashCode() => m_HashCode;
        }

        internal sealed class MaterialCache
        {
            public readonly Material BaseMaterial;
            public readonly Shader BaseShader;
            public readonly Material Material;

            public MaterialCache(Material baseMaterial, Material material)
            {
                BaseMaterial = baseMaterial;
                BaseShader = baseMaterial.shader;
                Material = material;
            }
        }

        private readonly struct UnsupportedErrorKey : IEquatable<UnsupportedErrorKey>
        {
            private readonly EntityId m_Owner;
            private readonly EntityId m_Shader;

            public UnsupportedErrorKey(EntityId owner, EntityId shader)
            {
                m_Owner = owner;
                m_Shader = shader;
            }

            public bool Equals(UnsupportedErrorKey other) => m_Owner == other.m_Owner && m_Shader == other.m_Shader;
            public override bool Equals(object obj) => obj is UnsupportedErrorKey other && Equals(other);
            public override int GetHashCode()
            {
                unchecked { return (m_Owner.GetHashCode() * 397) ^ m_Shader.GetHashCode(); }
            }
        }

        private readonly struct FreeRange
        {
            public readonly int Offset;
            public readonly int Count;

            public FreeRange(int offset, int count)
            {
                Offset = offset;
                Count = count;
            }
        }
    }
}
