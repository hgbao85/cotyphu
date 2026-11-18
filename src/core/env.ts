// How this page was opened, read once from the address: a leaf every other file can import at load time.
import { params } from '../hook';

/** A headless shot or check (?render=cheap): the 3D view draws cheap. Players never see it. */
export const CHEAP = params.get('render') === 'cheap';
/** A check is driving the page (a seed, manual stepping, cheap drawing, an injected clock): it runs at ×1 and repeats. */
export const CHECKED = params.has('seed') || CHEAP || params.get('manual') === '1' || !!window.GAME_CLOCK;
