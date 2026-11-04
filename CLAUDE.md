# ZapCut 개발 지침

## 기능을 추가·변경하면 MCP 안내도 함께 고친다

연결된 Claude(MCP 클라이언트)는 소스 코드를 보지 않고 MCP로 전달되는 안내만 보고 ZapCut을 쓴다.
사용자가 쓸 수 있는 기능을 추가하거나 바꾸면 같은 커밋에서 다음을 함께 고친다.

1. `electron/mcpTools.ts`: 도구 이름·설명·스키마 (처리기는 `src/editor/control.ts`의 `handlers`)
2. `electron/mcp.ts`의 `INSTRUCTIONS`: 모든 연결에 자동으로 전달되는 서버 안내문. 짧게 유지한다(길면 잘린다)
3. `electron/mcp-recipes.md`: 응용법(`recipes` 도구). 다른 도구와 이어 쓰는 방법, 사용자에게 미리 알릴 한계
4. README "Claude로 조종하기"의 도구 목록, `docs/ZapCut_Claude_연결_가이드.md`

MCP로 제어할 수 없는 기능이면 이유를 커밋 메시지에 적는다. 자세한 표와 확인 방법은 README "기능을 추가·변경할 때" 참고.
