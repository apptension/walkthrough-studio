#!/usr/bin/env node
/**
 * Render the README marketing graphics (hero, Agent Ready, languages, video kinds, ways in,
 * social preview) from HTML with the kit's Playwright Chromium.
 *
 * Desk screenshots come from docs/assets (see capture-readme-shots.mjs). Needs network once for
 * Google Fonts. Usage: node scripts/render-readme-art.mjs
 */
import { chromium } from '../kit/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/assets');
const SITE = OUT;
const TMP = path.join(tmpdir(), 'walkthrough-readme-art');
const join = path.join;
// Monochrome Cursor and Claude marks (Simple Icons, CC0), same as kit/studio/index.html.
const marks = {"cursor": "M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23", "claude": "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"};
const logoSvg = readFileSync(join(OUT, 'logo.svg'), 'utf8');
const logoData = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString('base64')}`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Noto+Sans+JP&family=Noto+Sans+Arabic&family=Noto+Sans+Devanagari&display=block" rel="stylesheet">`;

const BASE = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#070807}
body{color:#f2f4f0;font-family:'Plus Jakarta Sans',system-ui,sans-serif;overflow:hidden;position:relative;-webkit-font-smoothing:antialiased}
.mono{font-family:'IBM Plex Mono',ui-monospace,monospace}
.atmo{position:absolute;inset:0;background:
 radial-gradient(55% 60% at 18% 8%,rgba(66,242,114,.22),transparent 62%),
 radial-gradient(45% 50% at 88% 95%,rgba(198,242,74,.14),transparent 60%),
 radial-gradient(40% 40% at 60% 50%,rgba(66,242,114,.06),transparent 70%),
 linear-gradient(180deg,#0c0e0c 0%,#070807 100%)}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:56px 56px;-webkit-mask-image:radial-gradient(75% 75% at 50% 35%,#000 20%,transparent 100%)}
.strands{position:absolute;inset:0;opacity:.9}
.vignette{position:absolute;inset:0;background:radial-gradient(90% 80% at 50% 50%,transparent 50%,rgba(0,0,0,.55))}
.kicker{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#42f272}
.kicker.muted{color:rgba(255,255,255,.45)}
.grad{background:linear-gradient(90deg,#42f272,#c6f24a 70%,#fffe25);-webkit-background-clip:text;background-clip:text;color:transparent}
.chip{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);border-radius:999px;padding:8px 14px;font-size:13px;color:rgba(255,255,255,.8);font-weight:500;white-space:nowrap}
.chip .dot{width:7px;height:7px;border-radius:999px;background:#42f272;box-shadow:0 0 0 4px rgba(66,242,114,.18)}
.frame{border-radius:14px;border:1px solid rgba(255,255,255,.14);background:#0b0d0b;box-shadow:0 60px 120px -40px rgba(0,0,0,.9),0 0 0 1px rgba(0,0,0,.6),0 0 80px rgba(66,242,114,.12);overflow:hidden}
.frame .bar{height:34px;display:flex;align-items:center;gap:7px;padding:0 14px;border-bottom:1px solid rgba(255,255,255,.08);background:#0f110f}
.frame .bar i{width:10px;height:10px;border-radius:999px;background:rgba(255,255,255,.14)}
.frame .bar .url{margin-left:12px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:rgba(255,255,255,.4)}
.frame img{display:block;width:100%}
.card{border-radius:18px;border:1px solid rgba(255,255,255,.1);background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));box-shadow:0 30px 60px -30px rgba(0,0,0,.8)}
.check{color:#42f272}
`;

function strands(seed = 1, n = 7) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const y = 120 + i * 70 + ((seed * 37 + i * 53) % 40);
    const a = 24 + ((seed * 11 + i * 17) % 30);
    out += `<path d="M-50 ${y} C 300 ${y - a}, 600 ${y + a}, 900 ${y - a / 2} S 1500 ${y + a}, 1700 ${y}" fill="none" stroke="url(#g)" stroke-width="${1 + (i % 3) * 0.4}" opacity="${0.12 + (i % 4) * 0.05}"/>`;
  }
  return `<svg class="strands" viewBox="0 0 1600 900" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#42f272" stop-opacity="0"/><stop offset=".4" stop-color="#42f272"/><stop offset=".8" stop-color="#c6f24a"/><stop offset="1" stop-color="#c6f24a" stop-opacity="0"/></linearGradient></defs>${out}</svg>`;
}

const mark = (id, size = 22, color = 'currentColor') =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden><path fill="${color}" d="${marks[id]}"/></svg>`;

const page = (w, h, css, body) => `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>${BASE}body{width:${w}px;height:${h}px}${css}</style></head><body>${body}</body></html>`;

/* ---------------------------------------------------------------- hero */
const hero = page(
  1200,
  760,
  `
.wrap{position:relative;padding:48px 64px 0}
.top{display:flex;align-items:center;justify-content:space-between}
.brand{display:flex;align-items:center;gap:12px;font-weight:700;font-size:16px;letter-spacing:-.01em}
.brand img{width:34px;height:34px}
.top .chips{display:flex;gap:8px}
.top .chip{padding:6px 12px;font-size:11px}
h1{margin-top:54px;font-size:60px;line-height:1;letter-spacing:-.045em;font-weight:700;max-width:1000px}
.sub{margin-top:18px;font-size:19px;line-height:1.5;color:rgba(255,255,255,.62);max-width:640px}
.row{margin-top:24px;display:flex;gap:10px;flex-wrap:wrap}
.shot{position:absolute;left:64px;right:64px;top:426px}
`,
  `<div class="atmo"></div><div class="grid"></div>${strands(2, 8)}<div class="vignette"></div>
<div class="wrap">
  <div class="top">
    <div class="brand"><img src="${logoData}" alt="">Walkthrough Studio</div>
    <div class="chips"><span class="chip mono">MIT</span><span class="chip mono">macOS · Linux</span><span class="chip mono">Runs on your machine</span></div>
  </div>
  <h1>Trailers, walkthroughs, help videos.<br><span class="grad">From your live app.</span></h1>
  <p class="sub">Describe the video. Studio records your real product, writes the script, narrates it in 84 languages, and hands you a 1920×1080 master.</p>
  <div class="row">
    <span class="chip"><span class="dot"></span>Agent Ready · Cursor + Claude Code</span>
    <span class="chip">84 languages · ElevenLabs</span>
    <span class="chip">CLI + agent skill</span>
    <span class="chip">Open source</span>
  </div>
  <div class="shot frame"><div class="bar"><i></i><i></i><i></i><span class="url">127.0.0.1:4747 · walkthrough-studio</span></div><img src="file://${SITE}/desk-program.jpg" alt=""></div>
</div>`,
);

/* -------------------------------------------------------- agent ready */
const agent = page(
  1200,
  640,
  `
.wrap{position:relative;padding:52px 64px;display:grid;grid-template-columns:1fr 1.15fr;gap:40px;height:100%}
h2{font-size:44px;line-height:1.02;letter-spacing:-.04em;font-weight:700;margin-top:14px}
.lead{margin-top:14px;font-size:16px;line-height:1.55;color:rgba(255,255,255,.6);max-width:460px}
.switch{margin-top:26px;display:inline-flex;align-items:center;gap:10px}
.seg{display:inline-flex;gap:4px;padding:4px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)}
.seg span{width:40px;height:40px;border-radius:999px;display:grid;place-items:center;color:rgba(255,255,255,.55)}
.seg span.on{background:#fff;color:#0a0a0a;box-shadow:0 0 0 4px rgba(66,242,114,.25)}
.pill{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:9px 14px;border:1px solid rgba(66,242,114,.35);background:rgba(66,242,114,.1);font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#42f272}
.pill i{width:7px;height:7px;border-radius:999px;background:#42f272;box-shadow:0 0 0 4px rgba(66,242,114,.2)}
ul{list-style:none;margin-top:26px;display:grid;gap:10px}
li{display:flex;gap:10px;font-size:14px;color:rgba(255,255,255,.72);line-height:1.45}
li::before{content:'';width:6px;height:6px;border-radius:999px;background:#42f272;margin-top:7px;flex:none}
.desk{padding:20px;display:grid;gap:14px;align-self:center}
.lab{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:rgba(255,255,255,.4)}
.say{margin-top:8px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.35);padding:14px 16px;font-size:16px;line-height:1.4}
.log{margin-top:8px;display:grid;gap:7px;font-family:'IBM Plex Mono',monospace;font-size:12px;color:rgba(255,255,255,.72)}
.log div::before{content:'✓ ';color:#42f272}
.log div.wait::before{content:'● ';color:#fffe25}
.files{margin-top:8px;display:grid;gap:6px}
.f{display:flex;align-items:center;justify-content:space-between;border-radius:10px;padding:9px 12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);font-family:'IBM Plex Mono',monospace;font-size:12px}
.f.edit{border-color:rgba(66,242,114,.35);background:rgba(66,242,114,.08)}
.f small{color:rgba(255,255,255,.4);font-size:11px}
.f b{font-weight:500;color:#42f272}
.f .kept{color:rgba(255,255,255,.4)}
.note{font-size:12px;color:rgba(255,255,255,.45);line-height:1.5}
`,
  `<div class="atmo"></div><div class="grid"></div>${strands(5, 6)}<div class="vignette"></div>
<div class="wrap">
  <div>
    <div class="kicker">Agent Ready</div>
    <h2>Tell Cursor or Claude.<br>It makes the video.</h2>
    <p class="lead">The agent discovers your brand from the live site, drafts the script and the clicks, re-records after a redesign, and recuts for a new channel. You approve. Nothing records or renders without you.</p>
    <div class="switch"><div class="seg"><span class="on">${mark('cursor', 20)}</span><span>${mark('claude', 20)}</span></div><span class="pill"><i></i>Agent Ready</span></div>
    <ul>
      <li>Discover brand: logo, five colors, type, motion, from your URL</li>
      <li>Draft script, flow, and narration from a one-paragraph brief</li>
      <li>Re-record when the product changes. Voice is reused, not re-bought</li>
      <li>Branch focused feature videos from one overview</li>
    </ul>
  </div>
  <div class="card desk">
    <div><div class="lab">You say</div><div class="say">Make a 60 second trailer for the new billing page.</div></div>
    <div><div class="lab">Cursor does</div><div class="log"><div>discover-brand from app.acme.com: lockup, 5 colors, type</div><div>analyze: 31 controls mapped on /billing</div><div>drafted 5 chapters, 2 proof plates, 11 lines</div><div class="wait">waiting for script approval</div></div></div>
    <div><div class="lab">Your video project</div><div class="files">
      <div class="f edit"><span>video.config.json <small>· script and plates</small></span><b>✓</b></div>
      <div class="f"><span>flow.mjs <small>· what gets clicked</small></span><span class="kept">kept</span></div>
      <div class="f edit"><span>narration.mjs <small>· what gets said</small></span><b>✓</b></div>
      <div class="f"><span>brands/acme/ <small>· logo, colors, motion</small></span><span class="kept">kept</span></div>
    </div></div>
    <p class="note">Plain files in your repo. Every change is a diff you can read, revert, and commit.</p>
  </div>
</div>`,
);

/* ---------------------------------------------------------- languages */
const LANGS = ['English', 'German', 'Spanish', 'French', 'Portuguese', 'Polish', 'Italian', 'Dutch', 'Japanese', 'Korean', 'Mandarin', 'Hindi', 'Arabic', 'Turkish', 'Swedish', 'Ukrainian'];
const languages = page(
  1200,
  640,
  `
.wrap{position:relative;padding:52px 64px;display:grid;grid-template-columns:1.2fr 1fr;gap:40px;height:100%;align-items:center}
.plate{position:relative;aspect-ratio:16/10;border-radius:18px;overflow:hidden;border:1px solid rgba(255,255,255,.12);background:#070807;box-shadow:0 50px 100px -40px rgba(0,0,0,.9)}
.plate .bg{position:absolute;inset:0;background:radial-gradient(70% 60% at 30% 20%,rgba(66,242,114,.26),transparent 60%),radial-gradient(60% 50% at 90% 100%,rgba(198,242,74,.18),transparent 60%),#0a0c0a}
.plate .cap{position:absolute;left:24px;top:22px}
.plate .cap .chip{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.2em;text-transform:uppercase;padding:7px 12px}
.plate .txt{position:absolute;left:28px;right:28px;bottom:92px}
.plate .lang{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#42f272}
.plate .lang span{color:rgba(255,255,255,.4)}
.plate h3{margin-top:12px;font-size:36px;line-height:1.1;letter-spacing:-.03em;font-weight:700}
.plate .voice{position:absolute;left:28px;right:28px;bottom:22px;display:flex;align-items:center;gap:14px;border-radius:12px;padding:10px 14px;border:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.45)}
.plate .voice .lab{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:rgba(255,255,255,.55);display:flex;align-items:center;gap:8px}
.bars{display:flex;align-items:center;gap:3px;height:22px;flex:1}
.bars i{width:3px;border-radius:2px;background:#42f272;display:block}
.cc{font-family:'IBM Plex Mono',monospace;font-size:10px;color:rgba(255,255,255,.5)}
.num{font-size:92px;line-height:.95;letter-spacing:-.05em;font-weight:800}
h2{margin-top:8px;font-size:30px;line-height:1.08;letter-spacing:-.035em;font-weight:700}
.lead{margin-top:14px;font-size:15px;line-height:1.55;color:rgba(255,255,255,.6)}
.chips{margin-top:20px;display:flex;flex-wrap:wrap;gap:7px}
.chips .chip{padding:7px 12px;font-size:12px}
.chips .chip.on{background:#fff;color:#0a0a0a;border-color:#fff}
.chips .chip.more{border-style:dashed;color:rgba(255,255,255,.5);font-family:'IBM Plex Mono',monospace;font-size:11px}
.el{margin-top:20px;display:inline-flex;align-items:center;gap:10px;border-radius:999px;border:1px solid rgba(255,255,255,.12);padding:8px 14px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:rgba(255,255,255,.6)}
.el b{color:#fff;font-weight:700;letter-spacing:-.02em;font-family:'Plus Jakarta Sans',sans-serif;font-size:13px}
`,
  `<div class="atmo"></div><div class="grid"></div>${strands(9, 7)}<div class="vignette"></div>
<div class="wrap">
  <div class="plate"><div class="bg"></div>
    <div class="cap"><span class="chip">Chapter 02 · Invite</span></div>
    <div class="txt"><div class="lang">Spanish <span>· ES</span></div><h3>Invita a un compañero en menos de un minuto.</h3></div>
    <div class="voice"><span class="lab">Voice</span><div class="bars">${Array.from({ length: 46 }, (_, i) => `<i style="height:${4 + Math.round(9 * (1 + Math.sin(i * 0.9) * Math.cos(i * 0.37)))}px"></i>`).join('')}</div><span class="cc" style="white-space:nowrap">CC · chapters</span></div>
  </div>
  <div>
    <div class="kicker">One recording</div>
    <div class="num grad">84</div>
    <h2>languages. Record once, speak to every market.</h2>
    <p class="lead">Choose a language in the brief. Captions, plate copy, and narration follow it. Numbers and must-say lines stay exactly as you wrote them. The second language costs minutes, not a reshoot.</p>
    <div class="chips">${LANGS.map((l) => `<span class="chip${l === 'Spanish' ? ' on' : ''}">${l}</span>`).join('')}<span class="chip more">+68 more</span></div>
    <div class="el" style="white-space:nowrap"><b>IIElevenLabs</b>· Eleven v4 · narration and music bed · your key</div>
  </div>
</div>`,
);

/* -------------------------------------------------------------- kinds */
const KINDS = [
  { t: 'Trailer', len: '45 to 90 seconds', line: 'Launch day, Product Hunt, the homepage hero. The release, shown, not described.', img: 'plate-open.jpg', beats: ['The job today', 'The promise', 'Proof plate', 'Where to start'] },
  { t: 'Feature walkthrough', len: '60 to 120 seconds', line: 'One feature, before and after. For the changelog, the sales deck, and the follow-up email.', img: 'plate-features.jpg', beats: ['The workaround today', 'Same moment, with the feature', 'The steps between', 'What changes next week'] },
  { t: 'Help video', len: '90 seconds to 3 minutes', line: 'One task, one video. Fewer tickets, faster onboarding, a help center that keeps up with releases.', img: 'plate-close.jpg', beats: ['What you will have done', 'The stops ahead', 'One action per step', 'Three next habits'] },
];
const kinds = page(
  1200,
  640,
  `
.wrap{position:relative;padding:48px 64px}
.head{display:flex;align-items:flex-end;justify-content:space-between;gap:40px}
h2{font-size:40px;line-height:1.02;letter-spacing:-.04em;font-weight:700}
.lead{font-size:15px;line-height:1.5;color:rgba(255,255,255,.6);max-width:420px;text-align:right}
.cards{margin-top:30px;display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.k{overflow:hidden}
.k .img{aspect-ratio:16/9;overflow:hidden;position:relative}
.k .img img{width:100%;height:100%;object-fit:cover;display:block}
.k .img::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent 50%,rgba(7,8,7,.85))}
.k .body{padding:18px 20px 20px}
.k h3{font-size:20px;letter-spacing:-.025em;font-weight:700}
.k .len{margin-top:4px;font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#42f272}
.k p{margin-top:10px;font-size:13px;line-height:1.5;color:rgba(255,255,255,.62)}
.k ol{margin-top:12px;list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:5px 10px}
.k li{font-size:11px;color:rgba(255,255,255,.5);display:flex;gap:6px}
.k li b{font-family:'IBM Plex Mono',monospace;font-weight:500;color:#42f272;font-size:10px;margin-top:1px}
`,
  `<div class="atmo"></div><div class="grid"></div>${strands(3, 6)}<div class="vignette"></div>
<div class="wrap">
  <div class="head"><div><div class="kicker">What you can make</div><h2 style="margin-top:12px">Every video your product needs.<br><span class="grad">No video team.</span></h2></div><p class="lead">Pick the job. The story structure, the plates, and the length follow. Your product plays the lead.</p></div>
  <div class="cards">${KINDS.map(
    (k) => `<div class="card k"><div class="img"><img src="file://${SITE}/${k.img}"></div><div class="body"><h3>${k.t}</h3><div class="len">${k.len}</div><p>${k.line}</p><ol>${k.beats.map((b, i) => `<li><b>0${i + 1}</b>${b}</li>`).join('')}</ol></div></div>`,
  ).join('')}</div>
</div>`,
);

/* ------------------------------------------------------------ ways in */
const WAYS = [
  { t: 'In the browser', s: 'One command opens the desk. Click New video and describe what you need.', lines: [['$', 'git clone apptension/walkthrough-studio'], ['$', 'cd walkthrough-studio && ./studio'], ['', '✓ Node · npm · ffmpeg · Chromium'], ['', '● Studio on http://127.0.0.1:4747']] },
  { t: 'From the terminal', s: 'Scriptable end to end. Brief, record, voice, master, handoff pack.', lines: [['$', 'cd kit'], ['$', 'node cli.mjs new billing --purpose launch'], ['$', 'node cli.mjs all billing'], ['$', 'node cli.mjs deliver billing'], ['', '→ tmp/videos/billing/deliverables/']] },
  { t: 'From your agent', s: 'Drop SKILL.md into your repo. Cursor or Claude Code makes the video without opening the browser.', lines: [['$', 'cp -R studio .cursor/skills/walkthrough'], ['', ''], ['›', 'Make a 90s help video: invite a teammate.'], ['', '✓ brief → script → record → master']] },
];
const ways = page(
  1200,
  520,
  `
.wrap{position:relative;padding:48px 64px}
h2{font-size:40px;line-height:1.02;letter-spacing:-.04em;font-weight:700;margin-top:12px}
.cols{margin-top:28px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}
.w{padding:20px}
.w h3{font-size:18px;letter-spacing:-.02em;font-weight:700}
.w p{margin-top:6px;font-size:12.5px;line-height:1.5;color:rgba(255,255,255,.6);min-height:56px}
.term{margin-top:14px;overflow:hidden;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:#060706;padding:14px;font-family:'IBM Plex Mono',monospace;font-size:10.5px;line-height:1.8;color:rgba(255,255,255,.78);min-height:132px}
.term .p{color:#42f272}
.term .o{color:rgba(255,255,255,.5)}
`,
  `<div class="atmo"></div><div class="grid"></div>${strands(7, 6)}<div class="vignette"></div>
<div class="wrap">
  <div class="kicker">Start in minutes</div>
  <h2>Browser, terminal, or <span class="grad">your agent.</span></h2>
  <div class="cols">${WAYS.map(
    (w) => `<div class="card w"><h3>${w.t}</h3><p>${w.s}</p><div class="term">${w.lines
      .map(([p, l]) => (p ? `<div><span class="p">${p}</span> ${l}</div>` : `<div class="o">${l || '&nbsp;'}</div>`))
      .join('')}</div></div>`,
  ).join('')}</div>
</div>`,
);

/* ---------------------------------------------------- social preview */
const social = page(
  1280,
  640,
  `
.wrap{position:relative;padding:56px 72px 0;height:100%}
.brand{display:flex;align-items:center;gap:12px;font-weight:700;font-size:17px}
.brand img{width:36px;height:36px}
h1{margin-top:44px;font-size:52px;line-height:1.02;letter-spacing:-.045em;font-weight:700;max-width:540px;position:relative;z-index:2}
.row{margin-top:26px;display:flex;gap:10px}
.shot{position:absolute;left:640px;top:170px;width:760px;transform:perspective(1800px) rotateY(-12deg) rotateX(3deg);transform-origin:left center}
.foot{position:absolute;left:72px;bottom:40px;font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.45)}
`,
  `<div class="atmo"></div><div class="grid"></div>${strands(4, 8)}<div class="vignette"></div>
<div class="wrap">
  <div class="brand"><img src="${logoData}">Walkthrough Studio</div>
  <h1>Trailers, walkthroughs, help videos.<br><span class="grad">From your live app.</span></h1>
  <div class="row" style="position:relative;z-index:2"><span class="chip"><span class="dot"></span>Agent Ready</span><span class="chip">84 languages</span><span class="chip">CLI + Skill</span><span class="chip">MIT</span></div>
  <div class="shot frame"><div class="bar"><i></i><i></i><i></i></div><img src="file://${SITE}/desk-plate.jpg"></div>
  <div class="foot">github.com/apptension/walkthrough-studio</div>
</div>`,
);

const JOBS = [
  ['hero', hero, 1200, 760],
  ['agent-ready', agent, 1200, 640],
  ['languages', languages, 1200, 640],
  ['video-kinds', kinds, 1200, 640],
  ['ways-in', ways, 1200, 520],
  ['social-preview', social, 1280, 640],
];

mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });
const browser = await chromium.launch();
for (const [name, html, w, h] of JOBS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const tmp = join(TMP, `${name}.html`);
  writeFileSync(tmp, html);
  await p.goto(`file://${tmp}`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  const file = join(OUT, `${name}.jpg`);
  await p.screenshot({ path: file, type: 'jpeg', quality: 88 });
  console.log('wrote', file);
  await ctx.close();
}
await browser.close();
rmSync(TMP, { recursive: true, force: true });
