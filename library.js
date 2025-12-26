const HIGHLIGHTS_KEY = "highlights";
const BOOKMARKS_KEY = "bookmarks";
const TAGS_KEY = "tags";

const searchInput = document.getElementById("search");
const vaultContainer = document.getElementById("vault");
const detailContainer = document.getElementById("detail");
const tagInput = document.getElementById("tag-input");
const tagAddButton = document.getElementById("tag-add");
const tagList = document.getElementById("tag-list");
let cachedTags = [];

let activeUrl = null;

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

function matchesQuery(item, query) {
  if (!query) {
    return true;
  }
  const target = `${item.title || ""} ${item.url || ""} ${item.text || ""} ${item.note || ""}`.toLowerCase();
  return target.includes(query.toLowerCase());
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

async function upsertBookmarkTags(url, tagsToAdd) {
  if (!tagsToAdd.length) {
    return;
  }
  const [bookmarks, highlights] = await Promise.all([
    getStorage(BOOKMARKS_KEY),
    getStorage(HIGHLIGHTS_KEY)
  ]);

  const matchIndex = bookmarks.findIndex((item) => item.url === url);
  const highlightMatch = highlights.find((item) => item.url === url);
  const title = highlightMatch?.title || url;

  if (matchIndex === -1) {
    bookmarks.unshift({
      url,
      title,
      tags: mergeTags([], tagsToAdd),
      createdAt: new Date().toISOString()
    });
  } else {
    const existingTags = bookmarks[matchIndex].tags || [];
    bookmarks[matchIndex] = {
      ...bookmarks[matchIndex],
      tags: mergeTags(existingTags, tagsToAdd)
    };
  }

  await setStorage(BOOKMARKS_KEY, bookmarks);

  const existingTags = await getStorage(TAGS_KEY);
  const mergedTags = mergeTags(existingTags, tagsToAdd);
  await setStorage(TAGS_KEY, mergedTags);
}

async function renderTags() {
  const tags = await getStorage(TAGS_KEY);
  cachedTags = tags;
  tagList.innerHTML = tags.length
    ? tags
        .map(
          (tag) => `
          <span class="tag-item">
            <button class="tag" data-tag="${tag}">${tag}</button>
            <button class="tag-remove" data-type="delete-tag" data-tag="${tag}">×</button>
          </span>
        `
        )
        .join("")
    : "<span class=\"tag\">No tags yet</span>";
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

function renderTagSuggestions(container, input) {
  if (!container || !input) {
    return;
  }
  const token = getActiveToken(input.value).trim();
  const selected = new Set(getCommittedTags(input.value).map(normalizeTag));
  const matches = cachedTags.filter((tag) => {
    const normalized = normalizeTag(tag);
    if (!normalized.startsWith(normalizeTag(token))) {
      return false;
    }
    if (selected.has(normalized)) {
      return false;
    }
    if (token.length < 2) {
      return normalized.length <= 2;
    }
    return true;
  });
  if (token.length < 2 && !matches.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = matches
    .map((tag) => `<button class="tag-suggestion" data-tag="${tag}">${tag}</button>`)
    .join("");
}

function matchesGroup(bookmark, highlights, query) {
  if (!query) {
    return true;
  }
  const q = query.toLowerCase();
  const bookmarkTarget = `${bookmark.title || ""} ${bookmark.url || ""}`.toLowerCase();
  if (bookmarkTarget.includes(q)) {
    return true;
  }
  return highlights.some((item) => {
    const highlightTarget = `${item.text || ""} ${item.note || ""} ${item.url || ""} ${item.title || ""}`.toLowerCase();
    return highlightTarget.includes(q);
  });
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${normalizedPath}${parsed.search}`.toLowerCase();
  } catch (error) {
    return (url || "").replace(/\/+$/, "").toLowerCase();
  }
}

function renderEmpty(container, message) {
  container.innerHTML = `<div class="empty">${message}</div>`;
}

function renderFolders(grouped) {
  if (!grouped.length) {
    renderEmpty(vaultContainer, "No saved pages match your search.");
    detailContainer.innerHTML = "";
    return;
  }

  if (!activeUrl || !grouped.find((item) => item.bookmark.url === activeUrl)) {
    activeUrl = grouped[0].bookmark.url;
  }

  vaultContainer.innerHTML = grouped
    .map(({ bookmark, highlights }) => {
      const countLabel = `${highlights.length} highlight${highlights.length === 1 ? "" : "s"}`;
      const isActive = bookmark.url === activeUrl ? "active" : "";
      return `
        <div class="folder ${isActive}" data-url="${bookmark.url}">
          <strong>${bookmark.title || bookmark.url}</strong>
          <small>${countLabel}</small>
        </div>
      `;
    })
    .join("");
}

function renderDetail({ bookmark, highlights }) {
  if (!bookmark) {
    detailContainer.innerHTML = "";
    return;
  }

  const tags = (bookmark.tags || []).map((tag) => tag.trim()).filter(Boolean);
  const tagsMarkup = tags.length
    ? tags
        .map(
          (tag) => `
          <span class="tag-pill">
            ${tag}
            <button data-type="remove-tag" data-id="${bookmark.url}" data-tag="${tag}">x</button>
          </span>
        `
        )
        .join("")
    : "<span class=\"tag\">No tags</span>";

  detailContainer.innerHTML = `
    <article class="card">
      <div class="card-header">
        <div>
          <strong>${bookmark.title || bookmark.url}</strong>
          <small>${bookmark.url}</small>
        </div>
        <a href="${bookmark.url}" target="_blank" rel="noopener noreferrer">Open page</a>
      </div>
      <div class="tag-row">${tagsMarkup}</div>
      <div class="tag-assign">
        <input data-type="tag-input" data-id="${bookmark.url}" type="text" placeholder="Add tags (comma separated)" />
        <button data-type="add-tags" data-id="${bookmark.url}">Add tags</button>
      </div>
      <div class="tag-suggestions" data-type="tag-suggestions" data-id="${bookmark.url}"></div>
      <div class="note-list">
        ${
          highlights.length
            ? highlights
                .map(
                  (item) => `
                  <div class="note-item">
                    <span>${item.text}</span>
                    <textarea data-id="${item.id}" placeholder="Add a note...">${item.note || ""}</textarea>
                    <div class="note-actions">
                      <button data-type="save-note" data-id="${item.id}">Save note</button>
                      <button data-type="highlight" data-id="${item.id}">Remove</button>
                    </div>
                  </div>
                `
                )
                .join("")
            : "<div class=\"note-item empty\">No highlights yet.</div>"
        }
      </div>
      <div class="reflection">
        <label for="reflection-${bookmark.url}">✍️ Any thoughts you want to capture?</label>
        <textarea id="reflection-${bookmark.url}" data-type="reflection-input" data-id="${bookmark.url}" placeholder="Write a quick reflection...">${bookmark.reflection || ""}</textarea>
        <button data-type="save-reflection" data-id="${bookmark.url}">Save reflection</button>
      </div>
      <button data-type="bookmark" data-id="${bookmark.url}">Remove folder</button>
    </article>
  `;
}

async function render() {
  const query = searchInput.value.trim().toLowerCase();
  const bookmarks = await getStorage(BOOKMARKS_KEY);
  const highlights = await getStorage(HIGHLIGHTS_KEY);

  const bookmarkMap = new Map(bookmarks.map((bookmark) => [normalizeUrl(bookmark.url), bookmark]));
  const highlightMap = new Map();
  highlights.forEach((item) => {
    const key = normalizeUrl(item.url);
    const list = highlightMap.get(key) || [];
    list.push(item);
    highlightMap.set(key, list);
  });

  const urls = new Set([...bookmarkMap.keys(), ...highlightMap.keys()]);
  const grouped = Array.from(urls)
    .map((key) => {
      const items = highlightMap.get(key) || [];
      const bookmark =
        bookmarkMap.get(key) || {
          url: items[0]?.url || key,
          title: items[0]?.title || items[0]?.url || key
        };
      return { bookmark, highlights: items, key };
    })
    .filter(({ bookmark, highlights: items }) => matchesGroup(bookmark, items, query));

  renderFolders(grouped);
  renderTags();

  const selected = grouped.find((item) => item.bookmark.url === activeUrl);
  if (!selected) {
    renderEmpty(detailContainer, "Select a folder to review highlights.");
    return;
  }
  renderDetail(selected);
}

async function handleRemove(event) {
  const button = event.target.closest("button");
  if (!button) {
    return;
  }

  const type = button.dataset.type;
  const id = button.dataset.id;
  if (!type) {
    return;
  }
  if (type !== "delete-tag" && !id) {
    return;
  }

  if (type === "bookmark") {
    const items = await getStorage(BOOKMARKS_KEY);
    const updated = items.filter((item) => item.url !== id);
    await setStorage(BOOKMARKS_KEY, updated);

    const highlightItems = await getStorage(HIGHLIGHTS_KEY);
    const highlightUpdated = highlightItems.filter((item) => item.url !== id);
    await setStorage(HIGHLIGHTS_KEY, highlightUpdated);
    if (activeUrl === id) {
      activeUrl = null;
    }
  }

  if (type === "highlight") {
    const items = await getStorage(HIGHLIGHTS_KEY);
    const updated = items.filter((item) => item.id !== id);
    await setStorage(HIGHLIGHTS_KEY, updated);
  }

  if (type === "save-note") {
    const textarea = detailContainer.querySelector(`textarea[data-id="${id}"]`);
    if (textarea) {
      const items = await getStorage(HIGHLIGHTS_KEY);
      const updated = items.map((item) =>
        item.id === id ? { ...item, note: textarea.value.trim() } : item
      );
      await setStorage(HIGHLIGHTS_KEY, updated);
    }
  }

  if (type === "save-reflection") {
    const textarea = detailContainer.querySelector(`textarea[data-type="reflection-input"][data-id="${id}"]`);
    if (textarea) {
      const items = await getStorage(BOOKMARKS_KEY);
      const updated = items.map((item) =>
        item.url === id ? { ...item, reflection: textarea.value.trim() } : item
      );
      await setStorage(BOOKMARKS_KEY, updated);
    }
  }

  if (type === "add-tags") {
    const input = detailContainer.querySelector(`input[data-type="tag-input"][data-id="${id}"]`);
    if (input) {
      const tags = parseTags(input.value);
      await upsertBookmarkTags(id, tags);
      input.value = "";
    }
  }

  if (type === "remove-tag") {
    const tag = button.dataset.tag;
    const items = await getStorage(BOOKMARKS_KEY);
    const updated = items.map((item) => {
      if (item.url !== id) {
        return item;
      }
      const filtered = (item.tags || []).filter((existing) => normalizeTag(existing) !== normalizeTag(tag));
      return { ...item, tags: filtered };
    });
    await setStorage(BOOKMARKS_KEY, updated);
  }

  if (type === "delete-tag") {
    const tag = button.dataset.tag;
    if (!tag) {
      return;
    }
    const existingTags = await getStorage(TAGS_KEY);
    const remainingTags = existingTags.filter(
      (existing) => normalizeTag(existing) !== normalizeTag(tag)
    );
    await setStorage(TAGS_KEY, remainingTags);

    const bookmarks = await getStorage(BOOKMARKS_KEY);
    const updated = bookmarks.map((item) => {
      const filtered = (item.tags || []).filter(
        (existing) => normalizeTag(existing) !== normalizeTag(tag)
      );
      return { ...item, tags: filtered };
    });
    await setStorage(BOOKMARKS_KEY, updated);
  }

  render();
}

function handleFolderSelect(event) {
  const folder = event.target.closest(".folder");
  if (!folder) {
    return;
  }
  activeUrl = folder.dataset.url;
  render();
}

searchInput.addEventListener("input", render);
vaultContainer.addEventListener("click", handleFolderSelect);
detailContainer.addEventListener("click", handleRemove);
tagAddButton.addEventListener("click", async () => {
  const tags = parseTags(tagInput.value);
  if (!tags.length) {
    return;
  }
  const existing = await getStorage(TAGS_KEY);
  const merged = mergeTags(existing, tags);
  await setStorage(TAGS_KEY, merged);
  tagInput.value = "";
  renderTags();
});

tagList.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-type=\"delete-tag\"]");
  if (deleteButton) {
    await handleRemove({ target: deleteButton });
    return;
  }
  const tagButton = event.target.closest(".tag");
  if (!tagButton || !activeUrl) {
    return;
  }
  const tag = tagButton.dataset.tag;
  if (!tag) {
    return;
  }
  await upsertBookmarkTags(activeUrl, [tag]);
  render();
});

detailContainer.addEventListener("input", (event) => {
  const input = event.target.closest("input[data-type=\"tag-input\"]");
  if (!input) {
    return;
  }
  const suggestions = detailContainer.querySelector(
    `div[data-type="tag-suggestions"][data-id="${input.dataset.id}"]`
  );
  renderTagSuggestions(suggestions, input);
});

detailContainer.addEventListener("click", (event) => {
  const suggestion = event.target.closest(".tag-suggestion");
  if (!suggestion) {
    return;
  }
  const wrapper = suggestion.closest("div[data-type=\"tag-suggestions\"]");
  if (!wrapper) {
    return;
  }
  const input = detailContainer.querySelector(
    `input[data-type="tag-input"][data-id="${wrapper.dataset.id}"]`
  );
  if (!input) {
    return;
  }
  input.value = replaceActiveToken(input.value, suggestion.dataset.tag);
  renderTagSuggestions(wrapper, input);
});

render();
