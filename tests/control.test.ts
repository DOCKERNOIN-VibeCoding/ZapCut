import { describe, expect, it } from "vitest";
import { TOOLS } from "../electron/mcpTools";
import { handlers } from "../src/editor/control";

describe("외부 제어(MCP) 도구", () => {
  it("렌더러가 처리하는 도구마다 처리기가 있다", () => {
    for (const [name, t] of Object.entries(TOOLS)) if (!t.main && !t.local) expect(typeof handlers[name], name).toBe("function");
  });
  it("도구 이름은 snake_case", () => {
    for (const name of Object.keys(TOOLS)) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});
