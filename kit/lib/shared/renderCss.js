/**
 * The CSS every plate is painted under, wherever it is painted.
 *
 * Plates ship a film grain that never stops and a `.black` curtain that closes the slide. Both
 * are right in a finished video and wrong anywhere the plate is being looked at: the grain makes
 * a still different every frame it is captured, and the curtain hides the plate the author is
 * editing. The encoder, the plate stills and the editor's stage all apply this, so what the
 * editor shows and what the render produces cannot drift apart on these two.
 */
export const RENDER_CSS = '.grain{animation:none!important}.black{display:none!important}';
