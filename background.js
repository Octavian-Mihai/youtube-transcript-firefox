"use strict";

const YOUTUBE_HOST = /(^|\.)youtube\.com$/i;

function isYouTubeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && YOUTUBE_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function pingTab(tabId) {
  return browser.tabs.sendMessage(tabId, { type: "ping" });
}

async function ensureContentScripts(tabId) {
  try {
    await pingTab(tabId);
    return;
  } catch {
    // Tab was open before the add-on loaded, or scripts have not injected yet.
  }

  await browser.scripting.executeScript({
    target: { tabId },
    files: ["content/main.js"],
    world: "MAIN",
  });
  await browser.scripting.executeScript({
    target: { tabId },
    files: ["content/isolated.js"],
    world: "ISOLATED",
  });
}

async function getTranscriptFromTab(tab) {
  if (!tab?.id || !isYouTubeUrl(tab.url || "")) {
    return {
      ok: false,
      error: "Open a YouTube video to copy its transcript.",
    };
  }

  await ensureContentScripts(tab.id);
  return browser.tabs.sendMessage(tab.id, { type: "getTranscript" });
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "getTranscriptFromBackground") {
    return;
  }
  if (sender.tab) {
    return;
  }

  return getActiveTab()
    .then((tab) => getTranscriptFromTab(tab))
    .catch((err) => ({
      ok: false,
      error: err?.message || "Couldn’t get the transcript.",
    }));
});
