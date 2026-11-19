// Chat in an online room: what a typed line becomes before anyone sees it. Pure, so Vitest runs it.
// The host cleans every line (a friend's screen cannot get round it): control and invisible characters
// out, spaces folded, the length capped. Words are not filtered and repeats stay as typed ("hayyyyy"):
// the players chose that. Design record: design/game-brief.md (After play: Thêm chat).

/** Control and invisible characters (zero-width spaces, direction marks, line separators). */
const INVISIBLE = new RegExp('[' + [[0x0, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]]
  .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('') + ']', 'g');

/**
 * A typed line, made fit to show: invisible characters out, spaces folded, at most maxLen characters.
 * Returns '' when nothing is left to send.
 */
export function cleanChat(raw: unknown, maxLen: number): string {
  let s = String(raw ?? '').normalize('NFC');
  s = s.replace(INVISIBLE, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if ([...s].length > maxLen) s = [...s].slice(0, maxLen).join('').trim();
  return s;
}

/**
 * Seconds since a player's last line or emote (last), now on the game's clock. A time later than now is from a
 * game before this one, whose clock started again at 0, so it does not count (Bug 19/11/2026: after "Ván mới" a
 * player was silenced for as long as the last game ran). Never sent anything: Infinity.
 */
export const since = (last: number | undefined, now: number): number => (last === undefined || last > now ? Infinity : now - last);
