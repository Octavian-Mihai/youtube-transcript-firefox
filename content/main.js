(() => {
  "use strict";

  const INSTALLED_KEY = "__ytTranscriptCopierMainInstalled";
  if (window[INSTALLED_KEY]) {
    return;
  }
  try {
    Object.defineProperty(window, INSTALLED_KEY, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  } catch {
    window[INSTALLED_KEY] = true;
  }

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
      window.postMessage(
        {
          source: SOURCE_MAIN,
          type: "DEBUG_LOG",
          location,
          message,
          data: data || {},
          hypothesisId,
        },
        window.location.origin
      );
    } catch {
      // Ignore debug relay failures.
    }
    // #endregion
  }

  agentLog(
    "content/main.js:startup",
    "MAIN world script loaded",
    { href: location.href },
    "H1"
  );

  const timedtextCache = {
    videoId: "",
    url: "",
    body: "",
    hasPot: false,
  };

  function videoIdFromTimedtextUrl(url) {
    try {
      return new URL(url, window.location.origin).searchParams.get("v") || "";
    } catch {
      return "";
    }
  }

  function rememberTimedtext(url, body) {
    const text = String(body || "");
    if (!url || !String(url).includes("/api/timedtext") || !text.trim()) {
      return;
    }
    let hasPot = false;
    try {
      hasPot = new URL(url, window.location.origin).searchParams.has("pot");
    } catch {
      hasPot = /[?&]pot=/.test(String(url));
    }
    timedtextCache.videoId = videoIdFromTimedtextUrl(url);
    timedtextCache.url = String(url);
    timedtextCache.body = text;
    timedtextCache.hasPot = hasPot;
    agentLog(
      "content/main.js:rememberTimedtext",
      "captured player timedtext",
      { videoId: timedtextCache.videoId, bodyLen: text.length, hasPot },
      "H6"
    );
  }

  function hookTimedtextNetwork() {
    if (window.__ytTranscriptCopierNetHooked) {
      return;
    }
    window.__ytTranscriptCopierNetHooked = true;

    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = async function (input, init) {
        const url =
          typeof input === "string"
            ? input
            : input && typeof input.url === "string"
              ? input.url
              : "";
        const response = await originalFetch.apply(this, arguments);
        if (url.includes("/api/timedtext")) {
          try {
            rememberTimedtext(url, await response.clone().text());
          } catch {
            // Ignore clone failures; YouTube still gets the original response.
          }
        }
        return response;
      };
    }

    const xhrOpen = XMLHttpRequest.prototype.open;
    const xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__ytTranscriptTimedtextUrl = url;
      return xhrOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener("load", function () {
        const url = String(this.__ytTranscriptTimedtextUrl || "");
        if (url.includes("/api/timedtext")) {
          rememberTimedtext(url, this.responseText);
        }
      });
      return xhrSend.apply(this, args);
    };
  }

  hookTimedtextNetwork();

  function cachedBodyFor(videoId) {
    if (!timedtextCache.body) {
      return "";
    }
    if (videoId && timedtextCache.videoId && timedtextCache.videoId !== videoId) {
      return "";
    }
    return timedtextCache.body;
  }

  function triggerPlayerCaptions() {
    const player = getPlayerElement();
    if (!player) {
      return false;
    }
    try {
      if (typeof player.loadModule === "function") {
        player.loadModule("captions");
      }
    } catch {
      // Module may already be loaded.
    }
    try {
      const list =
        (typeof player.getOption === "function" &&
          player.getOption("captions", "tracklist")) ||
        [];
      if (Array.isArray(list) && list.length && typeof player.setOption === "function") {
        player.setOption("captions", "track", list[0]);
        return true;
      }
    } catch {
      // Fall through to toggle.
    }
    try {
      if (typeof player.toggleSubtitles === "function") {
        player.toggleSubtitles();
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  async function waitForCachedBody(videoId, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const body = cachedBodyFor(videoId);
      if (body) {
        return body;
      }
      await sleep(150);
    }
    return cachedBodyFor(videoId);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function safeParse(value) {
    if (!value) {
      return null;
    }
    if (typeof value === "object") {
      return value;
    }
    if (typeof value !== "string") {
      return null;
    }
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function getPlayerElement() {
    return (
      document.getElementById("movie_player") ||
      document.getElementById("shorts-player") ||
      document.querySelector("ytd-player #movie_player") ||
      document.querySelector(".html5-video-player")
    );
  }

  function getPlayerResponse() {
    const player = getPlayerElement();
    if (player && typeof player.getPlayerResponse === "function") {
      try {
        const response = player.getPlayerResponse();
        const parsed = safeParse(response);
        if (parsed) {
          return parsed;
        }
      } catch {
        // Player API can throw while the video is swapping.
      }
    }

    if (window.ytInitialPlayerResponse) {
      const parsed = safeParse(window.ytInitialPlayerResponse);
      if (parsed) {
        return parsed;
      }
    }

    try {
      const embedded = window.ytplayer?.config?.args?.player_response;
      const parsed = safeParse(embedded);
      if (parsed) {
        return parsed;
      }
    } catch {
      // Ignore missing embedded-player config.
    }

    return null;
  }

  function trackName(track) {
    if (!track?.name) {
      return "";
    }
    if (typeof track.name.simpleText === "string") {
      return track.name.simpleText;
    }
    if (Array.isArray(track.name.runs)) {
      return track.name.runs.map((run) => run.text || "").join("");
    }
    return "";
  }

  function extractCaptionData(playerResponse) {
    const renderer =
      playerResponse?.captions?.playerCaptionsTracklistRenderer || null;
    const rawTracks = Array.isArray(renderer?.captionTracks)
      ? renderer.captionTracks
      : [];

    const tracks = rawTracks
      .filter((track) => track && typeof track.baseUrl === "string" && track.baseUrl)
      .map((track) => ({
        baseUrl: track.baseUrl,
        languageCode: track.languageCode || "",
        kind: track.kind || "",
        name: trackName(track),
        vssId: track.vssId || "",
      }));

    let defaultLanguageCode = "";
    const audioIndex = renderer?.defaultAudioTrackIndex ?? 0;
    const audioTrack = renderer?.audioTracks?.[audioIndex];
    const defaultCaptionIndex = audioTrack?.defaultCaptionTrackIndex;
    if (
      Number.isInteger(defaultCaptionIndex) &&
      tracks[defaultCaptionIndex]?.languageCode
    ) {
      defaultLanguageCode = tracks[defaultCaptionIndex].languageCode;
    }

    const firstUrl = tracks[0]?.baseUrl || "";
    let urlFlags = { hasPot: false, hasExp: false, exp: "", hasFmt: false };
    try {
      const parsed = new URL(firstUrl, window.location.origin);
      urlFlags = {
        hasPot: parsed.searchParams.has("pot"),
        hasExp: parsed.searchParams.has("exp"),
        exp: parsed.searchParams.get("exp") || "",
        hasFmt: parsed.searchParams.has("fmt"),
      };
    } catch {
      // Ignore malformed caption URLs in debug flags.
    }

    return {
      tracks,
      defaultLanguageCode,
      videoId: playerResponse?.videoDetails?.videoId || "",
      hasPlayerResponse: Boolean(playerResponse),
      hasCaptionsRenderer: Boolean(renderer),
      urlFlags,
    };
  }

  function isCurrentVideo(data, expectedVideoId) {
    if (!expectedVideoId || !data.videoId) {
      return true;
    }
    return data.videoId === expectedVideoId;
  }

  async function collectCaptionData(expectedVideoId) {
    let last = {
      tracks: [],
      defaultLanguageCode: "",
      videoId: "",
      hasPlayerResponse: false,
      hasCaptionsRenderer: false,
    };

    for (let i = 0; i < 20; i += 1) {
      const playerResponse = getPlayerResponse();
      last = extractCaptionData(playerResponse);

      if (!isCurrentVideo(last, expectedVideoId)) {
        await sleep(150);
        continue;
      }
      if (last.tracks.length > 0 || last.hasCaptionsRenderer) {
        return last;
      }
      if (last.hasPlayerResponse && !last.hasCaptionsRenderer) {
        return last;
      }
      await sleep(150);
    }

    return last;
  }

  async function handleRequest(requestId, expectedVideoId) {
    const data = await collectCaptionData(expectedVideoId);
    let error = "";
    if (!isCurrentVideo(data, expectedVideoId) || !data.hasPlayerResponse) {
      error = "Couldn’t read this video’s player data. Try refreshing the page.";
    } else if (!data.tracks.length) {
      error = "This video has no captions.";
    }
    let rawFetch = { status: 0, bodyLen: -1, kind: "skip", error: "" };
    const rawUrl = data.tracks[0]?.baseUrl;
    if (rawUrl) {
      try {
        const response = await fetch(rawUrl, { credentials: "include" });
        const body = await response.text();
        const trimmed = body.trim();
        rawFetch = {
          status: response.status,
          bodyLen: body.length,
          kind: trimmed.startsWith("{")
            ? "json"
            : trimmed.startsWith("<")
              ? "xml"
              : trimmed
                ? "other"
                : "empty",
          error: "",
        };
      } catch (err) {
        rawFetch = {
          status: 0,
          bodyLen: -1,
          kind: "throw",
          error: err?.message || String(err),
        };
      }
    }
    const videoId = expectedVideoId || data.videoId;
    let captionBody = cachedBodyFor(videoId);
    let triggered = false;
    if (!captionBody && data.tracks.length) {
      triggered = triggerPlayerCaptions();
      captionBody = await waitForCachedBody(videoId, 4500);
    }
    agentLog(
      "content/main.js:handleRequest",
      "collected caption data",
      {
        expectedVideoId,
        videoId: data.videoId,
        trackCount: data.tracks.length,
        hasPlayerResponse: data.hasPlayerResponse,
        hasCaptionsRenderer: data.hasCaptionsRenderer,
        error,
        urlFlags: data.urlFlags || {},
        rawFetch,
        triggered,
        interceptBodyLen: captionBody ? captionBody.length : 0,
        interceptHasPot: timedtextCache.hasPot,
      },
      "H3"
    );

    window.postMessage(
      {
        source: SOURCE_MAIN,
        type: "CAPTION_TRACKS",
        requestId,
        tracks: data.tracks,
        defaultLanguageCode: data.defaultLanguageCode,
        videoId: data.videoId,
        captionBody,
        error,
      },
      window.location.origin
    );
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }
    if (event.origin !== window.location.origin) {
      return;
    }
    const data = event.data;
    if (!data || data.source !== SOURCE_ISOLATED) {
      return;
    }
    if (data.type !== "GET_CAPTION_TRACKS" || typeof data.requestId !== "string") {
      return;
    }
    agentLog(
      "content/main.js:message",
      "received GET_CAPTION_TRACKS",
      { requestId: data.requestId, expectedVideoId: data.expectedVideoId || "" },
      "H2"
    );
    handleRequest(
      data.requestId,
      typeof data.expectedVideoId === "string" ? data.expectedVideoId : ""
    );
  });
})();
