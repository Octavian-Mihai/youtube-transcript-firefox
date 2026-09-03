(() => {
  "use strict";

  if (globalThis.__ytTranscriptCopierIsolated) {
    return;
  }
  globalThis.__ytTranscriptCopierIsolated = true;

  const SOURCE_ISOLATED = "yt-transcript-copier/isolated";
  const SOURCE_MAIN = "yt-transcript-copier/main";

  function agentLog(location, message, data, hypothesisId) {
    // #region agent log
    fetch("http://127.0.0.1:7258/ingest/1d66fd3e-ece0-4540-aae6-11821bd10767", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "c0faff",
      },
      body: JSON.stringify({
        sessionId: "c0faff",
        location,
        message,
        data: data || {},
        timestamp: Date.now(),
        hypothesisId,
        runId: "post-fix",
      }),
    }).catch(() => {});
    try {
      browser.runtime.sendMessage({
        type: "__debugLog",
        location,
        message,
        data: data || {},
        hypothesisId,
      });
    } catch {
      // Ignore debug relay failures.
    }
    // #endregion
  }

  const BUTTON_ID = "yt-transcript-copier-btn";
  const STYLE_ID = "yt-transcript-copier-style";
  const TRACK_TIMEOUT_MS = 5000;

  const WATCH_TARGETS = [
    "#actions #top-level-buttons-computed",
    "#top-level-buttons-computed",
    "ytd-watch-metadata #actions-inner",
    "#actions-inner",
    "ytd-watch-metadata #actions",
    "#below #actions",
    "#actions ytd-menu-renderer",
    "#actions",
  ];

  const SHORTS_TARGETS = [
    "ytd-reel-video-renderer[is-active] ytd-reel-player-overlay-renderer",
    "ytd-reel-player-overlay-renderer",
    "ytd-reel-video-renderer[is-active] #player-container",
    "#shorts-inner-container",
  ];

  let lastHref = location.href;
  let ensureTimer = 0;
  let buttonResetTimer = 0;

  function getVideoId(href = location.href) {
    try {
      const url = new URL(href);
      if (url.pathname === "/watch") {
        return url.searchParams.get("v");
      }
      const shorts = url.pathname.match(/^\/shorts\/([^/?]+)/);
      if (shorts) {
        return shorts[1];
      }
    } catch {
      return null;
    }
    return null;
  }

  function isShortsPage() {
    return /^\/shorts\//.test(location.pathname);
  }

  function isWatchPage() {
    return location.pathname === "/watch";
  }

  function isSupportedPage() {
    return Boolean(getVideoId());
  }

  agentLog(
    "content/isolated.js:startup",
    "isolated script loaded",
    { href: location.href, videoId: getVideoId() },
    "H1"
  );

  function formatTimestamp(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const pad = (value) => String(value).padStart(2, "0");
    if (hours > 0) {
      return `[${hours}:${pad(minutes)}:${pad(secs)}]`;
    }
    return `[${minutes}:${pad(secs)}]`;
  }

  function decodeCaption(raw) {
    let text = String(raw || "").replace(/\\n/g, " ");
    const replacements = [
      [/&amp;/g, "&"],
      [/&lt;/g, "<"],
      [/&gt;/g, ">"],
      [/&quot;/g, '"'],
      [/&apos;/g, "'"],
      [/&#39;/g, "'"],
      [/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))],
      [/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16))],
    ];
    for (let i = 0; i < 3; i += 1) {
      const before = text;
      for (const [pattern, replacement] of replacements) {
        text = text.replace(pattern, replacement);
      }
      if (text === before) {
        break;
      }
    }
    return text.replace(/\s+/g, " ").trim();
  }

  function languageBase(code) {
    return String(code || "")
      .toLowerCase()
      .split("-")[0];
  }

  function pickTrack(tracks, defaultLanguageCode) {
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return null;
    }

    const defaultFull = String(defaultLanguageCode || "").toLowerCase();
    const defaultBase = languageBase(defaultLanguageCode);

    const rank = (track) => {
      const lang = String(track.languageCode || "").toLowerCase();
      const base = languageBase(lang);
      const isAsr = track.kind === "asr";
      const isDefault = Boolean(
        defaultFull && (lang === defaultFull || (defaultBase && base === defaultBase))
      );
      const isEnglish = base === "en";
      return [isAsr ? 1 : 0, isDefault ? 0 : 1, isEnglish ? 0 : 1];
    };

    return [...tracks].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      for (let i = 0; i < ra.length; i += 1) {
        if (ra[i] !== rb[i]) {
          return ra[i] - rb[i];
        }
      }
      return 0;
    })[0];
  }

  function newRequestId() {
    if (globalThis.crypto?.randomUUID) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function requestCaptionTracks(expectedVideoId) {
    return new Promise((resolve, reject) => {
      const requestId = newRequestId();
      let settled = false;

      const cleanup = () => {
        window.removeEventListener("message", onMessage);
        clearTimeout(timer);
      };

      const finish = (fn, value) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        fn(value);
      };

      const onMessage = (event) => {
        if (event.source !== window) {
          return;
        }
        if (event.origin !== location.origin) {
          return;
        }
        const data = event.data;
        if (!data || data.source !== SOURCE_MAIN) {
          return;
        }
        if (data.type === "DEBUG_LOG") {
          agentLog(
            data.location || "main-relay",
            data.message || "main debug",
            data.data || {},
            data.hypothesisId || "H2"
          );
          return;
        }
        if (data.type !== "CAPTION_TRACKS" || data.requestId !== requestId) {
          return;
        }
        agentLog(
          "content/isolated.js:requestCaptionTracks",
          "received CAPTION_TRACKS",
          {
            requestId,
            trackCount: Array.isArray(data.tracks) ? data.tracks.length : -1,
            error: data.error || "",
            videoId: data.videoId || "",
          },
          "H2"
        );
        finish(resolve, data);
      };

      const timer = setTimeout(() => {
        agentLog(
          "content/isolated.js:requestCaptionTracks",
          "timed out waiting for MAIN",
          { requestId, expectedVideoId },
          "H2"
        );
        finish(
          reject,
          new Error("Timed out waiting for caption data. Try refreshing the page.")
        );
      }, TRACK_TIMEOUT_MS);

      window.addEventListener("message", onMessage);
      window.postMessage(
        {
          source: SOURCE_ISOLATED,
          type: "GET_CAPTION_TRACKS",
          requestId,
          expectedVideoId: expectedVideoId || "",
        },
        location.origin
      );
    });
  }

  function captionUrlWithFormat(baseUrl, fmt) {
    const url = new URL(baseUrl, location.origin);
    if (fmt) {
      url.searchParams.set("fmt", fmt);
    } else {
      url.searchParams.delete("fmt");
    }
    return url.toString();
  }

  function captionUrlFlags(baseUrl) {
    try {
      const parsed = new URL(baseUrl, location.origin);
      return {
        hasPot: parsed.searchParams.has("pot"),
        hasExp: parsed.searchParams.has("exp"),
        exp: parsed.searchParams.get("exp") || "",
        hasFmt: parsed.searchParams.has("fmt"),
      };
    } catch {
      return { hasPot: false, hasExp: false, exp: "", hasFmt: false };
    }
  }

  async function fetchCaptionBody(url) {
    const response = await fetch(url, { credentials: "include" });
    const body = await response.text();
    if (!response.ok) {
      const err = new Error("Couldn’t load captions. Try again.");
      err.debug = { status: response.status, bodyLen: body.length };
      throw err;
    }
    return body;
  }

  function linesFromXml(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    if (doc.querySelector("parsererror")) {
      return [];
    }

    const textNodes = [...doc.querySelectorAll("text")];
    if (textNodes.length) {
      return textNodes
        .map((node) => {
          const start = parseFloat(node.getAttribute("start") || "0");
          const text = decodeCaption(node.textContent);
          return text ? `${formatTimestamp(start)} ${text}` : "";
        })
        .filter(Boolean);
    }

    const pNodes = [...doc.querySelectorAll("body p, p")];
    return pNodes
      .map((node) => {
        const startMs = parseInt(node.getAttribute("t") || "0", 10);
        const text = decodeCaption(node.textContent);
        return text ? `${formatTimestamp(startMs / 1000)} ${text}` : "";
      })
      .filter(Boolean);
  }

  function linesFromJson3(jsonText) {
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return [];
    }
    const events = Array.isArray(parsed?.events) ? parsed.events : [];
    return events
      .map((event) => {
        const segs = Array.isArray(event.segs) ? event.segs : [];
        const text = decodeCaption(segs.map((seg) => seg.utf8 || "").join(""));
        if (!text || text === "\n") {
          return "";
        }
        return `${formatTimestamp((event.tStartMs || 0) / 1000)} ${text}`;
      })
      .filter(Boolean);
  }

  function parseCaptions(body) {
    const trimmed = String(body || "").trim();
    if (!trimmed) {
      return "";
    }
    if (trimmed.startsWith("{")) {
      return linesFromJson3(trimmed).join("\n");
    }
    return linesFromXml(trimmed).join("\n");
  }

  async function fetchTranscriptText(baseUrl) {
    const attempts = [
      { label: "raw", url: baseUrl },
      { label: "srv1", url: captionUrlWithFormat(baseUrl, "srv1") },
      { label: "default", url: captionUrlWithFormat(baseUrl, null) },
      { label: "json3", url: captionUrlWithFormat(baseUrl, "json3") },
    ];

    const results = [];
    let lastError = new Error("Couldn’t load captions. Try again.");
    for (const attempt of attempts) {
      try {
        const body = await fetchCaptionBody(attempt.url);
        const text = parseCaptions(body);
        results.push({
          label: attempt.label,
          status: 200,
          bodyLen: body.length,
          lineCount: text ? text.split("\n").filter(Boolean).length : 0,
        });
        if (text) {
          agentLog(
            "content/isolated.js:fetchTranscriptText",
            "caption fetch succeeded",
            { flags: captionUrlFlags(baseUrl), results },
            "H6"
          );
          return text;
        }
      } catch (err) {
        results.push({
          label: attempt.label,
          status: err?.debug?.status || 0,
          bodyLen: err?.debug?.bodyLen ?? -1,
          lineCount: 0,
          error: err?.message || String(err),
        });
        lastError = err;
      }
    }
    agentLog(
      "content/isolated.js:fetchTranscriptText",
      "all caption fetches failed",
      { flags: captionUrlFlags(baseUrl), results },
      "H6"
    );
    throw lastError;
  }

  function normalizeStamp(raw) {
    const value = String(raw || "").trim();
    if (!value) {
      return "";
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      return value;
    }
    return `[${value}]`;
  }

  function linesFromTranscriptPanel() {
    const nodes = [
      ...document.querySelectorAll("ytd-transcript-segment-renderer"),
      ...document.querySelectorAll("[class*='transcript-segment']"),
    ];
    const seen = new Set();
    const lines = [];
    for (const node of nodes) {
      if (seen.has(node)) {
        continue;
      }
      seen.add(node);
      const stamp =
        node.querySelector(".segment-timestamp, [class*='timestamp']")?.textContent ||
        node.querySelector("div")?.textContent ||
        "";
      const text =
        node.querySelector(".segment-text, [class*='segment-text']")?.textContent ||
        "";
      const cleaned = decodeCaption(text);
      const time = normalizeStamp(stamp.replace(/\s+/g, ""));
      if (cleaned && time && /\d/.test(time)) {
        lines.push(`${time} ${cleaned}`);
      } else if (cleaned) {
        lines.push(cleaned);
      }
    }
    return [...new Set(lines)].join("\n");
  }

  function transcriptButton() {
    const selectors = [
      "ytd-video-description-transcript-section-renderer #primary-button button",
      "ytd-video-description-transcript-section-renderer button",
      "ytd-engagement-panel-title-header-renderer button",
    ];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) {
        return node;
      }
    }
    return [...document.querySelectorAll("button, yt-button-shape button")].find(
      (button) => /transcript/i.test(button.getAttribute("aria-label") || button.textContent || "")
    );
  }

  function waitForTranscriptPanel(timeoutMs) {
    return new Promise((resolve) => {
      const existing = linesFromTranscriptPanel();
      if (existing) {
        resolve(existing);
        return;
      }
      const observer = new MutationObserver(() => {
        const text = linesFromTranscriptPanel();
        if (text) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(text);
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(linesFromTranscriptPanel());
      }, timeoutMs);
    });
  }

  async function scrapeTranscriptPanel() {
    const existing = linesFromTranscriptPanel();
    if (existing) {
      return existing;
    }
    const button = transcriptButton();
    if (!button) {
      return "";
    }
    button.click();
    return waitForTranscriptPanel(4000);
  }

  async function getTranscriptText() {
    const videoId = getVideoId();
    if (!videoId) {
      throw new Error("Open a YouTube video to copy its transcript.");
    }

    const payload = await requestCaptionTracks(videoId);
    if (payload.videoId && payload.videoId !== videoId) {
      throw new Error("Couldn’t read this video’s player data. Try refreshing the page.");
    }
    if (payload.error && !(payload.tracks && payload.tracks.length) && !payload.captionBody) {
      throw new Error(payload.error);
    }

    const intercepted = parseCaptions(payload.captionBody || "");
    if (intercepted) {
      agentLog(
        "content/isolated.js:getTranscriptText",
        "transcript from player intercept",
        { videoId, lineCount: intercepted.split("\n").filter(Boolean).length },
        "H6"
      );
      return intercepted;
    }

    const track = pickTrack(payload.tracks, payload.defaultLanguageCode);
    if (track?.baseUrl) {
      try {
        const fetched = await fetchTranscriptText(track.baseUrl);
        if (fetched) {
          agentLog(
            "content/isolated.js:getTranscriptText",
            "transcript fetched",
            {
              videoId,
              lang: track.languageCode || "",
              kind: track.kind || "",
              lineCount: fetched.split("\n").filter(Boolean).length,
            },
            "H6"
          );
          return fetched;
        }
      } catch {
        // YouTube returns an empty 200 for exp=xpe URLs without a pot token.
      }
    }

    const scraped = await scrapeTranscriptPanel();
    if (scraped) {
      agentLog(
        "content/isolated.js:getTranscriptText",
        "transcript from page panel",
        { videoId, lineCount: scraped.split("\n").filter(Boolean).length },
        "H6"
      );
      return scraped;
    }

    agentLog(
      "content/isolated.js:getTranscriptText",
      "all transcript sources failed",
      {
        videoId,
        hasCaptionBody: Boolean(payload.captionBody),
        trackCount: Array.isArray(payload.tracks) ? payload.tracks.length : 0,
      },
      "H6"
    );
    throw new Error("Couldn’t load captions. Try again.");
  }

  async function copyText(text) {
    await navigator.clipboard.writeText(text);
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID} {
        box-sizing: border-box;
        display: inline-flex;
        flex-shrink: 0;
        align-items: center;
        justify-content: center;
        height: 36px;
        padding: 0 16px;
        margin: 0 0 0 8px;
        border: none;
        border-radius: 18px;
        appearance: none;
        background: var(--yt-spec-badge-chip-background, #f2f2f2);
        color: var(--yt-spec-text-primary, #0f0f0f);
        font-family: "Roboto", "Arial", sans-serif;
        font-size: 14px;
        font-weight: 500;
        line-height: 36px;
        letter-spacing: 0.01em;
        cursor: pointer;
        white-space: nowrap;
        user-select: none;
        vertical-align: middle;
      }
      #${BUTTON_ID}:hover {
        background: var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.1));
      }
      #${BUTTON_ID}:focus-visible {
        outline: 2px solid var(--yt-spec-text-primary, #0f0f0f);
        outline-offset: 2px;
      }
      #${BUTTON_ID}.is-copied {
        background: var(--yt-spec-badge-chip-background, #f2f2f2);
      }
      #${BUTTON_ID}.is-error {
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${BUTTON_ID}.yt-transcript-copy-btn--shorts {
        position: fixed;
        left: 16px;
        bottom: 96px;
        z-index: 2200;
        margin: 0;
        box-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
      }
      html[dark] #${BUTTON_ID},
      [dark] #${BUTTON_ID} {
        background: var(--yt-spec-badge-chip-background, rgba(255, 255, 255, 0.1));
        color: var(--yt-spec-text-primary, #f1f1f1);
      }
      html[dark] #${BUTTON_ID}:hover,
      [dark] #${BUTTON_ID}:hover {
        background: var(--yt-spec-10-percent-layer, rgba(255, 255, 255, 0.2));
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function firstExisting(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) {
        return node;
      }
    }
    return null;
  }

  function setButtonLabel(button, label, className) {
    button.textContent = label;
    button.classList.remove("is-copied", "is-error");
    if (className) {
      button.classList.add(className);
    }
    clearTimeout(buttonResetTimer);
    buttonResetTimer = setTimeout(() => {
      button.textContent = "Copy transcript";
      button.classList.remove("is-copied", "is-error");
    }, className === "is-error" ? 2500 : 1500);
  }

  function createButton() {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "Copy transcript";
    button.setAttribute("aria-label", "Copy transcript");
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.dataset.busy === "1") {
        return;
      }
      button.dataset.busy = "1";
      try {
        const text = await getTranscriptText();
        await copyText(text);
        setButtonLabel(button, "Copied!", "is-copied");
      } catch (err) {
        const message = err?.message || "Couldn’t copy";
        const shortMessage =
          message.length > 28 ? "Couldn’t copy" : message;
        setButtonLabel(button, shortMessage, "is-error");
      } finally {
        button.dataset.busy = "0";
      }
    });
    return button;
  }

  function removeButton() {
    document.getElementById(BUTTON_ID)?.remove();
  }

  function placeButton() {
    ensureStyles();
    const existing = document.getElementById(BUTTON_ID);
    const button = existing || createButton();
    button.classList.toggle("yt-transcript-copy-btn--shorts", isShortsPage());

    if (isShortsPage()) {
      const host = firstExisting(SHORTS_TARGETS) || document.body;
      if (button.parentElement !== host) {
        host.appendChild(button);
      }
      return;
    }

    if (isWatchPage()) {
      const host = firstExisting(WATCH_TARGETS);
      agentLog(
        "content/isolated.js:placeButton",
        host ? "watch host found" : "watch host missing",
        {
          href: location.href,
          hostTag: host ? host.tagName : "",
          hostId: host ? host.id : "",
        },
        "H4"
      );
      if (!host) {
        return;
      }
      if (button.parentElement !== host) {
        host.appendChild(button);
      }
    }
  }

  function ensureButton() {
    if (!isSupportedPage()) {
      removeButton();
      return;
    }
    placeButton();
  }

  function scheduleEnsureButton() {
    clearTimeout(ensureTimer);
    ensureTimer = setTimeout(ensureButton, 50);
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "ping") {
      return Promise.resolve({ ok: true });
    }
    if (message?.type !== "getTranscript") {
      return;
    }
    return getTranscriptText()
      .then((text) => ({ ok: true, text }))
      .catch((err) => {
        agentLog(
          "content/isolated.js:onMessage",
          "getTranscript failed",
          { error: err?.message || String(err) },
          "H6"
        );
        return {
          ok: false,
          error: err?.message || "Couldn’t get the transcript.",
        };
      });
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }
    const data = event.data;
    if (data?.source === SOURCE_MAIN && data.type === "DEBUG_LOG") {
      agentLog(
        data.location || "main-relay",
        data.message || "main debug",
        data.data || {},
        data.hypothesisId || "H2"
      );
    }
  });

  window.addEventListener("yt-navigate-finish", scheduleEnsureButton);
  window.addEventListener("yt-page-data-updated", scheduleEnsureButton);

  const urlWatcher = new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      scheduleEnsureButton();
    }
    if (isSupportedPage() && !document.getElementById(BUTTON_ID)) {
      scheduleEnsureButton();
    }
  });

  urlWatcher.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  ensureButton();
})();
