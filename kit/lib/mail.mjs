/**
 * Mailcatcher helpers (http://localhost:1080 by default). Emails are usually sent
 * by a background worker, so always poll for the exact recipient + subject —
 * never fall back to an older message (it may belong to a stale account).
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createMail(baseUrl = 'http://localhost:1080') {
  const url = baseUrl.replace(/\/$/, '');
  const list = async () => (await fetch(`${url}/messages`)).json();

  return {
    url,
    list,
    /** Newest message whose recipients contain `to` and subject matches `subject`. */
    async waitFor({ to, subject = /./, timeoutMs = 60000 }) {
      const needle = String(to).toLowerCase();
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = [...(await list())]
          .reverse()
          .find(
            (m) =>
              subject.test(m.subject || '') &&
              JSON.stringify(m.recipients || []).toLowerCase().includes(needle)
          );
        if (found) return found;
        await sleep(1000);
      }
      throw new Error(`No email to ${to} matching ${subject} within ${timeoutMs / 1000}s`);
    },
    htmlUrl: (message) => `${url}/messages/${message.id}.html`,
    async html(message) {
      return (await fetch(`${url}/messages/${message.id}.html`)).text();
    },
    /** First href in the message HTML matching `pattern` (entities decoded). */
    async link(message, pattern) {
      const html = await this.html(message);
      for (const [, href] of html.matchAll(/href="([^"]+)"/gi)) {
        const decoded = href.replace(/&amp;/g, '&');
        if (pattern.test(decoded)) return decoded;
      }
      throw new Error(`No link matching ${pattern} in "${message.subject}"`);
    },
  };
}
