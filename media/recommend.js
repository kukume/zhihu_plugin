(function () {
  const { escapeHtml, formatTime, renderBody, previewOf, titleOf, showToast, post, iconButton, setIcon } =
    window.Zhihu;

  const listPage = document.getElementById("list-page");
  const detailPage = document.getElementById("detail-page");
  const listEl = document.getElementById("list");
  const listLoading = document.getElementById("list-loading");
  const detailEl = document.getElementById("detail");
  let hasMore = false;
  let loading = false;
  let onDetail = false;
  let otherHasMore = false;
  let otherBusy = false;
  let otherFailed = false;
  let otherLoadingMore = false;

  listEl.addEventListener("click", (e) => {
    if (e.target.closest("#btn-qr")) {
      post("startQrLogin");
      return;
    }
    if (e.target.closest("#btn-qr-cancel")) {
      post("cancelQrLogin");
      renderLoggedOut("未登录");
      return;
    }
    const item = e.target.closest(".item");
    if (!item) return;
    post("openItem", { id: item.dataset.id, itemType: item.dataset.type });
  });

  window.addEventListener("message", (e) => {
    const msg = e.data || {};
    switch (msg.type) {
      case "listLoading":
        loading = true;
        listLoading.classList.remove("hidden");
        if (msg.reset) listEl.innerHTML = "";
        break;
      case "listResult":
        loading = false;
        listLoading.classList.add("hidden");
        hasMore = !!msg.hasMore;
        if (msg.status && !msg.status.logged_in) {
          hasMore = false;
          renderLoggedOut(msg.status.message);
        } else {
          renderList(msg.data || []);
        }
        if (!onDetail) requestAnimationFrame(requestMore);
        break;
      case "showList":
        showList();
        break;
      case "detailLoading":
        showDetail();
        {
          const layer = msg.push ? pushDetailLayer() : replaceDetailLayer();
          layer.innerHTML = renderDetailShell(msg.item, true);
          layer.scrollTop = 0;
        }
        break;
      case "detailResult":
        {
          const layer = topDetailLayer() || replaceDetailLayer();
          layer.innerHTML = renderDetailShell(msg.item, false, msg.detail);
          bindQuestionToggle(layer);
          bindOtherAnswers(layer, msg.item, msg.showOtherAnswers);
          layer.scrollTop = 0;
        }
        break;
      case "popDetail":
        popDetailLayer();
        otherBusy = false;
        otherFailed = false;
        otherLoadingMore = false;
        otherHasMore = !!msg.hasMore && msg.showOtherAnswers !== false;
        renderOtherAnswersPager();
        requestAnimationFrame(requestMoreOtherAnswers);
        break;
      case "otherAnswersLoading":
        otherBusy = true;
        setOtherAnswersLoading(true);
        break;
      case "otherAnswersResult":
        otherBusy = false;
        otherFailed = false;
        otherLoadingMore = false;
        otherHasMore = !!msg.hasMore;
        setOtherAnswersLoading(false);
        renderOtherAnswers(msg.data || [], !!msg.append, otherHasMore);
        requestAnimationFrame(requestMoreOtherAnswers);
        break;
      case "qrLogin":
        showQr(msg.image, msg.message);
        break;
      case "qrStatus":
        setQrMessage(msg.message, !!msg.failed);
        break;
      case "error":
        loading = false;
        listLoading.classList.add("hidden");
        setOtherAnswersLoading(false);
        if (msg.request === "loadOtherAnswers" || otherBusy) {
          otherFailed = !!otherLoadingMore;
          otherBusy = false;
          otherLoadingMore = false;
          renderOtherAnswersPager();
        }
        showToast(msg.message || "出错了");
        break;
    }
  });

  function showList() {
    onDetail = false;
    listPage.classList.remove("pane-back");
    detailPage.classList.add("pane-back");
    detailEl.innerHTML = "";
    post("viewMode", { detail: false });
    requestAnimationFrame(requestMore);
  }

  function showDetail() {
    onDetail = true;
    listPage.classList.add("pane-back");
    detailPage.classList.remove("pane-back");
    post("viewMode", { detail: true });
  }

  function topDetailLayer() {
    return detailEl.querySelector(".detail-layer:last-of-type");
  }

  function pushDetailLayer() {
    const cur = topDetailLayer();
    if (cur) cur.classList.add("pane-back");
    const layer = document.createElement("div");
    layer.className = "detail-layer";
    layer.addEventListener("scroll", requestMoreOtherAnswers, { passive: true });
    detailEl.appendChild(layer);
    return layer;
  }

  function replaceDetailLayer() {
    detailEl.innerHTML = "";
    return pushDetailLayer();
  }

  function popDetailLayer() {
    const top = topDetailLayer();
    if (top) top.remove();
    const prev = topDetailLayer();
    if (prev) prev.classList.remove("pane-back");
  }

  function listReachesViewportEnd() {
    if (!listEl.querySelector(".item")) return false;
    return listEl.getBoundingClientRect().bottom <= listPage.getBoundingClientRect().bottom + 24;
  }

  function requestMore() {
    if (loading || !hasMore || onDetail || !listReachesViewportEnd()) return;
    loading = true;
    post("loadMore");
  }

  listPage.addEventListener("scroll", requestMore, { passive: true });
  window.addEventListener("resize", requestMore);

  function renderLoggedOut(message) {
    listEl.innerHTML =
      '<div class="empty"><div>' +
      escapeHtml(message || "未登录") +
      '</div><button id="btn-qr" class="text-btn" type="button">扫码登录</button></div>';
  }

  function showQr(image, message) {
    listEl.innerHTML =
      '<div class="qr-login"><img id="qr-img" alt="登录二维码" /><div id="qr-msg" class="qr-msg"></div><button id="btn-qr-cancel" class="text-btn" type="button">取消</button></div>';
    const img = document.getElementById("qr-img");
    if (img) img.src = image || "";
    setQrMessage(message, false);
  }

  function setQrMessage(message, failed) {
    const el = document.getElementById("qr-msg");
    if (!el) return;
    el.textContent = message || "";
    if (failed && !document.getElementById("btn-qr")) {
      el.insertAdjacentHTML(
        "afterend",
        '<button id="btn-qr" class="text-btn" type="button">重新扫码</button>',
      );
    }
  }

  function renderList(items) {
    if (!items.length) {
      listEl.innerHTML = '<div class="empty">暂无推荐</div>';
      return;
    }
    listEl.innerHTML = items
      .map((item) => {
        const title = titleOf(item);
        const preview = previewOf(item);
        return (
          '<div class="item" data-id="' +
          escapeHtml(String(item.id)) +
          '" data-type="' +
          escapeHtml(item.type || "") +
          '">' +
          '<div class="item-title"><span class="badge">' +
          escapeHtml(item.type || "") +
          "</span>" +
          escapeHtml(title) +
          "</div>" +
          '<div class="item-preview">' +
          escapeHtml(preview) +
          "</div></div>"
        );
      })
      .join("");
  }

  function renderDetailShell(item, loading, detail) {
    const title = (detail && detail.title) || titleOf(item || {});
    const author = (detail && detail.author) || (item && item.author) || "匿名";
    const type = (detail && detail.type) || (item && item.type) || "";
    const url = item && item.url;
    let question = "";
    if (detail && detail.question_detail) {
      question =
        iconButton({
          icon: "more",
          title: "展开问题补充",
          className: "question-toggle",
        }) +
        '<div class="question-body">' +
        window.Zhihu.cleanHtml(detail.question_detail) +
        "</div>";
    }
    const body = loading
      ? '<div class="loading">加载全文...</div>'
      : '<div class="body">' + renderBody(detail) + "</div>";
    const metaParts = [escapeHtml(author), escapeHtml(type)];
    if (item && item.created_time) metaParts.push(formatTime(item.created_time));
    const linkBtn = url ? iconButton({ icon: "link", title: "打开原链接", url }) : "";
    const otherSection =
      '<section class="other-answers-section hidden">' +
      '<div class="other-answers-header"><h3>其他回答</h3></div>' +
      '<div class="other-answers-list"></div>' +
      '<div class="other-answers-pager"></div>' +
      '<div class="other-answers-loading loading hidden">加载其他回答...</div>' +
      "</section>";
    return (
      '<article class="article"><h2>' +
      escapeHtml(title) +
      '</h2><div class="meta meta-row">' +
      "<span>" +
      metaParts.join(" · ") +
      "</span>" +
      linkBtn +
      "</div>" +
      question +
      body +
      "</article>" +
      otherSection
    );
  }

  function bindQuestionToggle(layer) {
    const btn = layer.querySelector(".question-toggle");
    const body = layer.querySelector(".question-body");
    if (!btn || !body) return;
    btn.addEventListener("click", () => {
      body.classList.toggle("open");
      const open = body.classList.contains("open");
      setIcon(btn, open ? "collapse" : "more", open ? "收起问题补充" : "展开问题补充");
    });
  }

  function canShowOtherAnswers(item) {
    if (!item || item.question_id == null || item.question_id === "") return false;
    const type = item.type || "";
    return type === "回答" || type === "盐选小说" || type === "answer";
  }

  function bindOtherAnswers(layer, item, showOtherAnswers) {
    const section = layer.querySelector(".other-answers-section");
    if (!section) return;
    const enabled = showOtherAnswers !== false && canShowOtherAnswers(item);
    otherHasMore = false;
    otherBusy = false;
    otherFailed = false;
    otherLoadingMore = false;
    if (!enabled) {
      section.classList.add("hidden");
      return;
    }
    section.classList.remove("hidden");
    const list = section.querySelector(".other-answers-list");
    const pager = section.querySelector(".other-answers-pager");
    if (list) list.innerHTML = "";
    if (pager) pager.innerHTML = "";
    otherBusy = true;
    post("loadOtherAnswers", { append: false });
  }

  function setOtherAnswersLoading(on) {
    const layer = topDetailLayer();
    const el = layer && layer.querySelector(".other-answers-loading");
    if (!el) return;
    if (on) el.classList.remove("hidden");
    else el.classList.add("hidden");
  }

  function otherAnswersReachEnd(layer) {
    if (!layer) return false;
    const section = layer.querySelector(".other-answers-section");
    if (!section || section.classList.contains("hidden")) return false;
    const marker = section.querySelector(".other-answers-pager") || section;
    return marker.getBoundingClientRect().bottom <= layer.getBoundingClientRect().bottom + 24;
  }

  function requestMoreOtherAnswers() {
    const layer = topDetailLayer();
    if (!layer || otherBusy || otherFailed || !otherHasMore) return;
    if (!otherAnswersReachEnd(layer)) return;
    otherBusy = true;
    otherLoadingMore = true;
    post("loadOtherAnswers", { append: true });
  }

  function renderOtherAnswersPager() {
    const layer = topDetailLayer();
    if (!layer) return;
    const pager = layer.querySelector(".other-answers-pager");
    if (!pager) return;
    pager.innerHTML =
      otherFailed && otherHasMore
        ? '<button class="text-btn btn-retry-other-answers" type="button">重新加载</button>'
        : "";
  }

  function renderOtherAnswers(items, append, hasMore) {
    const layer = topDetailLayer();
    if (!layer) return;
    const section = layer.querySelector(".other-answers-section");
    const list = layer.querySelector(".other-answers-list");
    const pager = layer.querySelector(".other-answers-pager");
    if (!section || !list || !pager) return;
    section.classList.remove("hidden");
    const html = (items || [])
      .map((item) => {
        const meta = [
          escapeHtml(item.author || "匿名"),
          escapeHtml(String(item.voteup || 0)) + " 赞同",
          escapeHtml(String(item.comments || 0)) + " 评论",
        ].join(" · ");
        return (
          '<div class="item other-answer-item" data-id="' +
          escapeHtml(String(item.id)) +
          '">' +
          '<div class="other-answer-meta">' +
          meta +
          '</div><div class="item-preview">' +
          escapeHtml(item.excerpt || "") +
          "</div></div>"
        );
      })
      .join("");
    if (append) list.insertAdjacentHTML("beforeend", html);
    else list.innerHTML = html || '<div class="empty">暂无其他回答</div>';
    otherHasMore = !!hasMore;
    renderOtherAnswersPager();
  }

  detailEl.addEventListener("click", (e) => {
    const retry = e.target.closest(".btn-retry-other-answers");
    if (retry) {
      retry.disabled = true;
      otherFailed = false;
      otherBusy = true;
      otherLoadingMore = true;
      renderOtherAnswersPager();
      post("loadOtherAnswers", { append: true });
      return;
    }
    const row = e.target.closest(".other-answer-item");
    if (row && row.dataset.id) {
      post("openOtherAnswer", { id: row.dataset.id });
    }
  });

  post("ready");
})();
