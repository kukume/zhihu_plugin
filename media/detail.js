(function () {
  const { escapeHtml, formatTime, renderBody, showToast, post, iconButton, setIcon, setBusy } =
    window.Zhihu;

  const articleEl = document.getElementById("article");
  const commentsList = document.getElementById("comments-list");
  const commentsPager = document.getElementById("comments-pager");
  const commentsLoading = document.getElementById("comments-loading");
  const commentsSection = document.getElementById("comments-section");
  const refreshBtn = document.getElementById("btn-refresh-comments");

  let state = {
    item: null,
    detail: null,
    canComment: false,
    comments: [],
    paging: null,
    expanded: {},
  };

  refreshBtn.addEventListener("click", () => {
    state.comments = [];
    state.expanded = {};
    post("loadComments", { offset: "", append: false });
  });

  commentsList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const id = btn.dataset.commentId;
    const action = btn.dataset.action;
    if (action === "toggle") {
      if (state.expanded[id]) {
        delete state.expanded[id];
        renderComments({ anchorId: id, mode: "collapse" });
      } else {
        btn.disabled = true;
        setBusy(btn, true);
        post("loadChildComments", { commentId: id, offset: "" });
      }
    } else if (action === "more-children") {
      const expanded = state.expanded[id];
      const comment = state.comments.find((c) => String(c.id) === String(id));
      const offset =
        (expanded && expanded.paging && expanded.paging.next_offset) ||
        (comment && comment.child_next_offset) ||
        "";
      if (!offset) {
        showToast("没有更多回复");
        return;
      }
      btn.disabled = true;
      setBusy(btn, true);
      post("loadChildComments", { commentId: id, offset });
    }
  });

  commentsPager.addEventListener("click", (e) => {
    const btn = e.target.closest("#btn-more-comments");
    if (!btn) return;
    const pg = state.paging;
    if (!pg || pg.is_end || !pg.next_offset) return;
    btn.disabled = true;
    setBusy(btn, true);
    post("loadComments", { offset: pg.next_offset, append: true });
  });

  window.addEventListener("message", (e) => {
    const msg = e.data || {};
    switch (msg.type) {
      case "init":
        state.item = msg.item;
        state.detail = msg.detail;
        state.canComment = !!msg.canComment;
        state.comments = [];
        state.paging = null;
        state.expanded = {};
        renderArticle();
        if (state.canComment) {
          commentsSection.classList.remove("hidden");
          post("loadComments", { offset: "", append: false });
        } else {
          commentsList.innerHTML = '<div class="empty">该类型不支持评论</div>';
          commentsPager.innerHTML = "";
        }
        break;
      case "commentsLoading":
        commentsLoading.classList.remove("hidden");
        break;
      case "commentsResult":
        commentsLoading.classList.add("hidden");
        state.comments = msg.append
          ? state.comments.concat(msg.data.data || [])
          : msg.data.data || [];
        state.paging = msg.data.paging;
        renderComments();
        break;
      case "childCommentsResult":
        commentsLoading.classList.add("hidden");
        {
          const id = String(msg.commentId);
          const existing = state.expanded[id];
          const incoming = msg.data.data || [];
          state.expanded[id] = {
            comments: existing ? existing.comments.concat(incoming) : incoming,
            paging: msg.data.paging,
          };
          renderComments({ anchorId: id, mode: "keep" });
        }
        break;
      case "error":
        commentsLoading.classList.add("hidden");
        showToast(msg.message || "出错了");
        break;
    }
  });

  function renderArticle() {
    const item = state.item || {};
    const detail = state.detail || {};
    const title = detail.title || item.title || "(无标题)";
    const author = detail.author || item.author || "匿名";
    const type = detail.type || item.type || "";
    let question = "";
    if (detail.question_detail) {
      question =
        iconButton({
          id: "question-toggle",
          icon: "more",
          title: "展开问题补充",
          className: "question-toggle",
        }) +
        '<div class="question-body" id="question-body">' +
        window.Zhihu.cleanHtml(detail.question_detail) +
        "</div>";
    }
    const meta = [escapeHtml(author), escapeHtml(type)];
    if (item.created_time) meta.push(formatTime(item.created_time));
    const linkBtn = item.url ? iconButton({ icon: "link", title: "打开原链接", url: item.url }) : "";
    articleEl.innerHTML =
      '<article class="article"><h2>' +
      escapeHtml(title) +
      '</h2><div class="meta meta-row">' +
      "<span>" +
      meta.join(" · ") +
      "</span>" +
      linkBtn +
      "</div>" +
      question +
      '<div class="body">' +
      renderBody(detail) +
      "</div></article>";
    const btn = document.getElementById("question-toggle");
    const qbody = document.getElementById("question-body");
    if (btn && qbody) {
      btn.addEventListener("click", () => {
        qbody.classList.toggle("open");
        const open = qbody.classList.contains("open");
        setIcon(btn, open ? "collapse" : "more", open ? "收起问题补充" : "展开问题补充");
      });
    }
  }

  function captureAnchor(id) {
    if (id == null) return null;
    const el = commentsList.querySelector('[data-cid="' + String(id) + '"]');
    const main = el ? el.querySelector(".comment-main") || el : null;
    const rect = main ? main.getBoundingClientRect() : null;
    const viewHeight = window.innerHeight || document.documentElement.clientHeight;
    return {
      id: String(id),
      top: el ? el.getBoundingClientRect().top : null,
      scrollY: window.scrollY || document.documentElement.scrollTop || 0,
      onScreen: !!(rect && rect.bottom > 0 && rect.top < viewHeight),
    };
  }

  function restoreAnchor(anchor, mode) {
    if (!anchor) return;
    if (mode === "collapse" && anchor.onScreen) return;
    const apply = () => {
      const el = commentsList.querySelector('[data-cid="' + anchor.id + '"]');
      if (!el) return;
      if (mode === "collapse" || anchor.top == null) {
        el.scrollIntoView({ block: "start", behavior: "auto" });
        return;
      }
      const newTop = el.getBoundingClientRect().top;
      const scroller = document.scrollingElement || document.documentElement;
      scroller.scrollTop = anchor.scrollY + (newTop - anchor.top);
    };
    requestAnimationFrame(() => requestAnimationFrame(apply));
  }

  function renderComments(opts) {
    opts = opts || {};
    const anchor = opts.anchorId != null ? captureAnchor(opts.anchorId) : null;
    if (!state.canComment) return;
    if (!state.comments.length) {
      commentsList.innerHTML = '<div class="empty">暂无评论</div>';
      commentsPager.innerHTML = "";
      return;
    }
    commentsList.innerHTML = state.comments.map(renderComment).join("");
    restoreAnchor(anchor, opts.mode || "keep");
    const pg = state.paging;
    const hasMore = pg && !pg.is_end && pg.next_offset;
    commentsPager.innerHTML =
      '<div class="pagination"><span>已加载 ' +
      state.comments.length +
      " 条</span>" +
      (hasMore
        ? iconButton({
            id: "btn-more-comments",
            icon: "more",
            title: "加载更多评论",
          })
        : "") +
      "</div>";
  }

  function renderComment(comment) {
    const id = String(comment.id);
    const expanded = state.expanded[id];
    const preloaded = comment.child_comments || [];
    const children = expanded ? expanded.comments : preloaded;
    const total = comment.child_comment_count || 0;
    let childHtml = "";
    if (children.length) {
      childHtml =
        '<div class="child-comments">' +
        children.map(renderChild).join("") +
        '<div class="comment-actions">';
      if (expanded && total > children.length) {
        childHtml += iconButton({
          action: "more-children",
          commentId: id,
          icon: "more",
          title: "加载更多回复",
        });
      }
      if (expanded) {
        childHtml += iconButton({
          action: "toggle",
          commentId: id,
          icon: "collapse",
          title: "收起回复",
        });
      } else if (total > children.length) {
        childHtml += iconButton({
          action: "toggle",
          commentId: id,
          icon: "more",
          title: "查看全部 " + total + " 条回复",
        });
      }
      childHtml += "</div></div>";
    } else if (total > 0) {
      childHtml =
        '<div class="comment-actions">' +
        iconButton({
          action: "toggle",
          commentId: id,
          icon: "more",
          title: "展开 " + total + " 条回复",
        }) +
        "</div>";
    }
    return (
      '<div class="comment" data-cid="' +
      escapeHtml(id) +
      '"><div class="comment-main">' +
      '<div class="comment-author">' +
      escapeHtml(comment.author || "匿名用户") +
      "</div>" +
      commentMeta(comment) +
      '<div class="comment-content">' +
      escapeHtml(comment.content || "") +
      "</div>" +
      renderImages(comment.images) +
      '<div class="comment-likes">👍 ' +
      escapeHtml(String(comment.like_count || 0)) +
      (comment.dislike_count ? " · 👎 " + escapeHtml(String(comment.dislike_count)) : "") +
      "</div></div>" +
      childHtml +
      "</div>"
    );
  }

  function renderChild(c) {
    return (
      '<div class="child-comment">' +
      '<div class="comment-author">' +
      escapeHtml(c.author || "匿名用户") +
      "</div>" +
      commentMeta(c) +
      '<div class="comment-content">' +
      escapeHtml(c.content || "") +
      "</div>" +
      renderImages(c.images) +
      '<div class="comment-likes">👍 ' +
      escapeHtml(String(c.like_count || 0)) +
      "</div></div>"
    );
  }

  function commentMeta(c) {
    const parts = [];
    if (c.created_time) parts.push(formatTime(c.created_time));
    if (c.ip_location) parts.push(escapeHtml(c.ip_location));
    return parts.length ? '<div class="comment-meta">' + parts.join(" · ") + "</div>" : "";
  }

  function renderImages(images) {
    if (!images || !images.length) return "";
    return (
      '<div class="comment-images">' +
      images
        .map(
          (src) =>
            '<img src="' +
            escapeHtml(src) +
            '" alt="评论图片" loading="lazy" referrerpolicy="no-referrer" />',
        )
        .join("") +
      "</div>"
    );
  }

  post("ready");
})();
