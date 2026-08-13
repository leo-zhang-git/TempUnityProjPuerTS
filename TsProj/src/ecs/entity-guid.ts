import { Guid } from "../core/guid";

declare const entityGuidBrand: unique symbol;

export type EntityGuid = Guid & {
  readonly [entityGuidBrand]: "EntityGuid";
};
