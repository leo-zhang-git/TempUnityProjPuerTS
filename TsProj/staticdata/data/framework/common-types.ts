declare const refBrand: unique symbol;

/**
 * 表主键/外键的品牌化字符串类型；运行时仍是 string，仅在编译期阻止跨表混用。
 * 通过 `T` 字面量区分不同表的引用，调用 `getX(...)` 必须传入声明为相应 RefId 的字段。
 */
export type RefId<T extends string> = string & { readonly [refBrand]: T };
