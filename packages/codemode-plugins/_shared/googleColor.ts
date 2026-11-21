import * as t from "typebox";

/** A colour as CSS writes it: `#rgb` or `#rrggbb`, with or without the `#`. */
export const HexColor = t.String({
  pattern: "^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$",
});

/** A `HexColor` as Google's APIs take a colour: each channel from 0 to 1. */
export function rgbColor(hex: string): {
  red: number;
  green: number;
  blue: number;
} {
  const digits = hex.replace(/^#/, "");
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  const n = parseInt(full, 16);
  return {
    red: ((n >> 16) & 0xff) / 255,
    green: ((n >> 8) & 0xff) / 255,
    blue: (n & 0xff) / 255,
  };
}
