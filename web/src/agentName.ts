/** Format agent display name: name > tmuxSession > shortId, with shortId suffix */
export function agentName(agent: { name?: string | null; tmuxSession?: string | null; sessionId: string }): string {
  const shortId = agent.sessionId.slice(0, 8);
  const label = agent.name || agent.tmuxSession;
  return label ? `${label} (${shortId})` : shortId;
}
