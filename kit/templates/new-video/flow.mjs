/**
 * __TITLE__ — live product journey.
 *
 * The kit opens record.startUrl, starts the screencast and hands you:
 *   page, context      Playwright page + browser context (2x DPR, brand font installed)
 *   chapter(t, body)   full-frame chapter card; blocks ~2.8s — use 4–7 per video
 *   say(t, body, ms)   lower-third caption; non-blocking, the flow keeps acting
 *   wait(ms)           reading time at steady pace — direction.pace (calm/steady/brisk/quick) scales it
 *   pace('brisk')      shift the live pace from here on; pace() returns to the video's setting
 *   mark(id, label)    extra timeline marks (chapter/caption marks are automatic)
 *   env                video.config.json "env" ($VARS resolved from process.env / kit/.env)
 *   mail               Mailcatcher (when env.mailUrl is set): waitFor({ to, subject }), link(msg, /pattern/), htmlUrl(msg)
 *   out                output folder for debug artifacts
 *
 * Return any JSON-able object; it is saved into live-meta.json.
 * See ../../authoring.md for copy, pacing and selector rules.
 */
export default async function flow({ page, env, chapter, say, wait }) {
  // Delete this block when the tour needs no sign-in (brief → app.loginRequired = false).
  if (env.email) {
    await say('Sign in', 'Open the app with your work account.', 2200);
    await page.getByLabel(/email/i).fill(env.email);
    await page.getByLabel(/password/i).fill(env.password);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.waitForURL((url) => !/login|sign-?in/.test(url.pathname), { timeout: 45000 });
    await wait(1000);
  }

  await chapter('First chapter', 'One sentence on what this part achieves');
  // await page.goto(`${env.baseUrl}/en/...`, { waitUntil: 'networkidle' });
  // await say('Do the thing', 'Why it matters to the viewer.', 2000);
  // await page.getByRole('button', { name: /do the thing/i }).click();

  await say('Ready to work', 'Where the viewer ends up.', 2200);
  await wait(1800);
  return {};
}
