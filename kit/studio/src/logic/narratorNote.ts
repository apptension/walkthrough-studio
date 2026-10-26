/** Narrator-panel copy for the ElevenLabs key. A live re-read clears the missing-key notice. */

export function narratorKeyNote(mode: string | null | undefined): string {
  if (mode === 'live') return '';
  if (mode === 'stub') return 'Voice runs in stub mode, so the account list is not available.';
  return 'Add ELEVENLABS_API_KEY in kit/.env to speak lines, or upload / record a take instead.';
}
