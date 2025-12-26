const STORAGE_KEY = "highlights";
const BOOKMARKS_KEY = "bookmarks";
const HIGHLIGHT_CLASS = "codex-highlight";
const PREVIEW_CLASS = "codex-highlight-preview";

let toolbarEl = null;
let lastSelectionRange = null;
let currentHighlightId = null;
let toolbarInput = null;
let toolbarSaveBtn = null;
let toolbarRemoveBtn = null;
let highlightingEnabled = false;

function getHighlights() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      resolve(result[STORAGE_KEY] || []);
    });
  });
}

function setHighlights(highlights) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: highlights }, () => resolve());
  });
}

function getBookmarks() {
  return new Promise((resolve) => {
    chrome.storage.local.get([BOOKMARKS_KEY], (result) => {
      resolve(result[BOOKMARKS_KEY] || []);
    });
  });
}

function createToolbar() {
  if (toolbarEl) {
    return toolbarEl;
  }

  toolbarEl = document.createElement("div");
  toolbarEl.className = "codex-highlight-toolbar";

  toolbarInput = document.createElement("input");
  toolbarInput.type = "text";
  toolbarInput.placeholder = "Add a note...";
  toolbarInput.addEventListener("focus", () => {
    if (lastSelectionRange && !document.querySelector(`.${PREVIEW_CLASS}`)) {
      applyPreviewHighlight(lastSelectionRange);
    }
  });

  toolbarSaveBtn = document.createElement("button");
  toolbarSaveBtn.textContent = "Highlight";

  toolbarRemoveBtn = document.createElement("button");
  toolbarRemoveBtn.textContent = "Remove";
  toolbarRemoveBtn.className = "secondary";
  toolbarRemoveBtn.style.display = "none";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Dismiss";
  cancelBtn.className = "secondary";

  toolbarSaveBtn.addEventListener("click", async () => {
    const note = toolbarInput.value.trim();
    if (currentHighlightId) {
      const existing = await getHighlights();
      const updated = existing.map((item) =>
        item.id === currentHighlightId ? { ...item, note } : item
      );
      await setHighlights(updated);
      cleanupToolbar();
      return;
    }

    const previews = Array.from(document.querySelectorAll(`.${PREVIEW_CLASS}`));
    const previewText = previews.map((preview) => preview.textContent || "").join("");
    const rangeText = lastSelectionRange ? lastSelectionRange.toString() : "";
    const text = (previewText || rangeText).trim();
    if (!text) {
      cleanupToolbar();
      return;
    }

    const id = crypto.randomUUID();
    if (previews.length) {
      previews.forEach((preview) => {
        preview.classList.remove(PREVIEW_CLASS);
        preview.classList.add(HIGHLIGHT_CLASS);
        preview.dataset.highlightId = id;
      });
    } else if (lastSelectionRange) {
      applyHighlight(lastSelectionRange, id);
    }

    const highlight = {
      id,
      url: window.location.href,
      title: document.title,
      text,
      note,
      color: "#fff3a6",
      createdAt: new Date().toISOString()
    };

    const existing = await getHighlights();
    existing.push(highlight);
    await setHighlights(existing);

    cleanupToolbar();
  });

  toolbarRemoveBtn.addEventListener("click", async () => {
    if (!currentHighlightId) {
      return;
    }
    const existing = await getHighlights();
    const updated = existing.filter((item) => item.id !== currentHighlightId);
    await setHighlights(updated);
    removeHighlightFromDom(currentHighlightId);
    cleanupToolbar();
  });

  cancelBtn.addEventListener("click", () => {
    cleanupToolbar();
  });

  toolbarEl.appendChild(toolbarInput);
  toolbarEl.appendChild(toolbarSaveBtn);
  toolbarEl.appendChild(toolbarRemoveBtn);
  toolbarEl.appendChild(cancelBtn);
  document.body.appendChild(toolbarEl);
  return toolbarEl;
}

function cleanupToolbar() {
  if (toolbarEl) {
    toolbarEl.remove();
    toolbarEl = null;
  }
  lastSelectionRange = null;
  currentHighlightId = null;
  toolbarInput = null;
  toolbarSaveBtn = null;
  toolbarRemoveBtn = null;
  clearPreviewHighlights();
}

function positionToolbarAtRect(rect) {
  const toolbar = createToolbar();
  const top = window.scrollY + rect.top - 50;
  const left = window.scrollX + rect.left;
  toolbar.style.top = `${Math.max(top, 10)}px`;
  toolbar.style.left = `${Math.max(left, 10)}px`;
}

function positionToolbar(range) {
  positionToolbarAtRect(range.getBoundingClientRect());
  if (toolbarInput) {
    if (typeof toolbarInput.focus === "function") {
      toolbarInput.focus({ preventScroll: true });
    }
  }
}

function applyHighlight(range, id) {
  const textNodes = getTextNodesInRange(range);
  if (!textNodes.length) {
    return;
  }

  textNodes.forEach((node) => {
    const textRange = document.createRange();
    const startOffset = node === range.startContainer ? range.startOffset : 0;
    const endOffset = node === range.endContainer ? range.endOffset : node.nodeValue.length;
    textRange.setStart(node, startOffset);
    textRange.setEnd(node, endOffset);

    const span = document.createElement("span");
    span.className = HIGHLIGHT_CLASS;
    span.dataset.highlightId = id;
    textRange.surroundContents(span);
  });

  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
  }
}

function applyPreviewHighlight(range) {
  const textNodes = getTextNodesInRange(range);
  if (!textNodes.length) {
    return;
  }

  textNodes.forEach((node) => {
    const textRange = document.createRange();
    const startOffset = node === range.startContainer ? range.startOffset : 0;
    const endOffset = node === range.endContainer ? range.endOffset : node.nodeValue.length;
    textRange.setStart(node, startOffset);
    textRange.setEnd(node, endOffset);

    const span = document.createElement("span");
    span.className = PREVIEW_CLASS;
    textRange.surroundContents(span);
  });
}

function getTextNodesInRange(range) {
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) {
    if (!root.nodeValue || !root.nodeValue.trim()) {
      return [];
    }
    return range.intersectsNode(root) ? [root] : [];
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!range.intersectsNode(node)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }
  return nodes;
}

function clearPreviewHighlights() {
  const previews = document.querySelectorAll(`.${PREVIEW_CLASS}`);
  previews.forEach((preview) => {
    const parent = preview.parentNode;
    if (!parent) {
      return;
    }
    while (preview.firstChild) {
      parent.insertBefore(preview.firstChild, preview);
    }
    parent.removeChild(preview);
    parent.normalize();
  });
}

function removeAllHighlightsFromDom() {
  const highlights = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
  highlights.forEach((highlight) => {
    const parent = highlight.parentNode;
    if (!parent) {
      return;
    }
    while (highlight.firstChild) {
      parent.insertBefore(highlight.firstChild, highlight);
    }
    parent.removeChild(highlight);
    parent.normalize();
  });
}

function findTextRange(targetText, root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.nodeValue) {
      continue;
    }
    const index = node.nodeValue.indexOf(targetText);
    if (index !== -1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + targetText.length);
      return range;
    }
  }
  return null;
}

function removeHighlightFromDom(id) {
  const highlights = document.querySelectorAll(`[data-highlight-id="${id}"]`);
  highlights.forEach((highlight) => {
    const parent = highlight.parentNode;
    if (!parent) {
      return;
    }
    while (highlight.firstChild) {
      parent.insertBefore(highlight.firstChild, highlight);
    }
    parent.removeChild(highlight);
    parent.normalize();
  });
}

async function restoreHighlights() {
  if (!highlightingEnabled) {
    return;
  }
  const highlights = await getHighlights();
  const pageHighlights = highlights.filter((item) => item.url === window.location.href);

  pageHighlights.forEach((item) => {
    if (document.querySelector(`[data-highlight-id="${item.id}"]`)) {
      return;
    }

    const range = findTextRange(item.text, document.body);
    if (range) {
      applyHighlight(range, item.id);
    }
  });
}

function setHighlightingEnabled(enabled) {
  highlightingEnabled = enabled;
  if (!enabled) {
    cleanupToolbar();
    removeAllHighlightsFromDom();
    return;
  }
  restoreHighlights();
}

async function refreshHighlightingState() {
  const bookmarks = await getBookmarks();
  const isBookmarked = bookmarks.some((item) => item.url === window.location.href);
  setHighlightingEnabled(isBookmarked);
}

async function showToolbarForHighlight(target) {
  if (!highlightingEnabled) {
    return;
  }
  if (!target || lastSelectionRange) {
    return;
  }
  const id = target.dataset.highlightId;
  if (!id) {
    return;
  }
  if (toolbarEl && currentHighlightId === id) {
    return;
  }

  const existing = await getHighlights();
  const item = existing.find((highlight) => highlight.id === id);
  if (!item) {
    return;
  }

  currentHighlightId = id;
  lastSelectionRange = null;
  clearPreviewHighlights();
  const toolbar = createToolbar();
  toolbarInput.value = item.note || "";
  toolbarSaveBtn.textContent = "Save note";
  toolbarRemoveBtn.style.display = "inline-flex";
  positionToolbarAtRect(target.getBoundingClientRect());
}

function handleMouseUp(event) {
  if (!highlightingEnabled) {
    return;
  }
  if (event.target && toolbarEl && toolbarEl.contains(event.target)) {
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    cleanupToolbar();
    return;
  }

  const range = selection.getRangeAt(0);
  const selectedText = range.toString().trim();
  if (!selectedText) {
    cleanupToolbar();
    return;
  }

  clearPreviewHighlights();
  lastSelectionRange = range.cloneRange();
  applyPreviewHighlight(lastSelectionRange);
  currentHighlightId = null;
  const toolbar = createToolbar();
  toolbarInput.value = "";
  toolbarSaveBtn.textContent = "Highlight";
  toolbarRemoveBtn.style.display = "none";
  positionToolbar(range);
}

document.addEventListener("mouseup", handleMouseUp);
document.addEventListener("mouseover", (event) => {
  if (!highlightingEnabled) {
    return;
  }
  const highlight = event.target.closest(`.${HIGHLIGHT_CLASS}`);
  if (!highlight) {
    return;
  }
  if (toolbarEl && toolbarEl.contains(event.target)) {
    return;
  }
  if (lastSelectionRange) {
    return;
  }
  showToolbarForHighlight(highlight);
});

document.addEventListener("mouseout", (event) => {
  if (!highlightingEnabled) {
    return;
  }
  const highlight = event.target.closest(`.${HIGHLIGHT_CLASS}`);
  if (!highlight) {
    return;
  }
  const nextTarget = event.relatedTarget;
  if (nextTarget && toolbarEl && toolbarEl.contains(nextTarget)) {
    return;
  }
  if (currentHighlightId) {
    cleanupToolbar();
  }
});
document.addEventListener("selectionchange", () => {
  if (!highlightingEnabled) {
    return;
  }
  if (!toolbarEl || !lastSelectionRange) {
    return;
  }

  const active = document.activeElement;
  if (active && toolbarEl.contains(active) && !document.querySelector(`.${PREVIEW_CLASS}`)) {
    applyPreviewHighlight(lastSelectionRange);
  }
});
window.addEventListener("scroll", () => {
  if (!highlightingEnabled) {
    return;
  }
  if (!lastSelectionRange) {
    return;
  }
  positionToolbar(lastSelectionRange);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[BOOKMARKS_KEY]) {
    return;
  }
  refreshHighlightingState();
});

refreshHighlightingState();
