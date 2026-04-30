const defaultModelAliases = [
  'gemini-3.1-pro',
  'gemini-3.1-flash',
  'gemini-3.1-flash-lite',
  'claude-4-7-opus-latest',
  'claude-4-6-sonnet-latest',
  'claude-4-5-haiku-latest',
  'gpt-5.5',
  'gpt-5.4-thinking',
  'gpt-5.3-codex',
  'gpt-5.4-mini'
];

export function loadModelAliases(): string[] {
  const saved = localStorage.getItem('orchestra_model_aliases');
  return saved ? JSON.parse(saved) : defaultModelAliases;
}
