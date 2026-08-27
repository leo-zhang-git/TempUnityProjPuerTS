const numericLiteralPrefix = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const numericLiteral = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

class NumericExpressionParser {
  private cursor = 0;

  constructor(private readonly source: string) {}

  parse(): number | undefined {
    this.skipWhitespace();
    if (this.cursor === this.source.length) return undefined;
    const value = this.parseAdditive();
    this.skipWhitespace();
    return this.cursor === this.source.length && value !== undefined && Number.isFinite(value) ? value : undefined;
  }

  private parseAdditive(): number | undefined {
    let value = this.parseMultiplicative();
    if (value === undefined) return undefined;
    while (true) {
      this.skipWhitespace();
      const operator = this.source[this.cursor];
      if (operator !== "+" && operator !== "-") return value;
      this.cursor += 1;
      const right = this.parseMultiplicative();
      if (right === undefined) return undefined;
      value = operator === "+" ? value + right : value - right;
    }
  }

  private parseMultiplicative(): number | undefined {
    let value = this.parseUnary();
    if (value === undefined) return undefined;
    while (true) {
      this.skipWhitespace();
      const operator = this.source[this.cursor];
      if (operator !== "*" && operator !== "/") return value;
      this.cursor += 1;
      const right = this.parseUnary();
      if (right === undefined) return undefined;
      value = operator === "*" ? value * right : value / right;
    }
  }

  private parseUnary(): number | undefined {
    this.skipWhitespace();
    let sign = 1;
    while (this.source[this.cursor] === "+" || this.source[this.cursor] === "-") {
      if (this.source[this.cursor] === "-") sign *= -1;
      this.cursor += 1;
      this.skipWhitespace();
    }
    const value = this.parsePrimary();
    return value === undefined ? undefined : sign * value;
  }

  private parsePrimary(): number | undefined {
    this.skipWhitespace();
    if (this.source[this.cursor] === "(") {
      this.cursor += 1;
      const value = this.parseAdditive();
      this.skipWhitespace();
      if (value === undefined || this.source[this.cursor] !== ")") return undefined;
      this.cursor += 1;
      return value;
    }
    const match = numericLiteralPrefix.exec(this.source.slice(this.cursor));
    if (!match) return undefined;
    this.cursor += match[0].length;
    return Number(match[0]);
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.source[this.cursor] ?? "")) this.cursor += 1;
  }
}

export function evaluateNumericExpression(source: string): number | undefined {
  if (source.length > 512) return undefined;
  return new NumericExpressionParser(source).parse();
}

export function isNumericLiteral(source: string): boolean {
  const trimmed = source.trim();
  return numericLiteral.test(trimmed) && Number.isFinite(Number(trimmed));
}
