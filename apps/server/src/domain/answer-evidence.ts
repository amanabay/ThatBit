// Text-only assistance cannot determine whether an unspoken demonstration answers
// a message. Explicit deferrals and missing speech should stay in manual review.
export function hasAnswerEvidence(text: string) {
  const speech = text.toLowerCase().replace(/[’]/g, "'");
  if (!speech.replace(/\[[^\]]*\]/g, "").trim()) return false;
  return ![
    /\b(?:i|we) (?:do not|don't|dont) know\b/,
    /\b(?:i|we) (?:will|'ll) (?:explain|cover|answer|show|come back to|return to)\b[^.!?]*(?:later|another day|tomorrow|next time|back to it)/,
    /\b(?:let me|i (?:need to|have to)) finish\b/,
    /\b(?:cannot|can't|not) (?:answer|show|explain|cover|showing)\b[^.!?]*(?:right now|today|yet)/,
    /\b(?:come|coming|get|getting) back to (?:it|that|this)\b/,
    /\b(?:i|we) (?:missed|didn't hear|did not hear) (?:the|your)\b/,
  ].some((pattern) => pattern.test(speech));
}
