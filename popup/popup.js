"use strict";

const YOUTUBE_HOST = /(^|\.)youtube\.com$/i;

const statusEl = document.getElementById("status");
const manualEl = document.getElementById("manual");

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.classList.remove("is-ok", "is-error");
  if (kind) {
    statusEl.classList.add(kind);
  }
}

function showManualCopy(text) {
  manualEl.hidden = false;
  manualEl.textContent = text;
  const range = document.createRange();
  range.selectNodeContents(manualEl);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function isYouTubeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && YOUTUBE_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

async function requestTranscript(tab) {
  try {
    return await browser.tabs.sendMessage(tab.id, { type: "getTranscript" });
  } catch {
    return browser.runtime.sendMessage({ type: "getTranscriptFromBackground" });
  }
}

async function copyTranscript() {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id || !isYouTubeUrl(tab.url || "")) {
    setStatus("Open a YouTube video to copy its transcript.", "is-error");
    return;
  }

  const result = await requestTranscript(tab);
  if (!result?.ok || !result.text) {
    setStatus(result?.error || "Couldn’t get the transcript.", "is-error");
    return;
  }

  try {
    await navigator.clipboard.writeText(result.text);
    const lines = result.text.split("\n").filter(Boolean).length;
    setStatus(`Copied ${lines} line${lines === 1 ? "" : "s"}.`, "is-ok");
  } catch {
    setStatus("Clipboard blocked. Select the text and copy it.", "is-error");
    showManualCopy(result.text);
  }
}

copyTranscript().catch((err) => {
  setStatus(err?.message || "Couldn’t copy the transcript.", "is-error");
});
