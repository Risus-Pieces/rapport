import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SECTION_STYLES, type SectionAccent } from "./nav";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing ${selector} block`).toBeGreaterThan(-1);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

const sections: SectionAccent[] = ["restaurants", "investors", "general"];
const variants = ["", "-soft", "-ink"];
const hex = /^#[0-9a-f]{6}$/i;

describe("section color tokens in globals.css", () => {
  const themes = { light: block(":root"), dark: block(".dark") };

  for (const section of sections) {
    for (const variant of variants) {
      const token = `section-${section}${variant}`;

      it(`maps --color-${token} for Tailwind`, () => {
        expect(css).toContain(`--color-${token}: var(--${token});`);
      });

      for (const [theme, source] of Object.entries(themes)) {
        it(`defines --${token} as a hex color in the ${theme} theme`, () => {
          const match = source.match(new RegExp(`--${token}:\\s*([^;\\s]+);`));
          expect(match, `--${token} missing in ${theme}`).not.toBeNull();
          expect(match![1]).toMatch(hex);
        });
      }
    }
  }

  it("keeps SECTION_STYLES classes in step with the tokens", () => {
    for (const section of sections) {
      expect(SECTION_STYLES[section]).toEqual({
        dot: `bg-section-${section}`,
        chip: `bg-section-${section}-soft text-section-${section}-ink`,
        text: `text-section-${section}`,
      });
    }
  });
});
