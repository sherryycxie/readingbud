const HIGHLIGHTS_KEY = "highlights";
const BOOKMARKS_KEY = "bookmarks";
const TAGS_KEY = "tags";

const highlightsList = document.getElementById("highlights-list");
const bookmarksList = document.getElementById("bookmarks-list");
const pageMeta = document.getElementById("page-meta");
const bookmarkTagsInput = document.getElementById("bookmark-tags");
const tagSuggestions = document.getElementById("bookmark-tag-suggestions");
let cachedTags = [];

function getStorage(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => resolve(result[key] || []));
  });
}

function setStorage(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => resolve());
  });
}

function renderTagSuggestions(tags, query) {
  if (!tagSuggestions) {
    return;
  }
  const trimmed = query.trim();
  const selected = new Set(getCommittedTags(bookmarkTagsInput.value).map(normalizeTag));
  const matches = tags.filter((tag) => {
    const normalized = normalizeTag(tag);
    if (!normalized.startsWith(normalizeTag(trimmed))) {
      return false;
    }
    if (selected.has(normalized)) {
      return false;
    }
    if (trimmed.length < 2) {
      return normalized.length <= 2;
    }
    return true;
  });
  if (trimmed.length < 2 && !matches.length) {
    tagSuggestions.innerHTML = "";
    return;
  }
  tagSuggestions.innerHTML = matches
    .map((tag) => `<button class="tag-suggestion" data-tag="${tag}">${tag}</button>`)
    .join("");
}

function getActiveToken(value) {
  const parts = value.split(",");
  return parts[parts.length - 1] || "";
}

function getCommittedTags(value) {
  const parts = value.split(",");
  parts.pop();
  return parts.map((part) => part.trim()).filter(Boolean);
}

function replaceActiveToken(value, tag) {
  const parts = value.split(",");
  parts[parts.length - 1] = ` ${tag}`.trim();
  const next = parts.map((part) => part.trim()).filter(Boolean).join(", ");
  return next.length ? `${next}, ` : "";
}

function normalizeTag(tag) {
  return tag.trim().toLowerCase();
}

function parseTags(value) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length);
}

function mergeTags(existing, incoming) {
  const map = new Map(existing.map((tag) => [normalizeTag(tag), tag]));
  incoming.forEach((tag) => {
    const key = normalizeTag(tag);
    if (!map.has(key)) {
      map.set(key, tag);
    }
  });
  return Array.from(map.values());
}

function renderEmpty(target, message) {
  target.innerHTML = `<div class="meta">${message}</div>`;
}

function renderHighlights(highlights) {
  if (!highlights.length) {
    renderEmpty(highlightsList, "No highlights yet.");
    return;
  }

  highlightsList.innerHTML = highlights
    .map(
      (item) => `
      <div class="card">
        <strong>${item.text}</strong>
        <p>${item.note || "No note"}</p>
      </div>
    `
    )
    .join("");
}

function renderBookmarks(bookmarks) {
  if (!bookmarks.length) {
    renderEmpty(bookmarksList, "No bookmarks saved.");
    return;
  }

  bookmarksList.innerHTML = bookmarks
    .map(
      (item) => `
      <div class="card">
        <strong>${item.title || item.url}</strong>
        <p>${item.url}</p>
      </div>
    `
    )
    .join("");
}

async function init() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab) {
    pageMeta.textContent = "No active page.";
    return;
  }

  pageMeta.textContent = tab.title || tab.url;

  const allHighlights = await getStorage(HIGHLIGHTS_KEY);
  const pageHighlights = allHighlights.filter((item) => item.url === tab.url);
  renderHighlights(pageHighlights);

  const allBookmarks = await getStorage(BOOKMARKS_KEY);
  renderBookmarks(allBookmarks);

  const existingTags = await getStorage(TAGS_KEY);
  cachedTags = existingTags;

  const existingBookmarks = await getStorage(BOOKMARKS_KEY);
  const currentBookmark = existingBookmarks.find((item) => item.url === tab.url);
  if (currentBookmark && currentBookmark.tags && currentBookmark.tags.length) {
    bookmarkTagsInput.value = currentBookmark.tags.join(", ") + ", ";
  }

  const bookmarkBtn = document.getElementById("bookmark-btn");
  bookmarkBtn.addEventListener("click", async () => {
    const updated = await getStorage(BOOKMARKS_KEY);
    const rawTags = parseTags(bookmarkTagsInput.value);
    const tagList = mergeTags([], rawTags);
    const existingTags = await getStorage(TAGS_KEY);
    const mergedTags = mergeTags(existingTags, tagList).sort((a, b) => a.localeCompare(b));
    const existingIndex = updated.findIndex((item) => item.url === tab.url);

    if (existingIndex === -1) {
      updated.unshift({
        url: tab.url,
        title: tab.title || tab.url,
        tags: tagList,
        createdAt: new Date().toISOString()
      });
    } else {
      const existing = updated[existingIndex];
      const mergedPageTags = mergeTags(existing.tags || [], tagList);
      updated[existingIndex] = { ...existing, tags: mergedPageTags };
    }

    await setStorage(BOOKMARKS_KEY, updated);
    await setStorage(TAGS_KEY, mergedTags);
    cachedTags = mergedTags;
    renderTagSuggestions(cachedTags, getActiveToken(bookmarkTagsInput.value));
    renderBookmarks(updated);
  });

  const libraryBtn = document.getElementById("library-btn");
  libraryBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
  });

  bookmarkTagsInput.addEventListener("input", () => {
    renderTagSuggestions(cachedTags, getActiveToken(bookmarkTagsInput.value));
  });

  bookmarkTagsInput.addEventListener("focus", () => {
    renderTagSuggestions(cachedTags, getActiveToken(bookmarkTagsInput.value));
  });

  tagSuggestions.addEventListener("click", (event) => {
    const button = event.target.closest(".tag-suggestion");
    if (!button) {
      return;
    }
    const tag = button.dataset.tag;
    bookmarkTagsInput.value = replaceActiveToken(bookmarkTagsInput.value, tag);
    renderTagSuggestions(cachedTags, getActiveToken(bookmarkTagsInput.value));
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[TAGS_KEY]) {
      return;
    }
    cachedTags = changes[TAGS_KEY].newValue || [];
    renderTagSuggestions(cachedTags, getActiveToken(bookmarkTagsInput.value));
  });
}

init();
