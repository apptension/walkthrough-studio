/**
 * Every server path in one table, so a route rename is a single edit and a
 * typo is a type error rather than a 404 at runtime.
 */

const video = (slug: string) => `/api/video/${encodeURIComponent(slug)}`;

export const endpoints = {
  health: '/api/health',
  videos: '/api/videos',
  folders: '/api/folders',
  projects: '/api/projects',
  brands: '/api/brands',
  captureOptions: '/api/capture/options',
  briefDraft: '/api/brief/draft',
  agentPreference: '/api/agent/preference',

  jobs: '/api/jobs',
  job: (id: string) => `/api/jobs/${encodeURIComponent(id)}`,
  jobCancel: (id: string) => `/api/jobs/${encodeURIComponent(id)}/cancel`,
  jobAnswer: (id: string) => `/api/jobs/${encodeURIComponent(id)}/answer`,
  jobsCancelAll: '/api/jobs/cancel-all',

  video,
  config: (slug: string) => `${video(slug)}/config`,
  script: (slug: string) => `${video(slug)}/script`,
  scriptLine: (slug: string) => `${video(slug)}/script/line`,
  scriptStructure: (slug: string) => `${video(slug)}/script/structure`,
  scriptApprove: (slug: string) => `${video(slug)}/script/approve`,
  scriptRequestChanges: (slug: string) => `${video(slug)}/script/request-changes`,
  cutReview: (slug: string) => `${video(slug)}/cut/review`,
  brief: (slug: string) => `${video(slug)}/brief`,
  recordTarget: (slug: string) => `${video(slug)}/record-target`,
  signInContinue: (slug: string) => `${video(slug)}/sign-in-continue`,
  cleanup: (slug: string) => `${video(slug)}/cleanup`,
  transitions: (slug: string) => `${video(slug)}/transitions`,
  capture: (slug: string) => `${video(slug)}/capture`,
  captureMode: (slug: string) => `${video(slug)}/capture-mode`,
  direction: (slug: string) => `${video(slug)}/direction`,
  motion: (slug: string) => `${video(slug)}/motion`,
  overlays: (slug: string) => `${video(slug)}/overlays`,
  edit: (slug: string) => `${video(slug)}/edit`,
  narrators: (slug: string) => `${video(slug)}/narrators`,
  narrator: (slug: string) => `${video(slug)}/narrator`,
  narration: (slug: string) => `${video(slug)}/narration`,
  story: (slug: string) => `${video(slug)}/story`,
  storyCheck: (slug: string) => `${video(slug)}/story/check`,
  critic: (slug: string) => `${video(slug)}/critic`,
  suggestPlates: (slug: string) => `${video(slug)}/suggest-plates`,
  captions: (slug: string) => `${video(slug)}/captions`,
  qc: (slug: string) => `${video(slug)}/qc`,
  deliver: (slug: string) => `${video(slug)}/deliver`,
  poster: (slug: string) => `${video(slug)}/poster`,
  deliverablesZip: (slug: string) => `${video(slug)}/deliverables/zip`,
  run: (slug: string) => `${video(slug)}/run`,
  improve: (slug: string) => `${video(slug)}/improve`,
  draftProject: (slug: string) => `${video(slug)}/draft-project`,
  draftChanges: (slug: string) => `${video(slug)}/draft/changes`,
  draftApprove: (slug: string) => `${video(slug)}/draft/approve`,
  draftDiscard: (slug: string) => `${video(slug)}/draft/discard`,
  draftSnapshot: (slug: string) => `${video(slug)}/draft/snapshot`,
  guide: (slug: string) => `${video(slug)}/guide`,
  guideFinish: (slug: string) => `${video(slug)}/guide/finish`,
  guideControl: (slug: string) => `${video(slug)}/guide/control`,
  analyze: (slug: string) => `${video(slug)}/analyze`,
  scenes: (slug: string) => `${video(slug)}/scenes`,
  plates: (slug: string) => `${video(slug)}/plates`,
  platesRebuildHtml: (slug: string) => `${video(slug)}/plates/rebuild-html`,
  plateCopy: (slug: string, plateId: string) =>
    `${video(slug)}/plates/${encodeURIComponent(plateId)}/copy`,
  plateMotion: (slug: string, plateId: string) =>
    `${video(slug)}/plates/${encodeURIComponent(plateId)}/motion`,
  sceneImprove: (slug: string, plateId: string) =>
    `${video(slug)}/scenes/${encodeURIComponent(plateId)}/improve`,
  sceneRender: (slug: string, plateId: string) =>
    `${video(slug)}/scenes/${encodeURIComponent(plateId)}/render`,
  versions: (slug: string) => `${video(slug)}/versions`,
  versionSnapshot: (slug: string) => `${video(slug)}/versions/snapshot`,
  versionDelete: (slug: string) => `${video(slug)}/versions/delete`,
  versionRestore: (slug: string, id: string) =>
    `${video(slug)}/versions/${encodeURIComponent(id)}/restore`,
  branchIdeas: (slug: string) => `${video(slug)}/branch/ideas`,
  branchDiscover: (slug: string) => `${video(slug)}/branch/discover`,
  branch: (slug: string) => `${video(slug)}/branch`,
  voiceLine: (slug: string) => `${video(slug)}/voice/line`,
  voiceLineAdd: (slug: string) => `${video(slug)}/voice/line/add`,
  voiceLineUpload: (slug: string) => `${video(slug)}/voice/line/upload`,
  musicPrompt: (slug: string) => `${video(slug)}/music/prompt`,
  musicUpload: (slug: string) => `${video(slug)}/music/upload`,
  brandFile: (slug: string, file: string) =>
    `${video(slug)}/brand-file/${encodeURIComponent(file)}`,

  /** Capture-time status files the server writes next to the render. */
  livePreviewMeta: (slug: string) => `/media/${encodeURIComponent(slug)}/live-preview.json`,
  livePreviewFrame: (slug: string) => `/media/${encodeURIComponent(slug)}/live-preview.jpg`,
  signInWait: (slug: string) => `/media/${encodeURIComponent(slug)}/sign-in-wait.json`,
} as const;
