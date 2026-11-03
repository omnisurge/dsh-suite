/** ADR-034 D2d: what the system prompt says about an OAuth row depends on whether a page can finish the
 * flow. With a page the agent tools are retired, so the prompt must not name them; without one they are the
 * only entry point. Pure: the caller passes the facts it already owns, and the sentence lives in one place. */
export interface OAuthPromptFacts {
  readonly serverName: string;
  readonly connected: boolean;
  readonly pageAvailable: boolean;
  readonly loginTool: string;
  readonly submitTool: string;
}

export function oauthPromptText(facts: OAuthPromptFacts): string {
  if (facts.connected) return "";
  const head = `MCP server "${facts.serverName}" needs OAuth before its tools work.`;
  if (facts.pageAvailable) {
    return `${head} Sign in from the MCP servers page: open this row and use its sign-in action.`;
  }
  return [
    head,
    `Call ${facts.loginTool} and send the returned URL to the user.`,
    `When they paste a code, call ${facts.submitTool}. Never repeat the code.`,
  ].join(" ");
}