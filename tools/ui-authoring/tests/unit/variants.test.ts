import assert from "node:assert/strict";
import test from "node:test";
import { formatSource, parseSource } from "../../src/kernel/canonical.js";
import { applyUseSiteOverridesAtCurrentArtifact, useSiteOverridesForChild } from "../../src/kernel/override.js";
import { createUnityProjectionGraph } from "../../src/kernel/projection-graph.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import {
  applyUseSiteComponentAdditionsAtCurrentArtifact,
  useSiteComponentAdditionsForChild,
} from "../../src/kernel/use-site-components.js";
import { validateSource, validateSourceReadiness } from "../../src/kernel/validation.js";
import { createArtifactVariant } from "../../src/kernel/variant.js";
import type { UiComponentAddition, UiConcreteSource, UiVariantSource } from "../../src/schema/ui-source-schema.js";

function rect() {
  return {
    anchorMin: [0.5, 0.5] as [number, number],
    anchorMax: [0.5, 0.5] as [number, number],
    pivot: [0.5, 0.5] as [number, number],
    anchoredPosition: [0, 0] as [number, number],
    sizeDelta: [100, 40] as [number, number],
  };
}

function artifact(artifactKey: string, artifactType: "Canvas" | "Widget" | "Fragment"): UiConcreteSource {
  const root = { id: artifactKey, rect: rect() };
  return artifactType === "Canvas"
    ? {
        sourceKind: "artifact",
        artifactKey,
        artifactType: "Canvas",
        root,
      }
    : {
        sourceKind: "artifact",
        artifactKey,
        artifactType,
        ...(artifactType === "Widget" ? { widgetType: artifactKey } : {}),
        initialSize: [200, 100],
        root,
      };
}

test("allows the nearest Canvas binder to expose Fragment roots and internals", () => {
  const fragment = artifact("BadgeFragment", "Fragment");
  fragment.root.name = "sr_badge";
  fragment.root.components = { StateRoot: { currentState: "visible", states: { visible: {} }, elements: [] } };
  fragment.root.children = [
    {
      id: "img_badge",
      name: "img_badge",
      rect: rect(),
      components: { Image: { color: "#FFFFFFFF" } },
    },
  ];
  const canvas = artifact("ProfileCanvas", "Canvas");
  canvas.bindings = [
    { name: "sr_badge", target: { instancePath: ["badge"], nodeId: "BadgeFragment", componentType: "StateRoot" } },
    { name: "img_badge", target: { instancePath: ["badge"], nodeId: "img_badge", componentType: "Image" } },
  ];
  canvas.root.children = [
    {
      id: "badge",
      rect: rect(),
      components: {
        PrefabRef: { artifactKey: "BadgeFragment" },
      },
    },
  ];

  const catalog = createSourceCatalog([
    { path: "BadgeFragment.ui.json", source: fragment },
    { path: "ProfileCanvas.ui.json", source: canvas },
  ]);
  const projection = createUnityProjectionGraph(catalog, "ProfileCanvas").at(-1)!.projection;
  assert.deepEqual(projection.bindings, [
    {
      fieldName: "sr_badge",
      nodeId: "BadgeFragment",
      componentType: "StateRoot",
      target: { instancePath: ["badge"], nodeId: "BadgeFragment", nodePath: ["badge"], siblingPath: [0] },
      prefabRefNodeId: "badge",
      instancePath: [],
    },
    {
      fieldName: "img_badge",
      nodeId: "img_badge",
      componentType: "Image",
      target: { instancePath: ["badge"], nodeId: "img_badge", nodePath: ["badge", "img_badge"], siblingPath: [0, 0] },
      prefabRefNodeId: "badge",
      instancePath: [],
    },
  ]);
});

test("projects CustomDropDown Content Prefabs from Widget Artifact identity through Variant overrides", () => {
  const content = artifact("CustomDropDownTextContent", "Widget");
  const base = artifact("CustomDropDown", "Widget");
  base.root.components = {
    Image: { color: "#17191DFF" },
    ButtonEx: { targetGraphic: "CustomDropDown" },
    CustomDropDown: {
      currentButton: "CustomDropDown",
      expandArrow: "expandArrow",
      currentContentHost: "currentContentHost",
      optionView: "optionView",
      optionScrollRect: "optionView",
      optionTemplate: "optionTemplate",
    },
  };
  base.root.children = [
    { id: "expandArrow", rect: rect() },
    { id: "currentContentHost", rect: rect() },
    {
      id: "optionView",
      rect: rect(),
      components: { ScrollRect: { content: "content", viewport: "viewport", horizontal: false, vertical: true } },
      children: [
        { id: "viewport", rect: rect() },
        { id: "content", rect: rect() },
        {
          id: "optionTemplate",
          rect: rect(),
          components: {
            Image: {},
            ButtonEx: { targetGraphic: "optionTemplate" },
            CustomDropDownOption: { button: "optionTemplate", contentHost: "contentHost", selectedVisual: "selectedVisual" },
          },
          children: [
            { id: "contentHost", rect: rect() },
            { id: "selectedVisual", rect: rect() },
          ],
        },
      ],
    },
  ];
  const variant: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "CustomDropDownText",
    artifactType: "Widget",
    variantOf: "CustomDropDown",
    overrides: [
      {
        target: { nodeId: "CustomDropDown", componentType: "CustomDropDown", fieldPath: "currentContentPrefab" },
        value: "CustomDropDownTextContent",
      },
      {
        target: { nodeId: "CustomDropDown", componentType: "CustomDropDown", fieldPath: "optionContentPrefab" },
        value: "CustomDropDownTextContent",
      },
    ],
  };
  const catalog = createSourceCatalog([
    { path: "Common/Inputs/CustomDropDown.ui.json", source: base },
    { path: "Common/Inputs/CustomDropDownText.ui.json", source: variant },
    { path: "Common/Inputs/CustomDropDownTextContent.ui.json", source: content },
  ]);
  assert.deepEqual(catalog.entries.get("CustomDropDownText")?.dependencies, ["CustomDropDown", "CustomDropDownTextContent"]);
  const projection = createUnityProjectionGraph(catalog, "CustomDropDownText").at(-1)!.projection;
  const custom = projection.root.components.CustomDropDown as Record<string, unknown>;
  assert.equal(custom.currentContentPrefab, "Assets/Resources/UI/Prefab/Common/Inputs/CustomDropDownTextContent.prefab");
  assert.equal(custom.optionContentPrefab, "Assets/Resources/UI/Prefab/Common/Inputs/CustomDropDownTextContent.prefab");
  assert.equal(projection.localWidgetType, "");
  assert.equal(projection.effectiveWidgetType, "CustomDropDown");
});

test("rejects Fragment bindings, Fragment to Widget dependencies and cross-Binder targets", () => {
  const invalidFragment = artifact("InvalidFragment", "Fragment");
  invalidFragment.bindings = [{ name: "invalidFragment", target: { nodeId: "InvalidFragment", componentType: "GameObject" } }];
  assert.ok(validateSourceReadiness(invalidFragment).issues.some((entry) => entry.code === "fragment_has_binding"));

  const childWidget = artifact("ChildWidget", "Widget");
  const fragment = artifact("ContainerFragment", "Fragment");
  fragment.root.children = [{ id: "child", rect: rect(), components: { PrefabRef: { artifactKey: "ChildWidget" } } }];
  assert.throws(
    () =>
      createSourceCatalog([
        { path: "ChildWidget.ui.json", source: childWidget },
        { path: "ContainerFragment.ui.json", source: fragment },
      ]),
    /is not allowed/,
  );

  const canvas = artifact("ParentCanvas", "Canvas");
  canvas.bindings = [{ name: "childRoot", target: { instancePath: ["child"], nodeId: "ChildWidget", componentType: "GameObject" } }];
  canvas.root.children = [
    {
      id: "child",
      rect: rect(),
      components: {
        PrefabRef: { artifactKey: "ChildWidget" },
      },
    },
  ];
  const invalidCatalog = createSourceCatalog([
    { path: "ChildWidget.ui.json", source: childWidget },
    { path: "ParentCanvas.ui.json", source: canvas },
  ]);
  assert.equal(invalidCatalog.entries.get("ParentCanvas")?.bindings, undefined);
  assert.match(invalidCatalog.entries.get("ParentCanvas")?.bindingIssues[0]?.message ?? "", /crosses Binder/);
});

test("resolves multi-level Artifact Variants and projects only local differences", () => {
  const base = artifact("BaseStatusWidget", "Widget");
  base.root.children = [
    { id: "txt_title", name: "txt_title", rect: rect(), components: { Text: { text: "Base", fontSize: 18 } } },
    { id: "txt_alternate", name: "txt_alternate", rect: rect(), components: { Text: { text: "Alternate", fontSize: 18 } } },
    { id: "titleOverrideTarget", name: "txt_title", rect: rect(), components: { Text: { text: "Override", fontSize: 18 } } },
  ];
  base.bindings = [{ name: "txt_title", target: { nodeId: "txt_title", componentType: "Text" } }];
  const variant: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "LargeStatusWidget",
    artifactType: "Widget",
    variantOf: "BaseStatusWidget",
    widgetType: "LargeStatusWidget",
    overrides: [
      { target: { nodeId: "txt_title", componentType: "Text", fieldPath: "text" }, value: "Large" },
      { target: { nodeId: "txt_title", componentType: "Text", fieldPath: "font" }, value: "Font/Alternate.asset" },
      { target: { nodeId: "txt_title", componentType: "Text", fieldPath: "material" }, value: "normal" },
      { target: { nodeId: "txt_title", componentType: "RectTransform", fieldPath: "scale" }, value: [1.25, 1.25] },
    ],
    bindings: [{ name: "txt_alternate", target: { nodeId: "txt_alternate", componentType: "Text" } }],
  };

  const catalog = createSourceCatalog([
    { path: "BaseStatusWidget.ui.json", source: base },
    { path: "LargeStatusWidget.ui.json", source: variant },
  ]);
  const resolved = catalog.entries.get("LargeStatusWidget")!.resolvedSource;
  assert.equal(resolved.root.children?.[0]?.components?.Text?.text, "Large");
  assert.deepEqual(resolved.root.children?.[0]?.rect.scale, [1.25, 1.25]);
  const projection = createUnityProjectionGraph(catalog, "LargeStatusWidget").at(-1)!.projection;
  assert.equal(projection.sourceKind, "variant");
  assert.equal(projection.basePrefabPath, "Assets/Resources/UI/Prefab/BaseStatusWidget.prefab");
  const formal = createUnityProjectionGraph(catalog, "LargeStatusWidget").at(-1)!.projection;
  assert.equal(formal.prefabPath, "Assets/Resources/UI/Prefab/LargeStatusWidget.prefab");
  assert.equal(formal.basePrefabPath, "Assets/Resources/UI/Prefab/BaseStatusWidget.prefab");
  assert.deepEqual(projection.localBindings, [
    {
      fieldName: "txt_alternate",
      nodeId: "txt_alternate",
      componentType: "Text",
      target: { instancePath: [], nodeId: "txt_alternate", nodePath: ["txt_alternate"], siblingPath: [1] },
    },
  ]);
  assert.deepEqual(
    projection.propertyOverrides.map((entry) => [entry.target, entry.componentType, entry.fieldPath, entry.value]),
    [
      [{ instancePath: [], nodeId: "txt_title", nodePath: ["txt_title"], siblingPath: [0] }, "Text", "text", "Large"],
      [
        { instancePath: [], nodeId: "txt_title", nodePath: ["txt_title"], siblingPath: [0] },
        "Text",
        "font",
        "Assets/Resources/UI/Font/Alternate.asset",
      ],
      [{ instancePath: [], nodeId: "txt_title", nodePath: ["txt_title"], siblingPath: [0] }, "Text", "material", "normal"],
      [{ instancePath: [], nodeId: "txt_title", nodePath: ["txt_title"], siblingPath: [0] }, "RectTransform", "scale", [1.25, 1.25]],
    ],
  );

  const overriding = {
    ...variant,
    artifactKey: "OverridingStatusWidget",
    bindings: [{ name: "txt_title", target: { nodeId: "titleOverrideTarget", componentType: "Text" as const } }],
  };
  const overrideCatalog = createSourceCatalog([
    { path: "BaseStatusWidget.ui.json", source: base },
    { path: "OverridingStatusWidget.ui.json", source: overriding },
  ]);
  assert.equal(overrideCatalog.entries.get(overriding.artifactKey)?.bindings?.[0]?.nodeId, "titleOverrideTarget");
});

test("resolves Variant initialSize from the nearest local declaration", () => {
  const base = artifact("BaseSizeWidget", "Widget");
  const parent: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "ParentSizeWidget",
    artifactType: "Widget",
    variantOf: base.artifactKey,
    initialSize: [320, 180],
    overrides: [],
  };
  const inheritedChild: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "InheritedChildSizeWidget",
    artifactType: "Widget",
    variantOf: parent.artifactKey,
    overrides: [],
  };
  const overriddenChild: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "OverriddenChildSizeWidget",
    artifactType: "Widget",
    variantOf: parent.artifactKey,
    initialSize: [480, 270],
    overrides: [],
  };
  const catalog = createSourceCatalog([
    { path: "BaseSizeWidget.ui.json", source: base },
    { path: "ParentSizeWidget.ui.json", source: parent },
    { path: "InheritedChildSizeWidget.ui.json", source: inheritedChild },
    { path: "OverriddenChildSizeWidget.ui.json", source: overriddenChild },
  ]);

  assert.deepEqual(catalog.entries.get(parent.artifactKey)?.resolvedSource.initialSize, [320, 180]);
  assert.deepEqual(catalog.entries.get(inheritedChild.artifactKey)?.resolvedSource.initialSize, [320, 180]);
  assert.deepEqual(catalog.entries.get(overriddenChild.artifactKey)?.resolvedSource.initialSize, [480, 270]);
  assert.deepEqual(createUnityProjectionGraph(catalog, inheritedChild.artifactKey).at(-1)?.projection.designSize, [320, 180]);
  assert.deepEqual(createUnityProjectionGraph(catalog, overriddenChild.artifactKey).at(-1)?.projection.designSize, [480, 270]);
});

test("separates inherited, redundant, and newly declared Widget Variant identities", () => {
  const base = artifact("BaseIdentityWidget", "Widget");
  base.root.children = [{ id: "label", name: "txt_label", rect: rect(), components: { Text: { text: "Base", fontSize: 18 } } }];
  const inherited: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "InheritedIdentityWidget",
    artifactType: "Widget",
    variantOf: base.artifactKey,
    overrides: [],
  };
  const redundant: UiVariantSource = {
    ...inherited,
    artifactKey: "RedundantIdentityWidget",
    widgetType: "BaseIdentityWidget",
  };
  const declared: UiVariantSource = {
    ...inherited,
    artifactKey: "DeclaredIdentityWidget",
    widgetType: "DeclaredIdentityWidget",
    bindings: [{ name: "txt_label", target: { nodeId: "label", componentType: "Text" } }],
  };
  const catalog = createSourceCatalog([
    { path: "BaseIdentityWidget.ui.json", source: base },
    { path: "InheritedIdentityWidget.ui.json", source: inherited },
    { path: "RedundantIdentityWidget.ui.json", source: redundant },
    { path: "DeclaredIdentityWidget.ui.json", source: declared },
  ]);

  assert.deepEqual(
    [inherited.artifactKey, redundant.artifactKey, declared.artifactKey].map((artifactKey) => {
      const entry = catalog.entries.get(artifactKey)!;
      return [entry.localWidgetType, entry.effectiveWidgetType];
    }),
    [
      ["", "BaseIdentityWidget"],
      ["", "BaseIdentityWidget"],
      ["DeclaredIdentityWidget", "DeclaredIdentityWidget"],
    ],
  );
  const inheritedProjection = createUnityProjectionGraph(catalog, inherited.artifactKey).at(-1)!.projection;
  const declaredProjection = createUnityProjectionGraph(catalog, declared.artifactKey).at(-1)!.projection;
  assert.deepEqual([inheritedProjection.localWidgetType, inheritedProjection.effectiveWidgetType], ["", "BaseIdentityWidget"]);
  assert.deepEqual(
    [declaredProjection.localWidgetType, declaredProjection.effectiveWidgetType],
    ["DeclaredIdentityWidget", "DeclaredIdentityWidget"],
  );

  const illegalAddition: UiVariantSource = {
    ...inherited,
    artifactKey: "IllegalIdentityWidget",
    bindings: [{ name: "txt_label", target: { nodeId: "label", componentType: "Text" } }],
  };
  const illegalCatalog = createSourceCatalog([
    { path: "BaseIdentityWidget.ui.json", source: base },
    { path: "IllegalIdentityWidget.ui.json", source: illegalAddition },
  ]);
  assert.match(illegalCatalog.entries.get(illegalAddition.artifactKey)?.widgetTypeError ?? "", /must declare a new widgetType/);
  assert.equal(illegalCatalog.entries.get(illegalAddition.artifactKey)?.bindings, undefined);
});

test("keeps the first Binding declaration contract across assignable Variant overrides", () => {
  const base = artifact("BaseScrollWidget", "Widget");
  base.root.children = [
    { id: "content", rect: rect() },
    { id: "viewport", rect: rect() },
    { id: "plainScroll", name: "sv_scroll", rect: rect(), components: { ScrollRect: { content: "content", viewport: "viewport" } } },
    { id: "extendedScroll", name: "sv_scroll", rect: rect(), components: { ScrollRectEx: { content: "content", viewport: "viewport", templates: {} } } },
    { id: "label", name: "txt_label", rect: rect(), components: { Text: { text: "Label", fontSize: 18 } } },
  ];
  base.bindings = [{ name: "sv_scroll", target: { nodeId: "plainScroll", componentType: "ScrollRect" } }];
  const assignable: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "ExtendedScrollWidget",
    artifactType: "Widget",
    variantOf: base.artifactKey,
    overrides: [],
    bindings: [{ name: "sv_scroll", target: { nodeId: "extendedScroll", componentType: "ScrollRectEx" } }],
  };
  const catalog = createSourceCatalog([
    { path: "BaseScrollWidget.ui.json", source: base },
    { path: "ExtendedScrollWidget.ui.json", source: assignable },
  ]);
  const binding = catalog.entries.get(assignable.artifactKey)?.bindings?.find((entry) => entry.fieldName === "sv_scroll");
  assert.ok(binding);
  assert.equal(binding.componentType, "ScrollRectEx");
  assert.equal(binding.declaredComponentType, "ScrollRect");

  const incompatible: UiVariantSource = {
    ...assignable,
    artifactKey: "IncompatibleScrollWidget",
    bindings: [{ name: "sv_scroll", target: { nodeId: "label", componentType: "Text" } }],
  };
  const incompatibleCatalog = createSourceCatalog([
    { path: "BaseScrollWidget.ui.json", source: base },
    { path: "IncompatibleScrollWidget.ui.json", source: incompatible },
  ]);
  assert.equal(incompatibleCatalog.entries.get(incompatible.artifactKey)?.bindings, undefined);
  assert.match(
    incompatibleCatalog.entries.get(incompatible.artifactKey)?.bindingIssues[0]?.message ?? "",
    /is not assignable to declared contract 'ScrollRect'/,
  );
});

test("resolves and projects Variant-local node and component additions without flattening the base tree", () => {
  const base = artifact("BaseLocalWidget", "Widget");
  base.root.children = [{ id: "title", rect: rect(), components: { Text: { text: "Base", fontSize: 18 } } }];
  const parent: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "ParentLocalWidget",
    artifactType: "Widget",
    variantOf: base.artifactKey,
    widgetType: "ParentLocalWidget",
    nodeAdditions: [
      {
        parentId: base.artifactKey,
        siblingIndex: 1,
        node: { id: "localSecond", name: "txt_local_label", rect: rect(), components: { Text: { text: "Second", fontSize: 14 } } },
      },
      {
        parentId: base.artifactKey,
        siblingIndex: 0,
        node: { id: "localFirst", rect: rect(), components: { Image: { sprite: "Icons/First.png" } } },
      },
    ],
    componentAdditions: [{ target: { nodeId: "title" }, componentType: "LayoutElement", value: { preferredWidth: 120 } }],
    overrides: [],
    bindings: [{ name: "txt_local_label", target: { nodeId: "localSecond", componentType: "Text" } }],
  };
  const child: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "ChildLocalWidget",
    artifactType: "Widget",
    variantOf: parent.artifactKey,
    overrides: [{ target: { nodeId: "localSecond", componentType: "Text", fieldPath: "text" }, value: "Child" }],
  };
  const catalog = createSourceCatalog([
    { path: "BaseLocalWidget.ui.json", source: base },
    { path: "ParentLocalWidget.ui.json", source: parent },
    { path: "ChildLocalWidget.ui.json", source: child },
  ]);

  const resolvedParent = catalog.entries.get(parent.artifactKey)!.resolvedSource;
  assert.deepEqual(
    resolvedParent.root.children?.map((node) => node.id),
    ["title", "localFirst", "localSecond"],
  );
  assert.equal(resolvedParent.root.children?.[0]?.components?.LayoutElement?.preferredWidth, 120);
  assert.equal(catalog.entries.get(child.artifactKey)!.resolvedSource.root.children?.[2]?.components?.Text?.text, "Child");

  const parentProjection = createUnityProjectionGraph(catalog, parent.artifactKey).at(-1)!.projection;
  assert.deepEqual(
    parentProjection.localNodeAdditions.map((addition) => [addition.parentId, addition.siblingIndex, addition.node.id]),
    [
      [base.artifactKey, 1, "localSecond"],
      [base.artifactKey, 0, "localFirst"],
    ],
  );
  assert.equal(
    parentProjection.localNodeAdditions[1]?.node.components.Image &&
      (parentProjection.localNodeAdditions[1]!.node.components.Image as { sprite: string }).sprite,
    "Assets/Resources/UI/Icons/First.png",
  );
  assert.deepEqual(parentProjection.localComponentAdditions, [
    {
      nodeId: "title",
      componentType: "LayoutElement",
      target: { instancePath: [], nodeId: "title", nodePath: ["title"], siblingPath: [0] },
      value: { ignoreLayout: false, preferredWidth: 120, layoutPriority: 1 },
    },
  ]);
  const childProjection = createUnityProjectionGraph(catalog, child.artifactKey).at(-1)!.projection;
  assert.deepEqual(childProjection.localNodeAdditions, []);
  assert.deepEqual(childProjection.localComponentAdditions, []);
  assert.deepEqual(
    childProjection.propertyOverrides.map((override) => override.target),
    [{ instancePath: [], nodeId: "localSecond", nodePath: ["localSecond"], siblingPath: [2] }],
  );

  const formatted = formatSource(parent);
  assert.equal(formatSource(parseSource(formatted)), formatted);
  assert.equal("root" in parseSource(formatted), false);
});

test("rejects Variant-local structure collisions and non-inherited component targets", () => {
  const base = artifact("BaseInvalidLocalWidget", "Widget");
  base.root.children = [{ id: "title", rect: rect(), components: { Text: { text: "Base", fontSize: 18 } } }];
  const variant: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "InvalidLocalWidget",
    artifactType: "Widget",
    variantOf: base.artifactKey,
    nodeAdditions: [{ parentId: base.artifactKey, siblingIndex: 0, node: { id: "title", rect: rect() } }],
    overrides: [],
  };
  assert.throws(
    () =>
      createSourceCatalog([
        { path: "BaseInvalidLocalWidget.ui.json", source: base },
        { path: "InvalidLocalWidget.ui.json", source: variant },
      ]),
    /conflicts with an inherited or local node/,
  );

  variant.nodeAdditions = [{ parentId: base.artifactKey, siblingIndex: 0, node: { id: "local", rect: rect() } }];
  variant.componentAdditions = [{ target: { nodeId: "local" }, componentType: "LayoutElement", value: { preferredWidth: 80 } }];
  assert.throws(
    () =>
      createSourceCatalog([
        { path: "BaseInvalidLocalWidget.ui.json", source: base },
        { path: "InvalidLocalWidget.ui.json", source: variant },
      ]),
    /not inherited from the base Artifact/,
  );
});

test("resolves coupled Slider overrides from the final Variant state", () => {
  const base = artifact("BaseSliderWidget", "Widget");
  base.root.children = [
    {
      id: "slider",
      rect: rect(),
      components: { Slider: { targetGraphic: "", fillRect: "", handleRect: "", minValue: 0, maxValue: 1, value: 0 } },
    },
  ];
  const variant: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "ConfiguredSliderWidget",
    artifactType: "Widget",
    variantOf: base.artifactKey,
    overrides: [
      { target: { nodeId: "slider", componentType: "Slider", fieldPath: "minValue" }, value: 5 },
      { target: { nodeId: "slider", componentType: "Slider", fieldPath: "maxValue" }, value: 10 },
      { target: { nodeId: "slider", componentType: "Slider", fieldPath: "value" }, value: 5 },
    ],
  };

  const catalog = createSourceCatalog([
    { path: "BaseSliderWidget.ui.json", source: base },
    { path: "ConfiguredSliderWidget.ui.json", source: variant },
  ]);

  assert.deepEqual(catalog.entries.get(variant.artifactKey)?.resolvedSource.root.children?.[0]?.components?.Slider, {
    targetGraphic: "",
    fillRect: "",
    handleRect: "",
    minValue: 5,
    maxValue: 10,
    value: 5,
  });
});

test("keeps Variant binding additions distinct from inherited binding overrides", () => {
  const base = artifact("BaseBindingWidget", "Widget");
  base.root.children = [
    { id: "txt_title", name: "txt_title", rect: rect(), components: { Text: { text: "Title", fontSize: 18 } } },
    { id: "txt_alternate", name: "txt_alternate", rect: rect(), components: { Text: { text: "Alternate", fontSize: 18 } } },
    {
      id: "alternateOverrideTarget",
      name: "txt_alternate",
      rect: rect(),
      components: { Text: { text: "Alternate Target", fontSize: 18 } },
    },
  ];
  base.bindings = [{ name: "txt_title", target: { nodeId: "txt_title", componentType: "Text" } }];
  const parent: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "ParentBindingWidget",
    artifactType: "Widget",
    variantOf: base.artifactKey,
    widgetType: "ParentBindingWidget",
    overrides: [],
    bindings: [{ name: "txt_alternate", target: { nodeId: "txt_alternate", componentType: "Text" } }],
  };
  const child: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "ChildBindingWidget",
    artifactType: "Widget",
    variantOf: parent.artifactKey,
    overrides: [],
    bindings: [{ name: "txt_alternate", target: { nodeId: "alternateOverrideTarget", componentType: "Text" } }],
  };

  const catalog = createSourceCatalog([
    { path: "BaseBindingWidget.ui.json", source: base },
    { path: "ParentBindingWidget.ui.json", source: parent },
    { path: "ChildBindingWidget.ui.json", source: child },
  ]);
  const parentProjection = createUnityProjectionGraph(catalog, parent.artifactKey).at(-1)!.projection;
  assert.deepEqual(
    parentProjection.localBindings.map((binding) => binding.fieldName),
    ["txt_alternate"],
  );
  assert.deepEqual(
    parentProjection.bindings.map((binding) => binding.fieldName),
    ["txt_title", "txt_alternate"],
  );
  const childProjection = createUnityProjectionGraph(catalog, child.artifactKey).at(-1)!.projection;
  assert.deepEqual(
    childProjection.localBindings.map((binding) => [binding.fieldName, binding.nodeId]),
    [["txt_alternate", "alternateOverrideTarget"]],
  );
  assert.deepEqual(
    childProjection.bindings.map((binding) => binding.fieldName),
    ["txt_title", "txt_alternate"],
  );
});

test("keeps duplicate local declarations invalid and rejects Fragment bindings at readiness", () => {
  const base = artifact("BaseCollisionWidget", "Widget");
  base.root.children = [{ id: "txt_title", name: "txt_title", rect: rect(), components: { Text: { text: "Title", fontSize: 18 } } }];
  base.bindings = [{ name: "txt_title", target: { nodeId: "txt_title", componentType: "Text" } }];
  const duplicate: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "DuplicateBindingWidget",
    artifactType: "Widget",
    variantOf: base.artifactKey,
    widgetType: "DuplicateBindingWidget",
    overrides: [],
    bindings: [
      { name: "txt_title", target: { nodeId: "txt_title", componentType: "Text" } },
      { name: "txt_title", target: { nodeId: "txt_title", componentType: "Text" } },
    ],
  };
  const duplicateCatalog = createSourceCatalog([
    { path: "BaseCollisionWidget.ui.json", source: base },
    { path: "DuplicateBindingWidget.ui.json", source: duplicate },
  ]);
  assert.equal(duplicateCatalog.entries.get(duplicate.artifactKey)?.bindings, undefined);
  assert.equal(duplicateCatalog.entries.get(duplicate.artifactKey)?.bindingIssues[0]?.declarationIndex, 1);

  const fragmentVariant = { ...duplicate, artifactKey: "FragmentVariant", artifactType: "Fragment" as const };
  assert.ok(
    validateSourceReadiness(fragmentVariant).issues.some((entry) => entry.path === "/bindings" && entry.code === "fragment_has_binding"),
  );
});

test("uses the same property target contract for PrefabRef use-site overrides", () => {
  const fragment = artifact("IconFragment", "Fragment");
  fragment.root.children = [{ id: "icon", rect: rect(), components: { Image: { color: "#FFFFFFFF" } } }];
  const canvas = artifact("IconCanvas", "Canvas");
  canvas.root.children = [
    {
      id: "iconUse",
      rect: rect(),
      components: {
        PrefabRef: {
          artifactKey: "IconFragment",
          overrides: [
            { target: { nodeId: "icon", componentType: "Image", fieldPath: "color" }, value: "#00FF00FF" },
            { target: { nodeId: "icon", componentType: "Image", fieldPath: "sprite" }, value: "Prefab/Widget/Icon.png" },
          ],
        },
      },
    },
  ];
  const catalog = createSourceCatalog([
    { path: "IconFragment.ui.json", source: fragment },
    { path: "IconCanvas.ui.json", source: canvas },
  ]);
  const projection = createUnityProjectionGraph(catalog, "IconCanvas").at(-1)!.projection;
  const prefabRef = projection.root.children[0]!.components.PrefabRef as { overrides: unknown[] };
  assert.deepEqual(prefabRef.overrides, [
    {
      nodeId: "icon",
      componentType: "Image",
      fieldPath: "color",
      target: { instancePath: [], nodeId: "icon", nodePath: ["icon"], siblingPath: [0] },
      value: "#00FF00FF",
    },
    {
      nodeId: "icon",
      componentType: "Image",
      fieldPath: "sprite",
      target: { instancePath: [], nodeId: "icon", nodePath: ["icon"], siblingPath: [0] },
      value: "Assets/Resources/UI/Prefab/Widget/Icon.png",
    },
  ]);

  canvas.root.children[0]!.components!.PrefabRef!.overrides = [
    { target: { nodeId: "icon", componentType: "Image", fieldPath: "binding" }, value: true },
  ];
  assert.throws(
    () =>
      createSourceCatalog([
        { path: "IconFragment.ui.json", source: fragment },
        { path: "IconCanvas.ui.json", source: canvas },
      ]),
    /is not supported/,
  );
});

test("creates a typed Artifact Variant identity without copying the base tree", () => {
  const base = artifact("BaseCardWidget", "Widget");
  const variant = createArtifactVariant(base, {
    artifactKey: "LargeCardWidget",
  });
  assert.equal(variant.variantOf, "BaseCardWidget");
  assert.equal("widgetType" in variant, false);
  assert.deepEqual(variant.overrides, []);
  assert.equal("root" in variant, false);
});

test("localizes nested use-site overrides for recursive Web previews", () => {
  const fragment = artifact("IconFragment", "Fragment");
  fragment.root.children = [{ id: "icon", rect: rect(), components: { Image: { color: "#FFFFFFFF" } } }];
  const overrides = [
    { target: { nodeId: "icon", componentType: "Image" as const, fieldPath: "color" }, value: "#00FF00FF" },
    { target: { instancePath: ["nested"], nodeId: "icon", componentType: "Image" as const, fieldPath: "color" }, value: "#FF0000FF" },
  ];
  const local = applyUseSiteOverridesAtCurrentArtifact(fragment, overrides);
  assert.equal(local.root.children?.[0]?.components?.Image?.color, "#00FF00FF");
  assert.deepEqual(useSiteOverridesForChild(overrides, "nested"), [
    {
      target: { instancePath: [], nodeId: "icon", componentType: "Image", fieldPath: "color" },
      value: "#FF0000FF",
    },
  ]);
});

test("projects and localizes PrefabRef component additions", () => {
  const badge = artifact("BadgeFragment", "Fragment");
  badge.root.children = [{ id: "badgeLabel", rect: rect(), components: { Text: { text: "Badge", fontSize: 16 } } }];
  const card = artifact("CardFragment", "Fragment");
  card.root.children = [
    { id: "artwork", rect: rect(), components: { Image: { sprite: "Cards/Default.png" } } },
    { id: "badgeFragment", rect: rect(), components: { PrefabRef: { artifactKey: "BadgeFragment" } } },
  ];
  const canvas = artifact("CardCanvas", "Canvas");
  const additions: UiComponentAddition[] = [
    { target: { nodeId: "artwork" }, componentType: "AspectRatioFitter", value: { aspectMode: "fitInParent", aspectRatio: 1.5 } },
    { target: { instancePath: ["badgeFragment"], nodeId: "badgeLabel" }, componentType: "LayoutElement", value: { preferredWidth: 108 } },
  ];
  canvas.root.children = [
    {
      id: "card",
      rect: rect(),
      components: { PrefabRef: { artifactKey: "CardFragment", componentAdditions: additions } },
      children: [{ id: "localCaption", rect: rect(), components: { Text: { text: "Local", font: "Font/Main.asset", fontSize: 14 } } }],
    },
  ];

  const catalog = createSourceCatalog([
    { path: "BadgeFragment.ui.json", source: badge },
    { path: "CardFragment.ui.json", source: card },
    { path: "CardCanvas.ui.json", source: canvas },
  ]);
  const projection = createUnityProjectionGraph(catalog, "CardCanvas").at(-1)!.projection;
  const projectedCard = projection.root.children[0]!;
  assert.equal(projectedCard.children[0]?.id, "localCaption");
  assert.equal((projectedCard.children[0]!.components.Text as { font?: string }).font, "Assets/Resources/UI/Font/Main.asset");
  const prefabRef = projectedCard.components.PrefabRef as { componentAdditions: unknown[] };
  assert.deepEqual(prefabRef.componentAdditions, [
    {
      nodeId: "artwork",
      componentType: "AspectRatioFitter",
      target: { instancePath: [], nodeId: "artwork", nodePath: ["artwork"], siblingPath: [0] },
      value: { aspectMode: "fitInParent", aspectRatio: 1.5 },
    },
    {
      nodeId: "badgeLabel",
      componentType: "LayoutElement",
      target: { instancePath: ["badgeFragment"], nodeId: "badgeLabel", nodePath: ["badgeFragment", "badgeLabel"], siblingPath: [1, 0] },
      value: { preferredWidth: 108, ignoreLayout: false, layoutPriority: 1 },
    },
  ]);

  const local = applyUseSiteComponentAdditionsAtCurrentArtifact(card, additions);
  assert.deepEqual(local.root.children?.[0]?.components?.AspectRatioFitter, { aspectMode: "fitInParent", aspectRatio: 1.5 });
  assert.deepEqual(useSiteComponentAdditionsForChild(additions, "badgeFragment"), [
    {
      target: { instancePath: [], nodeId: "badgeLabel" },
      componentType: "LayoutElement",
      value: { preferredWidth: 108 },
    },
  ]);
});

test("rejects duplicate and pre-existing PrefabRef component additions", () => {
  const fragment = artifact("LayoutFragment", "Fragment");
  fragment.root.children = [{ id: "content", rect: rect(), components: { LayoutElement: { preferredWidth: 80 } } }];
  const canvas = artifact("LayoutCanvas", "Canvas");
  canvas.root.children = [
    {
      id: "layout",
      rect: rect(),
      components: {
        PrefabRef: {
          artifactKey: "LayoutFragment",
          componentAdditions: [
            { target: { nodeId: "content" }, componentType: "AspectRatioFitter", value: { aspectMode: "fitInParent", aspectRatio: 2 } },
            { target: { nodeId: "content" }, componentType: "AspectRatioFitter", value: { aspectMode: "fitInParent", aspectRatio: 1 } },
          ],
        },
      },
    },
  ];
  assert.ok(validateSource(canvas).issues.some((entry) => entry.code === "prefabRef.componentAdditionDuplicate"));

  canvas.root.children![0]!.components!.PrefabRef!.componentAdditions = [
    { target: { nodeId: "content" }, componentType: "LayoutElement", value: { preferredWidth: 108 } },
  ];
  assert.throws(
    () =>
      createSourceCatalog([
        { path: "LayoutFragment.ui.json", source: fragment },
        { path: "LayoutCanvas.ui.json", source: canvas },
      ]),
    /already has LayoutElement/,
  );
});
