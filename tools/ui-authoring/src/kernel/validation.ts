import { Ajv, type ErrorObject } from "ajv";
import type { ComponentValidationHook, ComponentValidationNode } from "../components/component-module.js";
import { type ComponentDefinition, componentInspectorFields, componentRegistry, isUseSiteAddable } from "../registry/component-registry.js";
import type { UiVariantNodeAddition } from "../schema/ui-source-schema.js";
import { type UiComponentType, type UiConcreteSource, type UiNode, type UiSource, UiSourceSchema } from "../schema/ui-source-schema.js";
import { isChildNodeId, nodeIdKey } from "./naming.js";
import { schemaValidationIssue } from "./schema-validation.js";
import { walkNodes } from "./tree.js";
import type { ValidationIssue, ValidationResult } from "./validation-contract.js";

export type { ValidationIssue, ValidationResult } from "./validation-contract.js";

const ajv = new Ajv({ allErrors: true, strict: false });
const validateShape = ajv.compile(UiSourceSchema);
const DYNAMIC_SCROLL_CONTENT_LAYOUT_COMPONENT_TYPES: readonly UiComponentType[] = [
  "HorizontalLayoutGroup",
  "VerticalLayoutGroup",
  "GridLayoutGroup",
  "AutoLayoutGroup",
  "ContentSizeFitter",
];

type ValidationIssueTarget = Pick<ValidationIssue, "nodeId" | "componentType" | "fieldPath" | "readiness">;

function issue(path: string, code: string, message: string, target: ValidationIssueTarget = {}): ValidationIssue {
  return { path, code, message, ...target };
}

function sourceShapeErrors(value: unknown, errors: readonly ErrorObject[]): readonly ErrorObject[] {
  if (!value || typeof value !== "object") return errors;
  const sourceKind = (value as { readonly sourceKind?: unknown }).sourceKind;
  const branch = sourceKind === "artifact" ? 0 : sourceKind === "variant" ? 1 : undefined;
  if (branch === undefined) return errors;
  return errors.filter((error) => error.schemaPath.startsWith(`#/anyOf/${branch}/`) || !error.schemaPath.startsWith("#/anyOf/"));
}

export function validateSource(value: unknown): ValidationResult {
  return validateSourceInternal(value, false);
}

export function validateSourceReadiness(value: unknown): ValidationResult {
  return validateSourceInternal(value, true);
}

function validateSourceInternal(value: unknown, requireReadiness: boolean): ValidationResult {
  const shapeValid = validateShape(value);
  const issues: ValidationIssue[] = shapeValid ? [] : sourceShapeErrors(value, validateShape.errors ?? []).map(schemaValidationIssue);
  if (!shapeValid) return { valid: false, issues };

  const source = value as UiSource;
  if (source.artifactType === "Canvas" && !source.artifactKey.endsWith("Canvas")) {
    issues.push(
      issue("/artifactKey", "canvas.artifactKey", "Canvas artifactKey must end with 'Canvas'", { readiness: true }),
    );
  }
  if (source.sourceKind === "artifact") {
    const hasInitialSize = Object.hasOwn(source, "initialSize");
    if (source.artifactType === "Canvas" && hasInitialSize) {
      issues.push(
        issue("/initialSize", "canvas.initialSize", "Canvas source uses the global 1280x720 design size and must not persist initialSize"),
      );
    }
    if (source.artifactType !== "Canvas" && !hasInitialSize) {
      issues.push(issue("/initialSize", "artifact.initialSize", "Widget and Fragment sources must persist initialSize"));
    }
    if (source.artifactType === "Widget" && !source.widgetType) {
      issues.push(issue("/widgetType", "widget.widgetType", "Widget source must declare a local widgetType"));
    }
    if (source.artifactType !== "Widget" && source.widgetType !== undefined) {
      issues.push(issue("/widgetType", "artifact.widgetType", "Only Widget sources can declare widgetType"));
    }
  }

  if (source.sourceKind === "variant") {
    if (source.artifactType === "Canvas" && Object.hasOwn(source, "initialSize")) {
      issues.push(
        issue("/initialSize", "canvas.initialSize", "Canvas Variant uses the global 1280x720 design size and must not persist initialSize"),
      );
    }
    if (source.artifactType !== "Widget" && source.widgetType !== undefined) {
      issues.push(issue("/widgetType", "artifact.widgetType", "Only Widget Variants can declare widgetType"));
    }
    if (source.variantOf === source.artifactKey) {
      issues.push(issue("/variantOf", "variant.self", "Variant cannot use itself as its base Artifact"));
    }
    const overrideTargets = new Set<string>();
    for (let index = 0; index < source.overrides.length; index += 1) {
      const target = source.overrides[index]!.target;
      const key = `${(target.instancePath ?? []).join("/")}\0${target.nodeId}\0${target.componentType}\0${target.fieldPath}`;
      if (overrideTargets.has(key))
        issues.push(issue(`/overrides/${index}/target`, "variant.overrideDuplicate", "Variant property override target is duplicated"));
      overrideTargets.add(key);
    }
    const additionIds = new Set<string>();
    const siblingKeys = new Set<string>();
    for (let index = 0; index < (source.nodeAdditions?.length ?? 0); index += 1) {
      const addition = source.nodeAdditions![index]!;
      const siblingKey = `${addition.parentId}\0${addition.siblingIndex}`;
      if (siblingKeys.has(siblingKey))
        issues.push(
          issue(
            `/nodeAdditions/${index}/siblingIndex`,
            "variant.nodeAdditionOrderDuplicate",
            `Variant node additions under '${addition.parentId}' cannot share siblingIndex ${addition.siblingIndex}`,
          ),
        );
      siblingKeys.add(siblingKey);
      for (const node of variantAdditionNodes(addition)) {
        const idKey = nodeIdKey(node.id);
        if (additionIds.has(idKey))
          issues.push(
            issue(
              `/nodeAdditions/${index}/node`,
              "variant.nodeAdditionIdDuplicate",
              `Variant node addition id '${node.id}' is duplicated case-insensitively`,
            ),
          );
        additionIds.add(idKey);
      }
    }
    const componentAdditionKeys = new Set<string>();
    for (let index = 0; index < (source.componentAdditions?.length ?? 0); index += 1) {
      const addition = source.componentAdditions![index]!;
      if ((addition.target.instancePath?.length ?? 0) > 0)
        issues.push(
          issue(
            `/componentAdditions/${index}/target/instancePath`,
            "variant.componentAdditionNested",
            "Variant component additions cannot traverse PrefabRef instances",
          ),
        );
      const key = `${addition.target.nodeId}\0${addition.componentType}`;
      if (componentAdditionKeys.has(key))
        issues.push(
          issue(
            `/componentAdditions/${index}`,
            "variant.componentAdditionDuplicate",
            `Variant has duplicate ${addition.componentType} addition on '${addition.target.nodeId}'`,
          ),
        );
      componentAdditionKeys.add(key);
    }
    if (source.artifactType === "Fragment" && (source.bindings?.length ?? 0) > 0) {
      issues.push(issue("/bindings", "fragment_has_binding", "Fragment Variant cannot declare Binder bindings", { readiness: true }));
    }
    const bindingNames = new Set<string>();
    for (const [index, declaration] of (source.bindings ?? []).entries()) {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(declaration.name)) {
        issues.push(
          issue(
            `/bindings/${index}/name`,
            "binding.name",
            declaration.name.length === 0 ? "binding name is empty" : `binding name '${declaration.name}' is not a TypeScript identifier`,
            { readiness: true },
          ),
        );
      }
      if (bindingNames.has(declaration.name))
        issues.push(
          issue(`/bindings/${index}/name`, "binding.duplicate", `binding name '${declaration.name}' is duplicated in this prefab layer`, {
            readiness: true,
          }),
        );
      bindingNames.add(declaration.name);
    }
    return validationResult(issues, requireReadiness);
  }

  if (source.root.id !== source.artifactKey) {
    issues.push(issue("/root/id", "identity.root", "root id must equal artifactKey"));
  }
  if (source.root.idMode !== undefined) {
    issues.push(issue("/root/idMode", "identity.rootMode", "Artifact root must not declare idMode"));
  }

  const ids = new Set<string>();
  const entries = walkNodes(source);
  for (const entry of entries) {
    const path = `/root/${entry.path.slice(1).join("/children/")}`;
    const { node } = entry;
    const idKey = nodeIdKey(node.id);
    if (ids.has(idKey)) issues.push(issue(`${path}/id`, "identity.duplicate", `duplicate case-insensitive node id '${node.id}'`));
    ids.add(idKey);

    if (entry.parent && !isChildNodeId(node.id)) {
      issues.push(
        issue(
          `${path}/id`,
          "identity.childCase",
          "child id must start with a lowercase letter, _ or $, and contain only letters, digits, _ or $",
        ),
      );
    }

    for (const [componentType, component] of Object.entries(node.components ?? {})) {
      if (!(componentType in componentRegistry)) {
        issues.push(
          issue(`${path}/components/${componentType}`, "component.registry", `component '${componentType}' is missing from the registry`),
        );
        continue;
      }
      for (const field of componentInspectorFields(componentType as UiComponentType)) {
        if (field.required !== true || String((component as Record<string, unknown>)[field.property] ?? "").length > 0) continue;
        issues.push(
          issue(`${path}/components/${componentType}/${field.property}`, "required.empty", `${field.label} is required`, {
            nodeId: node.id,
            componentType: componentType as UiComponentType,
            fieldPath: field.property,
            readiness: true,
          }),
        );
      }
    }
    const exclusiveGroups = new Map<string, UiComponentType[]>();
    for (const componentType of Object.keys(node.components ?? {}) as UiComponentType[]) {
      const group = (componentRegistry[componentType] as ComponentDefinition).exclusiveGroup;
      if (group) exclusiveGroups.set(group, [...(exclusiveGroups.get(group) ?? []), componentType]);
    }
    for (const [group, componentTypes] of exclusiveGroups) {
      if (componentTypes.length > 1) {
        issues.push(
          issue(
            `${path}/components`,
            "component.exclusiveGroup",
            `components ${componentTypes.join(", ")} conflict in exclusive group '${group}'`,
            { nodeId: node.id },
          ),
        );
      }
    }

    const prefabRef = node.components?.PrefabRef;
    if (prefabRef && Object.keys(node.components ?? {}).some((type) => type !== "PrefabRef" && !isUseSiteAddable(type))) {
      issues.push(
        issue(
          `${path}/components/PrefabRef`,
          "prefabRef.component",
          "PrefabRef use sites allow only approved visual and layout component additions",
        ),
      );
    }
    if (prefabRef) {
      if ([node.components?.Image, node.components?.RoundedRect].filter(Boolean).length > 1) {
        issues.push(
          issue(
            `${path}/components`,
            "prefabRef.localGraphic",
            "PrefabRef use sites allow only one added Graphic component on the instance root",
          ),
        );
      }
      for (const [index, child] of (node.children ?? []).entries()) {
        validateLocalVisualSubtree(child, `${path}/children/${index}`, issues);
      }
    }
    const componentAdditionTargets = new Set<string>();
    for (const [additionIndex, addition] of (prefabRef?.componentAdditions ?? []).entries()) {
      const key = `${(addition.target.instancePath ?? []).join("/")}\0${addition.target.nodeId}\0${addition.componentType}`;
      if (componentAdditionTargets.has(key)) {
        issues.push(
          issue(
            `${path}/components/PrefabRef/componentAdditions/${additionIndex}`,
            "prefabRef.componentAdditionDuplicate",
            `component addition '${addition.componentType}' is duplicated on '${addition.target.nodeId}'`,
          ),
        );
      }
      componentAdditionTargets.add(key);
    }
  }

  const nodeById = new Map(entries.map((entry) => [entry.node.id, entry.node]));
  const prefabRefIds = new Set(entries.filter((entry) => entry.node.components?.PrefabRef).map((entry) => entry.node.id));
  const localVisualNodeIds = new Set(
    entries.filter((entry) => entry.path.slice(0, -1).some((ancestorId) => prefabRefIds.has(ancestorId))).map((entry) => entry.node.id),
  );
  if (source.artifactType === "Fragment" && (source.bindings?.length ?? 0) > 0) {
    issues.push(issue("/bindings", "fragment_has_binding", "Fragment cannot declare Binder bindings", { readiness: true }));
  }
  const localBindingNames = new Set<string>();
  for (const [bindingIndex, declaration] of (source.bindings ?? []).entries()) {
    const { name: fieldName, target } = declaration;
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(fieldName)) {
      issues.push(
        issue(
          `/bindings/${bindingIndex}/name`,
          "binding.name",
          fieldName.length === 0 ? "binding name is empty" : `binding name '${fieldName}' is not a TypeScript identifier`,
          { readiness: true },
        ),
      );
    }
    if (localBindingNames.has(fieldName))
      issues.push(
        issue(`/bindings/${bindingIndex}/name`, "binding.duplicate", `binding name '${fieldName}' is duplicated in this prefab layer`, {
          readiness: true,
        }),
      );
    localBindingNames.add(fieldName);
    if ((target.instancePath?.length ?? 0) > 0) continue;
    const targetNode = nodeById.get(target.nodeId);
    if (!targetNode) {
      issues.push(
        issue(`/bindings/${bindingIndex}/target/nodeId`, "binding.target", `binding target node '${target.nodeId}' does not exist`, {
          readiness: true,
        }),
      );
      continue;
    }
    if (localVisualNodeIds.has(target.nodeId)) {
      issues.push(
        issue(`/bindings/${bindingIndex}`, "prefabRef.binding", "PrefabRef local visual children cannot declare Binder bindings", {
          readiness: true,
        }),
      );
    }
    if (
      target.componentType !== "GameObject" &&
      target.componentType !== "RectTransform" &&
      !targetNode.components?.[target.componentType]
    ) {
      issues.push(
        issue(
          `/bindings/${bindingIndex}/target/componentType`,
          "binding.component",
          `target '${target.nodeId}' has no ${target.componentType} component`,
          { readiness: true },
        ),
      );
    }
  }
  const requireNode = (
    nodeId: string,
    path: string,
    code: string,
    targetInfo: ValidationIssueTarget = {},
  ): UiConcreteSource["root"] | undefined => {
    if (nodeId.length === 0) return undefined;
    const target = nodeById.get(nodeId);
    if (!target) issues.push(issue(path, code, `target node '${nodeId}' does not exist`, targetInfo));
    return target;
  };

  for (const entry of entries) {
    const path = `/root/${entry.path.slice(1).join("/children/")}`;
    const { node } = entry;
    const targetInfo = (componentType: UiComponentType, fieldPath: string): ValidationIssueTarget => ({
      nodeId: node.id,
      componentType,
      fieldPath,
    });
    for (const [componentType, value] of Object.entries(node.components ?? {}) as [UiComponentType, Readonly<Record<string, unknown>>][]) {
      const definition = componentRegistry[componentType] as ComponentDefinition & { readonly validate?: ComponentValidationHook };
      definition.validate?.({
        node: node as unknown as ComponentValidationNode,
        value,
        findNode: (nodeId) => nodeById.get(nodeId) as unknown as ComponentValidationNode | undefined,
        report: (relativePath, code, message, target = {}) =>
          issues.push(
            issue(`${path}/components/${componentType}${relativePath.length > 0 ? `/${relativePath}` : ""}`, code, message, {
              ...(target.fieldPath ? { nodeId: node.id, componentType, fieldPath: target.fieldPath } : {}),
              ...(target.readiness ? { readiness: true } : {}),
            }),
          ),
      });
    }
    const button = node.components?.ButtonEx;
    if (button) {
      const target = requireNode(
        button.targetGraphic,
        `${path}/components/ButtonEx/targetGraphic`,
        "button.targetGraphic",
        targetInfo("ButtonEx", "targetGraphic"),
      );
      if (target && !target.components?.Image && !target.components?.RoundedRect) {
        issues.push(
          issue(`${path}/components/ButtonEx/targetGraphic`, "button.graphic", `target '${button.targetGraphic}' has no Graphic component`),
        );
      }
      if (button.pressFeedbackScaleTarget) {
        requireNode(
          button.pressFeedbackScaleTarget,
          `${path}/components/ButtonEx/pressFeedbackScaleTarget`,
          "button.pressFeedbackScaleTarget",
        );
      }
      if (button.pressFeedbackActiveTarget) {
        requireNode(
          button.pressFeedbackActiveTarget,
          `${path}/components/ButtonEx/pressFeedbackActiveTarget`,
          "button.pressFeedbackActiveTarget",
        );
      }
    }

    const requireGraphic = (
      nodeId: string,
      fieldPath: string,
      code: string,
      target: ValidationIssueTarget,
    ): UiConcreteSource["root"] | undefined => {
      const graphic = requireNode(nodeId, fieldPath, code, target);
      if (graphic && !graphic.components?.Image && !graphic.components?.RoundedRect && !graphic.components?.Text) {
        issues.push(issue(fieldPath, `${code}.graphic`, `target '${nodeId}' has no Graphic component`, target));
      }
      return graphic;
    };

    const toggle = node.components?.Toggle;
    if (toggle) {
      requireGraphic(
        toggle.targetGraphic,
        `${path}/components/Toggle/targetGraphic`,
        "toggle.targetGraphic",
        targetInfo("Toggle", "targetGraphic"),
      );
      requireGraphic(toggle.graphic, `${path}/components/Toggle/graphic`, "toggle.graphic", targetInfo("Toggle", "graphic"));
    }

    const slider = node.components?.Slider;
    if (slider) {
      requireGraphic(
        slider.targetGraphic,
        `${path}/components/Slider/targetGraphic`,
        "slider.targetGraphic",
        targetInfo("Slider", "targetGraphic"),
      );
      requireNode(slider.fillRect, `${path}/components/Slider/fillRect`, "slider.fillRect", targetInfo("Slider", "fillRect"));
      requireNode(slider.handleRect, `${path}/components/Slider/handleRect`, "slider.handleRect", targetInfo("Slider", "handleRect"));
      const minimum = slider.minValue ?? 0;
      const maximum = slider.maxValue ?? 1;
      if (maximum < minimum)
        issues.push(
          issue(
            `${path}/components/Slider/maxValue`,
            "slider.range",
            "Max Value must be greater than or equal to Min Value",
            targetInfo("Slider", "maxValue"),
          ),
        );
      if ((slider.value ?? 0) < minimum || (slider.value ?? 0) > maximum)
        issues.push(
          issue(
            `${path}/components/Slider/value`,
            "slider.value",
            "Value must be inside the configured range",
            targetInfo("Slider", "value"),
          ),
        );
    }

    const scrollbar = node.components?.Scrollbar;
    if (scrollbar) {
      requireGraphic(
        scrollbar.targetGraphic,
        `${path}/components/Scrollbar/targetGraphic`,
        "scrollbar.targetGraphic",
        targetInfo("Scrollbar", "targetGraphic"),
      );
      requireNode(
        scrollbar.handleRect,
        `${path}/components/Scrollbar/handleRect`,
        "scrollbar.handleRect",
        targetInfo("Scrollbar", "handleRect"),
      );
    }

    const validateScrollbars = (
      ownerType: "ScrollRect" | "ScrollRectEx",
      horizontalScrollbar: string | null | undefined,
      verticalScrollbar: string | null | undefined,
    ): void => {
      for (const [field, nodeId] of [
        ["horizontalScrollbar", horizontalScrollbar],
        ["verticalScrollbar", verticalScrollbar],
      ] as const) {
        if (!nodeId) continue;
        const target = requireNode(nodeId, `${path}/components/${ownerType}/${field}`, `scroll.${field}`, targetInfo(ownerType, field));
        if (target && !target.components?.Scrollbar)
          issues.push(
            issue(
              `${path}/components/${ownerType}/${field}`,
              "scroll.scrollbar",
              `target '${nodeId}' has no Scrollbar component`,
              targetInfo(ownerType, field),
            ),
          );
      }
    };

    const plainScroll = node.components?.ScrollRect;
    if (plainScroll) {
      requireNode(plainScroll.content, `${path}/components/ScrollRect/content`, "scroll.content", targetInfo("ScrollRect", "content"));
      requireNode(plainScroll.viewport, `${path}/components/ScrollRect/viewport`, "scroll.viewport", targetInfo("ScrollRect", "viewport"));
      validateScrollbars("ScrollRect", plainScroll.horizontalScrollbar, plainScroll.verticalScrollbar);
      if (node.components?.ScrollRectEx)
        issues.push(issue(`${path}/components`, "scrollRect.conflict", "ScrollRect and ScrollRectEx cannot be declared on the same node"));
    }

    const inputField = node.components?.TMPInputField;
    if (inputField) {
      const target = requireNode(
        inputField.targetGraphic,
        `${path}/components/TMPInputField/targetGraphic`,
        "input.targetGraphic",
        targetInfo("TMPInputField", "targetGraphic"),
      );
      if (target && !target.components?.Image && !target.components?.RoundedRect) {
        issues.push(
          issue(
            `${path}/components/TMPInputField/targetGraphic`,
            "input.graphic",
            `target '${inputField.targetGraphic}' has no Graphic component`,
          ),
        );
      }
      requireNode(
        inputField.textViewport,
        `${path}/components/TMPInputField/textViewport`,
        "input.viewport",
        targetInfo("TMPInputField", "textViewport"),
      );
      const textTarget = requireNode(
        inputField.textComponent,
        `${path}/components/TMPInputField/textComponent`,
        "input.text",
        targetInfo("TMPInputField", "textComponent"),
      );
      if (textTarget && !textTarget.components?.Text) {
        issues.push(
          issue(
            `${path}/components/TMPInputField/textComponent`,
            "input.textComponent",
            `target '${inputField.textComponent}' has no Text component`,
          ),
        );
      }
      if (inputField.placeholder) {
        const placeholder = requireNode(inputField.placeholder, `${path}/components/TMPInputField/placeholder`, "input.placeholder");
        if (placeholder && !placeholder.components?.Text) {
          issues.push(
            issue(
              `${path}/components/TMPInputField/placeholder`,
              "input.placeholderText",
              `target '${inputField.placeholder}' has no Text component`,
            ),
          );
        }
      }
    }

    const dropdown = node.components?.TMPDropdown;
    if (dropdown) {
      requireGraphic(
        dropdown.targetGraphic,
        `${path}/components/TMPDropdown/targetGraphic`,
        "dropdown.targetGraphic",
        targetInfo("TMPDropdown", "targetGraphic"),
      );
      requireNode(dropdown.template, `${path}/components/TMPDropdown/template`, "dropdown.template", targetInfo("TMPDropdown", "template"));
      const captionText = requireNode(
        dropdown.captionText,
        `${path}/components/TMPDropdown/captionText`,
        "dropdown.captionText",
        targetInfo("TMPDropdown", "captionText"),
      );
      if (captionText && !captionText.components?.Text)
        issues.push(
          issue(
            `${path}/components/TMPDropdown/captionText`,
            "dropdown.captionTextComponent",
            `target '${dropdown.captionText}' has no Text component`,
          ),
        );
      const itemText = requireNode(
        dropdown.itemText,
        `${path}/components/TMPDropdown/itemText`,
        "dropdown.itemText",
        targetInfo("TMPDropdown", "itemText"),
      );
      if (itemText && !itemText.components?.Text)
        issues.push(
          issue(
            `${path}/components/TMPDropdown/itemText`,
            "dropdown.itemTextComponent",
            `target '${dropdown.itemText}' has no Text component`,
          ),
        );
      if (dropdown.captionImage) {
        const captionImage = requireNode(dropdown.captionImage, `${path}/components/TMPDropdown/captionImage`, "dropdown.captionImage");
        if (captionImage && !captionImage.components?.Image)
          issues.push(
            issue(
              `${path}/components/TMPDropdown/captionImage`,
              "dropdown.captionImageComponent",
              `target '${dropdown.captionImage}' has no Image component`,
            ),
          );
      }
      if (dropdown.itemImage) {
        const itemImage = requireNode(dropdown.itemImage, `${path}/components/TMPDropdown/itemImage`, "dropdown.itemImage");
        if (itemImage && !itemImage.components?.Image)
          issues.push(
            issue(
              `${path}/components/TMPDropdown/itemImage`,
              "dropdown.itemImageComponent",
              `target '${dropdown.itemImage}' has no Image component`,
            ),
          );
      }
    }

    const joystick = node.components?.VirtualJoystick;
    if (joystick) {
      const area = requireNode(
        joystick.area,
        `${path}/components/VirtualJoystick/area`,
        "joystick.area",
        targetInfo("VirtualJoystick", "area"),
      );
      if (area && !area.components?.Image)
        issues.push(
          issue(`${path}/components/VirtualJoystick/area`, "joystick.areaGraphic", `area '${joystick.area}' has no Image component`),
        );
      const background = requireNode(
        joystick.background,
        `${path}/components/VirtualJoystick/background`,
        "joystick.background",
        targetInfo("VirtualJoystick", "background"),
      );
      if (background && !background.components?.Image)
        issues.push(
          issue(
            `${path}/components/VirtualJoystick/background`,
            "joystick.backgroundGraphic",
            `background '${joystick.background}' has no Image component`,
          ),
        );
      if (joystick.knob)
        requireNode(joystick.knob, `${path}/components/VirtualJoystick/knob`, "joystick.knob", targetInfo("VirtualJoystick", "knob"));
    }

    const customDropDown = node.components?.CustomDropDown;
    if (customDropDown) {
      const currentButton = requireNode(
        customDropDown.currentButton,
        `${path}/components/CustomDropDown/currentButton`,
        "customDropDown.currentButton",
        targetInfo("CustomDropDown", "currentButton"),
      );
      if (currentButton && !currentButton.components?.ButtonEx)
        issues.push(
          issue(
            `${path}/components/CustomDropDown/currentButton`,
            "customDropDown.currentButtonComponent",
            `target '${customDropDown.currentButton}' has no ButtonEx component`,
          ),
        );
      requireNode(
        customDropDown.expandArrow,
        `${path}/components/CustomDropDown/expandArrow`,
        "customDropDown.expandArrow",
        targetInfo("CustomDropDown", "expandArrow"),
      );
      requireNode(
        customDropDown.currentContentHost,
        `${path}/components/CustomDropDown/currentContentHost`,
        "customDropDown.currentContentHost",
        targetInfo("CustomDropDown", "currentContentHost"),
      );
      requireNode(
        customDropDown.optionView,
        `${path}/components/CustomDropDown/optionView`,
        "customDropDown.optionView",
        targetInfo("CustomDropDown", "optionView"),
      );
      const optionScrollRect = requireNode(
        customDropDown.optionScrollRect,
        `${path}/components/CustomDropDown/optionScrollRect`,
        "customDropDown.optionScrollRect",
        targetInfo("CustomDropDown", "optionScrollRect"),
      );
      if (optionScrollRect && !optionScrollRect.components?.ScrollRect)
        issues.push(
          issue(
            `${path}/components/CustomDropDown/optionScrollRect`,
            "customDropDown.optionScrollRectComponent",
            `target '${customDropDown.optionScrollRect}' has no ScrollRect component`,
          ),
        );
      const optionTemplate = requireNode(
        customDropDown.optionTemplate,
        `${path}/components/CustomDropDown/optionTemplate`,
        "customDropDown.optionTemplate",
        targetInfo("CustomDropDown", "optionTemplate"),
      );
      if (optionTemplate && !optionTemplate.components?.CustomDropDownOption)
        issues.push(
          issue(
            `${path}/components/CustomDropDown/optionTemplate`,
            "customDropDown.option",
            `target '${customDropDown.optionTemplate}' has no CustomDropDownOption component`,
          ),
        );
    }

    const customDropDownOption = node.components?.CustomDropDownOption;
    if (customDropDownOption) {
      const optionButton = requireNode(
        customDropDownOption.button,
        `${path}/components/CustomDropDownOption/button`,
        "customDropDownOption.button",
        targetInfo("CustomDropDownOption", "button"),
      );
      if (optionButton && !optionButton.components?.ButtonEx)
        issues.push(
          issue(
            `${path}/components/CustomDropDownOption/button`,
            "customDropDownOption.buttonComponent",
            `target '${customDropDownOption.button}' has no ButtonEx component`,
          ),
        );
      requireNode(
        customDropDownOption.contentHost,
        `${path}/components/CustomDropDownOption/contentHost`,
        "customDropDownOption.contentHost",
        targetInfo("CustomDropDownOption", "contentHost"),
      );
      requireNode(
        customDropDownOption.selectedVisual,
        `${path}/components/CustomDropDownOption/selectedVisual`,
        "customDropDownOption.selectedVisual",
        targetInfo("CustomDropDownOption", "selectedVisual"),
      );
    }

    const scrollRect = node.components?.ScrollRectEx;
    if (scrollRect) {
      const content = requireNode(
        scrollRect.content,
        `${path}/components/ScrollRectEx/content`,
        "scroll.content",
        targetInfo("ScrollRectEx", "content"),
      );
      requireNode(
        scrollRect.viewport,
        `${path}/components/ScrollRectEx/viewport`,
        "scroll.viewport",
        targetInfo("ScrollRectEx", "viewport"),
      );
      if (content && Object.keys(scrollRect.templates ?? {}).length > 0) {
        for (const componentType of DYNAMIC_SCROLL_CONTENT_LAYOUT_COMPONENT_TYPES) {
          if (!content.components?.[componentType]) continue;
          issues.push(
            issue(
              `${path}/components/ScrollRectEx/content`,
              "scrollRectEx.contentLayoutFormal",
              `dynamic ScrollRectEx content layout component '${componentType}' must be derived from LayoutSettings`,
              { nodeId: content.id, componentType, readiness: true },
            ),
          );
        }
      }
      if (scrollRect.emptyDefaultTarget) {
        requireNode(scrollRect.emptyDefaultTarget, `${path}/components/ScrollRectEx/emptyDefaultTarget`, "scroll.emptyDefaultTarget");
      }
      if (scrollRect.emptyDefaultStateRoot) {
        const stateRootTarget = requireNode(
          scrollRect.emptyDefaultStateRoot,
          `${path}/components/ScrollRectEx/emptyDefaultStateRoot`,
          "scroll.emptyDefaultStateRoot",
        );
        if (stateRootTarget && !stateRootTarget.components?.StateRoot) {
          issues.push(
            issue(
              `${path}/components/ScrollRectEx/emptyDefaultStateRoot`,
              "scroll.emptyStateRoot",
              `target '${scrollRect.emptyDefaultStateRoot}' has no StateRoot component`,
            ),
          );
        }
      }
      validateScrollbars("ScrollRectEx", scrollRect.horizontalScrollbar, scrollRect.verticalScrollbar);
      for (const [templateKey, nodeId] of Object.entries(scrollRect.templates)) {
        if (nodeId.length === 0) {
          issues.push(
            issue(
              `${path}/components/ScrollRectEx/templates/${templateKey}`,
              "required.empty",
              `Template '${templateKey}' target is required`,
              { nodeId: node.id, componentType: "ScrollRectEx", fieldPath: "templates", readiness: true },
            ),
          );
        }
        const template = requireNode(nodeId, `${path}/components/ScrollRectEx/templates/${templateKey}`, "scroll.template");
        if (template && !template.components?.PrefabRef) {
          issues.push(
            issue(
              `${path}/components/ScrollRectEx/templates/${templateKey}`,
              "scroll.templatePrefab",
              `template '${nodeId}' is not a PrefabRef node`,
            ),
          );
        }
      }
    }
    if (node.components?.LayoutSettings && !scrollRect) {
      issues.push(
        issue(`${path}/components/LayoutSettings`, "layoutSettings.owner", "LayoutSettings requires ScrollRectEx on the same node", {
          nodeId: node.id,
          componentType: "LayoutSettings",
          readiness: true,
        }),
      );
    }
  }

  return validationResult(issues, requireReadiness);
}

function variantAdditionNodes(addition: UiVariantNodeAddition): UiNode[] {
  const result: UiNode[] = [];
  const visit = (node: UiNode): void => {
    result.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(addition.node);
  return result;
}

function validationResult(issues: readonly ValidationIssue[], requireReadiness: boolean): ValidationResult {
  const visibleIssues = requireReadiness ? issues : issues.filter((entry) => entry.readiness !== true);
  return { valid: visibleIssues.length === 0, issues: visibleIssues };
}

function validateLocalVisualSubtree(node: UiNode, path: string, issues: ValidationIssue[]): void {
  const allowed = (type: string): boolean => type === "Text" || isUseSiteAddable(type);
  const componentTypes = Object.keys(node.components ?? {});
  for (const componentType of Object.keys(node.components ?? {})) {
    if (!allowed(componentType)) {
      issues.push(
        issue(
          `${path}/components/${componentType}`,
          "prefabRef.localVisualComponent",
          "PrefabRef local visual children allow only visual and layout components",
        ),
      );
    }
  }
  if (componentTypes.filter((type) => type === "Image" || type === "RoundedRect" || type === "Text").length > 1) {
    issues.push(
      issue(`${path}/components`, "prefabRef.localGraphic", "PrefabRef local visual children allow only one Graphic component per node"),
    );
  }
  for (const [index, child] of (node.children ?? []).entries()) validateLocalVisualSubtree(child, `${path}/children/${index}`, issues);
}

export function assertValidSource(value: unknown): asserts value is UiSource {
  const result = validateSource(value);
  if (result.valid) return;
  const message = result.issues.map((item) => `${item.path} [${item.code}] ${item.message}`).join("\n");
  throw new Error(message);
}

export function assertSourceReady(value: unknown): asserts value is UiSource {
  const result = validateSourceReadiness(value);
  if (result.valid) return;
  const message = result.issues.map((item) => `${item.path} [${item.code}] ${item.message}`).join("\n");
  throw new Error(message);
}
