export type WebStyleModule = Readonly<Record<string, string>>;

const scopedClassPattern = /^ui-[a-z0-9-]+__[A-Za-z_][\w-]*$/;

export function createWebClasses(...styleModules: readonly WebStyleModule[]) {
  return (value: string | false | null | undefined): string => {
    if (!value) return "";
    const classes = value
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((name) => {
        const resolved = styleModules.flatMap((styles) => (styles[name] ? [styles[name]] : []));
        return resolved.length > 0 ? resolved : scopedClassPattern.test(name) ? [name] : [];
      });
    return [...new Set(classes)].join(" ");
  };
}
