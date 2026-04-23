declare module 'cookie' {
  export type CookieSerializeOptions = Record<string, unknown>;
  export type CookieParseOptions = Record<string, unknown>;

  export function parse(
    str: string,
    options?: CookieParseOptions,
  ): Record<string, string>;

  export function serialize(
    name: string,
    value: string,
    options?: CookieSerializeOptions,
  ): string;
}
