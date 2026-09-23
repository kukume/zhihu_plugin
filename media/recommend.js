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
        detailEl.innerHTML = renderDetailShell(msg.item, true);
        break;
      case "detailResult":
        detailEl.innerHTML = renderDetailShell(msg.item, false, msg.detail);
        bindQuestionToggle();
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
        showToast(msg.message || "出错了");
        break;
    }
  });

  function showList() {
    onDetail = false;
    listPage.classList.remove("pane-back");
    detailPage.classList.add("pane-back");
    post("viewMode", { detail: false });
    requestAnimationFrame(requestMore);
  }

  function showDetail() {
    onDetail = true;
    listPage.classList.add("pane-back");
    detailPage.classList.remove("pane-back");
    detailPage.scrollTop = 0;
    post("viewMode", { detail: true });
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
          id: "question-toggle",
          icon: "more",
          title: "展开问题补充",
          className: "question-toggle",
        }) +
        '<div class="question-body" id="question-body">' +
        window.Zhihu.cleanHtml(detail.question_detail) +
        "</div>";
    }
    const body = loading
      ? '<div class="loading">加载全文...</div>'
      : '<div class="body">' + renderBody(detail) + "</div>";
    const metaParts = [escapeHtml(author), escapeHtml(type)];
    if (item && item.created_time) metaParts.push(formatTime(item.created_time));
    const linkBtn = url ? iconButton({ icon: "link", title: "打开原链接", url }) : "";
    return (
      '<article class="article"><h2>' +
      escapeHtml(title) +
      '</h2><div class="meta meta-row">' +
      '<span>' +
      metaParts.join(" · ") +
      "</span>" +
      linkBtn +
      "</div>" +
      question +
      body +
      "</article>"
    );
  }

  function bindQuestionToggle() {
    const btn = document.getElementById("question-toggle");
    const body = document.getElementById("question-body");
    if (!btn || !body) return;
    btn.addEventListener("click", () => {
      body.classList.toggle("open");
      const open = body.classList.contains("open");
      setIcon(btn, open ? "collapse" : "more", open ? "收起问题补充" : "展开问题补充");
    });
  }

  post("ready");
})();
