#ifndef LETRON_UI_SHAPE_SOFT_MASK_INCLUDED
#define LETRON_UI_SHAPE_SOFT_MASK_INCLUDED

struct ShapeSoftMaskRecord
{
    float4 canvasToMaskX;
    float4 canvasToMaskY;
    float4 rect;
    float4 rectSoftness;
    float4 parameters;
    float4 domainInverseTranspose;
};

#if defined(LETRON_UI_SHAPE_SOFT_MASK)
StructuredBuffer<ShapeSoftMaskRecord> _ShapeSoftMaskRecords;
StructuredBuffer<int> _ShapeSoftMaskChain;
int _ShapeSoftMaskChainOffset;
int _ShapeSoftMaskChainCount;
#endif

float ShapeSoftMaskCanvasDistance(ShapeSoftMaskRecord record, float localDistance, float2 localNormal)
{
    float2 canvasCovector = float2(
        record.domainInverseTranspose.x * localNormal.x + record.domainInverseTranspose.y * localNormal.y,
        record.domainInverseTranspose.z * localNormal.x + record.domainInverseTranspose.w * localNormal.y);
    return localDistance / max(length(canvasCovector), 1e-6);
}

float ShapeSoftMaskFeather(float distanceInCanvasUnits, float softness, float falloff)
{
    if (distanceInCanvasUnits < 0.0) return 0.0;
    if (softness <= 0.0) return 1.0;
    return pow(saturate(distanceInCanvasUnits / softness), max(falloff, 1e-4));
}

float ShapeSoftMaskRectCoverage(ShapeSoftMaskRecord record, float2 localPosition)
{
    float left = localPosition.x - record.rect.x;
    float right = record.rect.z - localPosition.x;
    float top = record.rect.w - localPosition.y;
    float bottom = localPosition.y - record.rect.y;
    if (min(min(left, right), min(top, bottom)) < 0.0) return 0.0;

    float falloff = record.parameters.z;
    float coverage = ShapeSoftMaskFeather(ShapeSoftMaskCanvasDistance(record, left, float2(-1.0, 0.0)), record.rectSoftness.x, falloff);
    coverage *= ShapeSoftMaskFeather(ShapeSoftMaskCanvasDistance(record, right, float2(1.0, 0.0)), record.rectSoftness.y, falloff);
    coverage *= ShapeSoftMaskFeather(ShapeSoftMaskCanvasDistance(record, top, float2(0.0, 1.0)), record.rectSoftness.z, falloff);
    coverage *= ShapeSoftMaskFeather(ShapeSoftMaskCanvasDistance(record, bottom, float2(0.0, -1.0)), record.rectSoftness.w, falloff);
    return coverage;
}

float ShapeSoftMaskCircleCoverage(ShapeSoftMaskRecord record, float2 localPosition)
{
    float2 center = (record.rect.xy + record.rect.zw) * 0.5;
    float radius = min(record.rect.z - record.rect.x, record.rect.w - record.rect.y) * 0.5;
    float2 delta = localPosition - center;
    float deltaLength = length(delta);
    float localDistance = radius - deltaLength;
    if (localDistance < 0.0) return 0.0;
    float2 normal = deltaLength > 1e-6 ? delta / deltaLength : float2(1.0, 0.0);
    return ShapeSoftMaskFeather(
        ShapeSoftMaskCanvasDistance(record, localDistance, normal),
        record.parameters.x,
        record.parameters.z);
}

float ShapeSoftMaskRoundedRectCoverage(ShapeSoftMaskRecord record, float2 localPosition)
{
    float2 center = (record.rect.xy + record.rect.zw) * 0.5;
    float2 halfSize = (record.rect.zw - record.rect.xy) * 0.5;
    float radius = min(record.parameters.y, min(halfSize.x, halfSize.y));
    float2 centered = localPosition - center;
    float2 q = abs(centered) - (halfSize - radius);
    float2 outside = max(q, 0.0);
    float outsideLength = length(outside);
    float signedDistance = outsideLength + min(max(q.x, q.y), 0.0) - radius;
    if (signedDistance > 0.0) return 0.0;

    float2 signVector = float2(centered.x < 0.0 ? -1.0 : 1.0, centered.y < 0.0 ? -1.0 : 1.0);
    float2 normal;
    if (outsideLength > 1e-6)
        normal = signVector * outside / outsideLength;
    else if (q.x > q.y)
        normal = float2(signVector.x, 0.0);
    else
        normal = float2(0.0, signVector.y);

    float2 weights = abs(normal);
    weights /= max(weights.x + weights.y, 1e-6);
    float horizontalSoftness = normal.x < 0.0 ? record.rectSoftness.x : record.rectSoftness.y;
    float verticalSoftness = normal.y < 0.0 ? record.rectSoftness.w : record.rectSoftness.z;
    float softness = horizontalSoftness * weights.x + verticalSoftness * weights.y;
    return ShapeSoftMaskFeather(
        ShapeSoftMaskCanvasDistance(record, -signedDistance, normal),
        softness,
        record.parameters.z);
}

float ShapeSoftMaskRecordCoverage(ShapeSoftMaskRecord record, float3 canvasPosition)
{
    if (all(record.domainInverseTranspose == 0.0)) return 0.0;
    float4 canvas = float4(canvasPosition, 1.0);
    float2 localPosition = float2(dot(record.canvasToMaskX, canvas), dot(record.canvasToMaskY, canvas));
    int shape = (int)round(record.parameters.w);
    if (shape == 2) return ShapeSoftMaskCircleCoverage(record, localPosition);
    if (shape == 1) return ShapeSoftMaskRoundedRectCoverage(record, localPosition);
    return ShapeSoftMaskRectCoverage(record, localPosition);
}

float EvaluateShapeSoftMask(float3 canvasPosition)
{
#if defined(LETRON_UI_SHAPE_SOFT_MASK)
    float coverage = 1.0;
    [loop]
    for (int index = 0; index < _ShapeSoftMaskChainCount; index++)
    {
        int recordIndex = _ShapeSoftMaskChain[_ShapeSoftMaskChainOffset + index];
        coverage *= ShapeSoftMaskRecordCoverage(_ShapeSoftMaskRecords[recordIndex], canvasPosition);
        if (coverage <= 0.0) break;
    }
    return coverage;
#else
    return 1.0;
#endif
}

#endif
