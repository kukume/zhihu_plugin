(function (global) {
  const vscode = acquireVsCodeApi();

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTime(ts) {
    if (!ts) return "";
    const d = new Date(Number(ts) * 1000);
    if (Number.isNaN(d.getTime())) return "";
    const diff = Date.now() - d.getTime();
    if (diff < 60 * 1000) return "刚刚";
    if (diff < 3600 * 1000) return Math.floor(diff / 60000) + " 分钟前";
    if (diff < 86400 * 1000) return Math.floor(diff / 3600000) + " 小时前";
    if (diff < 7 * 86400 * 1000) return Math.floor(diff / 86400000) + " 天前";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function renderSegments(segments) {
    if (!segments || !segments.length) return "";
    return segments
      .map((seg) => {
        if (seg.type === "image" && seg.src) {
          return (
            '<img src="' +
            escapeHtml(seg.src) +
            '" alt="图片" loading="lazy" referrerpolicy="no-referrer" />'
          );
        }
        if (seg.type === "text" && seg.content) {
          return "<p>" + escapeHtml(seg.content).replace(/\n/g, "<br>") + "</p>";
        }
        return "";
      })
      .join("");
  }

  const ALLOWED_TAGS = new Set([
    "p",
    "br",
    "b",
    "i",
    "strong",
    "em",
    "u",
    "s",
    "a",
    "img",
    "figure",
    "figcaption",
    "blockquote",
    "code",
    "pre",
    "ul",
    "ol",
    "li",
    "span",
    "div",
    "hr",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
  ]);

  function cleanHtml(input) {
    if (!input) return "";
    const tpl = document.createElement("template");
    tpl.innerHTML = String(input);
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = child.tagName.toLowerCase();
        if (tag === "script" || tag === "style" || tag === "noscript") {
          node.removeChild(child);
          continue;
        }
        const href = child.getAttribute && child.getAttribute("href");
        const realSrc =
          child.getAttribute("data-original") ||
          child.getAttribute("data-actualsrc") ||
          child.getAttribute("src");
        for (const attr of [...child.attributes]) {
          child.removeAttribute(attr.name);
        }
        if (tag === "img") {
          if (realSrc && !/^data:/i.test(realSrc)) {
            child.setAttribute("src", realSrc);
            child.setAttribute("loading", "lazy");
            child.setAttribute("referrerpolicy", "no-referrer");
          } else {
            node.removeChild(child);
            continue;
          }
        }
        if (tag === "a" && href && !/^javascript:/i.test(href)) {
          child.setAttribute("href", href);
          child.setAttribute("data-url", href);
        }
        if (!ALLOWED_TAGS.has(tag)) {
          const frag = document.createDocumentFragment();
          while (child.firstChild) frag.appendChild(child.firstChild);
          node.replaceChild(frag, child);
          continue;
        }
        walk(child);
      }
    };
    walk(tpl.content);
    return tpl.innerHTML;
  }

  function renderBody(detail) {
    if (detail && detail.html) return cleanHtml(detail.html);
    if (detail && detail.segments && detail.segments.length) return renderSegments(detail.segments);
    if (detail && detail.content) {
      return "<p>" + escapeHtml(detail.content).replace(/\n/g, "<br>") + "</p>";
    }
    return '<p class="empty">暂无正文</p>';
  }

  function previewOf(item) {
    if (item.excerpt) return item.excerpt;
    if (item.content) return item.content;
    if (item.type === "问题" || item.type === "question") {
      return (item.answers || 0) + " 个回答 · " + (item.followers || 0) + " 人关注";
    }
    return item.author || "";
  }

  function titleOf(item) {
    const title = (item.title || "").trim();
    if (title) return title;
    if (item.type === "想法") return "想法 · " + (item.author || "匿名");
    return "(无标题)";
  }

  function showToast(message) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove("show"), 4000);
  }

  function post(type, extra) {
    vscode.postMessage(Object.assign({ type }, extra || {}));
  }

  function strokeIcon(inner) {
    return (
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      inner +
      "</svg>"
    );
  }

  const ICONS = {
    refresh: strokeIcon(
      '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15A9 9 0 1 1 5.64 5.64L1 10"/>',
    ),
    back: strokeIcon('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>'),
    editor: strokeIcon(
      '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
    ),
    more: strokeIcon('<polyline points="6 9 12 15 18 9"/>'),
    collapse: strokeIcon('<polyline points="18 15 12 9 6 15"/>'),
    decode: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
    link: strokeIcon(
      '<path d="M18 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    ),
    spinner: strokeIcon('<path d="M21 12a9 9 0 1 1-6.22-8.56"/>'),
    close: strokeIcon('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  };

  function setIcon(btn, name, title) {
    if (!btn) return;
    btn.dataset.icon = name;
    if (title) {
      btn.title = title;
      btn.setAttribute("aria-label", title);
    }
    btn.innerHTML = ICONS[name] || "";
  }

  function iconButton(opts) {
    const cls = ["icon-btn", opts.className].filter(Boolean).join(" ");
    const id = opts.id ? ' id="' + opts.id + '"' : "";
    const action = opts.action ? ' data-action="' + escapeHtml(opts.action) + '"' : "";
    const commentId = opts.commentId
      ? ' data-comment-id="' + escapeHtml(String(opts.commentId)) + '"'
      : "";
    const url = opts.url ? ' data-url="' + escapeHtml(opts.url) + '"' : "";
    const extra = opts.attrs ? " " + opts.attrs : "";
    return (
      "<button class=\"" +
      cls +
      '"' +
      id +
      action +
      commentId +
      url +
      extra +
      ' type="button" data-icon="' +
      escapeHtml(opts.icon) +
      '" title="' +
      escapeHtml(opts.title) +
      '" aria-label="' +
      escapeHtml(opts.title) +
      '">' +
      (ICONS[opts.icon] || "") +
      "</button>"
    );
  }

  function setBusy(btn, busy) {
    if (!btn) return;
    btn.disabled = !!busy;
    btn.classList.toggle("is-loading", !!busy);
    if (busy) {
      if (!btn.dataset.prevIcon) btn.dataset.prevIcon = btn.dataset.icon || "";
      setIcon(btn, "spinner", btn.title);
    } else if (btn.dataset.prevIcon) {
      setIcon(btn, btn.dataset.prevIcon);
      delete btn.dataset.prevIcon;
    }
  }

  function hydrateIcons(root) {
    (root || document).querySelectorAll("button[data-icon]").forEach((btn) => {
      if (!btn.innerHTML.trim()) setIcon(btn, btn.dataset.icon, btn.title);
    });
  }

  function closeLightbox() {
    const box = document.getElementById("lightbox");
    if (!box) return;
    box.classList.add("hidden");
    const img = box.querySelector("img");
    if (img) img.removeAttribute("src");
  }

  function openLightbox(src) {
    if (!src) return;
    let box = document.getElementById("lightbox");
    if (!box) {
      box = document.createElement("div");
      box.id = "lightbox";
      box.className = "lightbox hidden";
      box.innerHTML =
        iconButton({ icon: "close", title: "关闭", className: "lightbox-close" }) +
        '<img alt="" referrerpolicy="no-referrer" />';
      document.body.appendChild(box);
      box.addEventListener("click", (e) => {
        if (e.target.closest(".lightbox-close") || e.target === box || e.target.tagName === "IMG") {
          closeLightbox();
        }
      });
    }
    box.querySelector("img").src = src;
    box.classList.remove("hidden");
  }

  document.body.addEventListener(
    "click",
    (e) => {
      if (e.target.closest("#lightbox")) return;
      const img = e.target.closest(".article img, .comment-images img");
      if (!img) return;
      const src = img.getAttribute("src");
      if (!src) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openLightbox(src);
    },
    true,
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });

  document.body.addEventListener("click", (e) => {
    const link = e.target.closest("a[href], a[data-url], button[data-url]");
    if (!link) return;
    if (link.matches("button[data-action]")) return;
    const href = link.getAttribute("data-url") || link.getAttribute("href") || "";
    if (!href || href.startsWith("javascript:") || href.startsWith("#")) return;
    e.preventDefault();
    post("openUrl", { url: href });
  });

  hydrateIcons(document);

  global.Zhihu = {
    vscode,
    escapeHtml,
    formatTime,
    renderSegments,
    cleanHtml,
    renderBody,
    previewOf,
    titleOf,
    showToast,
    post,
    ICONS,
    setIcon,
    iconButton,
    setBusy,
    hydrateIcons,
  };
})(window);
