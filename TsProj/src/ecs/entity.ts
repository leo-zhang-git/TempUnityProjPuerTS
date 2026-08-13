declare const entityIdBrand: unique symbol;

export type EntityId = number & {
  readonly [entityIdBrand]: "EntityId";
};
